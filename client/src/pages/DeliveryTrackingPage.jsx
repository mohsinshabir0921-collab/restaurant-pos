import { useState, useEffect, useCallback } from "react";
import { orderAPI, deliveryAPI } from "../services/api";
import DeliveryMap from "../components/DeliveryMap";

const ACTIVE_STATUSES = ["ready", "out_for_delivery"];
const TERMINAL_STATUSES = ["delivered", "cancelled", "completed", "refunded"];
const LIST_REFRESH_MS = 10000;
const TRACKING_POLL_MS = 8000;

const formatAddress = (addr) => {
  if (!addr) return "—";
  const parts = [addr.line1, addr.city, addr.state, addr.pincode].filter(Boolean);
  return parts.join(", ") || "—";
};

const formatTime = (value) => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleTimeString();
  } catch {
    return "—";
  }
};

export default function DeliveryTrackingPage() {
  const [orders, setOrders] = useState([]);
  const [trackingById, setTrackingById] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);

  const loadOrders = useCallback(async () => {
    try {
      const results = await Promise.all(
        ACTIVE_STATUSES.map((status) =>
          orderAPI.getAll({ orderType: "delivery", status, limit: 100 })
        )
      );
      setError("");
      const merged = [];
      const seen = new Set();
      for (const res of results) {
        for (const order of res.data?.orders || []) {
          if (
            order.orderType === "delivery" &&
            ACTIVE_STATUSES.includes(order.orderStatus) &&
            !seen.has(order._id)
          ) {
            seen.add(order._id);
            merged.push(order);
          }
        }
      }
      merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setOrders(merged);
      setTrackingById((prev) => {
        const next = {};
        for (const order of merged) {
          if (prev[order._id]) next[order._id] = prev[order._id];
        }
        return next;
      });
      setLastRefresh(new Date());
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load delivery orders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
    const timer = setInterval(loadOrders, LIST_REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadOrders]);

  useEffect(() => {
    if (orders.length === 0) return;
    let cancelled = false;
    const poll = async () => {
      const results = await Promise.allSettled(
        orders.map((order) => deliveryAPI.getTracking(order._id))
      );
      if (cancelled) return;
      setTrackingById((prev) => {
        const next = { ...prev };
        results.forEach((result, i) => {
          const orderId = orders[i]._id;
          if (result.status === "fulfilled" && result.value.data?.success) {
            next[orderId] = result.value.data.tracking;
          } else {
            delete next[orderId];
          }
        });
        return next;
      });
    };
    poll();
    const timer = setInterval(poll, TRACKING_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [orders]);

  const isTerminal = (status) => TERMINAL_STATUSES.includes(status);

  return (
    <div className="tracking-page">
      <div className="page-header">
        <div>
          <h1>Delivery Tracking</h1>
          <p className="page-subtitle">
            Live positions of active delivery orders, refreshed every few seconds
          </p>
        </div>
        <div className="header-controls">
          {lastRefresh && (
            <span className="tracking-refresh-note">Updated {formatTime(lastRefresh)}</span>
          )}
          <button className="btn btn-secondary" onClick={loadOrders}>Refresh</button>
        </div>
      </div>

      {error && (
        <div className="toast error tracking-error">
          <p>{error}</p>
          <button className="btn btn-secondary btn-sm" onClick={loadOrders}>Retry</button>
        </div>
      )}

      {loading ? (
        <div className="loading">
          <span className="spinner spinner-lg"></span>
          <span>Loading active deliveries...</span>
        </div>
      ) : orders.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🛵</div>
          <p className="empty-state-title">No active deliveries</p>
          <p className="empty-state-description">
            Ready and out-for-delivery orders will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="tracking-grid">
          {orders.map((order) => {
            const tracking = trackingById[order._id] || null;
            const boyName = tracking?.assignedTo?.name || null;
            const latest = tracking?.latestLocation || null;
            const destination = tracking?.destination || order.deliveryAddress || null;
            const terminal = isTerminal(tracking?.orderStatus);

            return (
              <div key={order._id} className={`card tracking-card${terminal ? " terminal" : ""}`}>
                <div className="tracking-card-top">
                  <div className="tracking-card-heading">
                    <span className="tracking-order-number">#{order.orderNumber}</span>
                    <span className={`status-badge ${tracking?.orderStatus || order.orderStatus}`}>
                      {tracking?.orderStatus || order.orderStatus}
                    </span>
                  </div>
                  <div className="tracking-boy">
                    <span className="meta-label">Delivery partner</span>
                    <span className="meta-value">{boyName || "Not assigned"}</span>
                  </div>
                </div>

                <div className="tracking-card-meta">
                  <div>
                    <span className="meta-label">Customer</span>
                    <span className="meta-value">{order.customerName || "—"}</span>
                  </div>
                  <div>
                    <span className="meta-label">Destination</span>
                    <span className="meta-value">{formatAddress(destination)}</span>
                  </div>
                  <div>
                    <span className="meta-label">Last location</span>
                    <span className="meta-value">{formatTime(latest?.timestamp)}</span>
                  </div>
                </div>

                <DeliveryMap
                  destination={{
                    latitude: destination?.latitude,
                    longitude: destination?.longitude,
                    label: "Delivery destination",
                  }}
                  positions={
                    latest && latest.lat !== undefined && latest.lng !== undefined
                      ? [
                          {
                            id: "boy",
                            kind: "boy",
                            lat: latest.lat,
                            lng: latest.lng,
                            label: `${boyName || "Delivery partner"}'s location`,
                          },
                        ]
                      : []
                  }
                  height={260}
                  fallback={
                    latest
                      ? "No GPS location reported yet."
                      : "Waiting for delivery partner location."
                  }
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}