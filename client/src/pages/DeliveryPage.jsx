import { useState, useEffect, useRef, useCallback } from "react";
import { orderAPI, deliveryAPI } from "../services/api";

const GPS_POST_INTERVAL_MS = 6000;
const ORDERS_REFRESH_MS = 15000;
const POSITION_EPSILON = 1e-6;

const GPS_STATUS_LABEL = {
  idle: "GPS idle",
  detecting: "Detecting location…",
  active: "GPS active",
  denied: "Location permission denied",
  unavailable: "Location unavailable",
  error: "GPS error",
};

export default function DeliveryPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [notice, setNotice] = useState("");

  const [activeOrderId, setActiveOrderId] = useState(null);
  const [startingId, setStartingId] = useState(null);
  const [completing, setCompleting] = useState(false);

  const [gpsStatus, setGpsStatus] = useState("idle");
  const [gpsMessage, setGpsMessage] = useState("");
  const [latestPosition, setLatestPosition] = useState(null);
  const [lastUpdateTime, setLastUpdateTime] = useState(null);

  const watchIdRef = useRef(null);
  const postingRef = useRef(false);
  const latestPositionRef = useRef(null);
  const lastPostedRef = useRef(null);
  const activeOrderIdRef = useRef(null);

  useEffect(() => {
    activeOrderIdRef.current = activeOrderId;
  }, [activeOrderId]);

  const stopGps = useCallback(() => {
    if (watchIdRef.current !== null) {
      if (navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      watchIdRef.current = null;
    }
  }, []);

  const resetGps = useCallback(() => {
    stopGps();
    setGpsStatus("idle");
    setGpsMessage("");
    setLatestPosition(null);
    latestPositionRef.current = null;
    lastPostedRef.current = null;
    setLastUpdateTime(null);
  }, [stopGps]);

  const fetchAssigned = useCallback(async () => {
    try {
      setListError("");
      const res = await deliveryAPI.getAssigned();
      if (res.data.success) {
        const nextOrders = res.data.orders || [];
        setOrders(nextOrders);
        const activeId = activeOrderIdRef.current;
        if (activeId && !nextOrders.some((o) => o._id === activeId)) {
          setNotice("This delivery is no longer active.");
          resetGps();
          setActiveOrderId(null);
        }
      }
    } catch (err) {
      setListError(err.response?.data?.message || "Failed to load assigned deliveries");
    } finally {
      setLoading(false);
    }
  }, [resetGps]);

  useEffect(() => {
    fetchAssigned();
    const timer = setInterval(fetchAssigned, ORDERS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [fetchAssigned]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  const postLocation = useCallback(
    async (orderId, pos) => {
      if (postingRef.current) return;
      postingRef.current = true;
      try {
        await deliveryAPI.reportLocation(orderId, pos.lat, pos.lng);
        lastPostedRef.current = pos;
        setLastUpdateTime(new Date());
      } catch (err) {
        const status = err.response?.status;
        const msg = err.response?.data?.message || "Failed to update your location";
        if (status === 401) {
          setNotice("Your session has expired. Please log in again.");
          setGpsMessage("Session expired");
          resetGps();
          setActiveOrderId(null);
        } else if (status === 403) {
          setNotice("You are no longer assigned to this delivery.");
          setGpsMessage("No longer assigned to this delivery");
          resetGps();
          setActiveOrderId(null);
          fetchAssigned();
        } else if (status === 400) {
          setNotice(msg || "This delivery is no longer active.");
          setGpsMessage(msg || "This delivery is no longer active");
          resetGps();
          setActiveOrderId(null);
          fetchAssigned();
        } else {
          setGpsMessage(msg);
        }
      } finally {
        postingRef.current = false;
      }
    },
    [fetchAssigned, resetGps]
  );

  useEffect(() => {
    if (!activeOrderId) return;
    const timer = setInterval(() => {
      const pos = latestPositionRef.current;
      if (!pos) return;
      const posted = lastPostedRef.current;
      if (
        posted &&
        Math.abs(posted.lat - pos.lat) < POSITION_EPSILON &&
        Math.abs(posted.lng - pos.lng) < POSITION_EPSILON
      ) {
        return;
      }
      postLocation(activeOrderIdRef.current, pos);
    }, GPS_POST_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [activeOrderId, postLocation]);

  const beginGps = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGpsStatus("unavailable");
      setGpsMessage("Geolocation is not supported by this browser.");
      return;
    }
    setGpsStatus("detecting");
    setGpsMessage("");
    latestPositionRef.current = null;
    lastPostedRef.current = null;
    setLatestPosition(null);
    setLastUpdateTime(null);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const pos = { lat: position.coords.latitude, lng: position.coords.longitude };
        latestPositionRef.current = pos;
        setLatestPosition(pos);
        setGpsStatus("active");
        setGpsMessage("");
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setGpsStatus("denied");
          setGpsMessage("Location permission was denied. Enable location access to broadcast your position.");
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          setGpsStatus("unavailable");
          setGpsMessage("Your location is currently unavailable.");
        } else if (error.code === error.TIMEOUT) {
          setGpsStatus("error");
          setGpsMessage("Timed out while acquiring your location. Retrying…");
        } else {
          setGpsStatus("error");
          setGpsMessage("A GPS error occurred. Retrying…");
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  }, []);

  const startDelivery = async (order) => {
    if (activeOrderId) return;
    setStartingId(order._id);
    setNotice("");
    try {
      const res = await orderAPI.updateStatus(order._id, "out_for_delivery");
      if (res.data.success) {
        setActiveOrderId(order._id);
        setNotice(`Delivery started for ${order.orderNumber}.`);
        beginGps();
        fetchAssigned();
      }
    } catch (err) {
      setNotice(err.response?.data?.message || "Failed to start the delivery.");
      fetchAssigned();
    } finally {
      setStartingId(null);
    }
  };

  const completeDelivery = async () => {
    if (!activeOrderId) return;
    setCompleting(true);
    setNotice("");
    try {
      const res = await orderAPI.updateStatus(activeOrderId, "delivered");
      if (res.data.success) {
        resetGps();
        setActiveOrderId(null);
        setNotice("Delivery completed.");
        fetchAssigned();
      }
    } catch (err) {
      setNotice(err.response?.data?.message || "Failed to complete the delivery.");
      fetchAssigned();
    } finally {
      setCompleting(false);
    }
  };

  const activeOrder = orders.find((o) => o._id === activeOrderId) || null;

  const formatAddress = (addr) => {
    if (!addr) return "—";
    const parts = [addr.line1, addr.city, addr.state, addr.pincode].filter(Boolean);
    return parts.join(", ") || "—";
  };

  const formatTime = (value) => {
    if (!value) return "—";
    return new Date(value).toLocaleTimeString();
  };

  const formatPrice = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? `₹${num.toLocaleString("en-IN")}` : "—";
  };

  const renderActiveBanner = () => {
    if (!activeOrder) return null;
    return (
      <div className="card delivery-active-card">
        <div className="card-header">
          <div>
            <span className="card-title">Delivery Active</span>
            <span className="card-subtitle">#{activeOrder.orderNumber}</span>
          </div>
          <span className={`status-badge ${activeOrder.orderStatus}`}>{activeOrder.orderStatus}</span>
        </div>
        <div className="delivery-active-body">
          <div className="delivery-gps-status">
            <span className={`gps-dot ${gpsStatus}`} />
            <span className="gps-label">{GPS_STATUS_LABEL[gpsStatus] || gpsStatus}</span>
            {latestPosition && (
              <span className="gps-coords">
                {latestPosition.lat.toFixed(6)}, {latestPosition.lng.toFixed(6)}
              </span>
            )}
          </div>
          {gpsMessage && <p className="gps-message">{gpsMessage}</p>}
          <div className="delivery-active-meta">
            <div>
              <span className="meta-label">Latest update</span>
              <span className="meta-value">{formatTime(lastUpdateTime)}</span>
            </div>
            <div>
              <span className="meta-label">Customer</span>
              <span className="meta-value">{activeOrder.customerName || "—"}</span>
            </div>
            <div>
              <span className="meta-label">Address</span>
              <span className="meta-value">{formatAddress(activeOrder.deliveryAddress)}</span>
            </div>
          </div>
          <div className="delivery-active-actions">
            <button
              className="btn btn-success"
              onClick={completeDelivery}
              disabled={completing}
            >
              {completing ? "Completing…" : "Complete Delivery"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="delivery-page">
      <div className="page-header">
        <div>
          <h1>Delivery</h1>
          <p className="page-subtitle">Orders assigned to you, live GPS broadcast while delivering</p>
        </div>
        <div className="header-controls">
          <button className="btn btn-secondary" onClick={fetchAssigned}>Refresh</button>
        </div>
      </div>

      {notice && (
        <div className="toast toast-info delivery-notice">
          <span className="delivery-notice-text">{notice}</span>
          <button className="toast-close" onClick={() => setNotice("")}>×</button>
        </div>
      )}

      {renderActiveBanner()}

      {loading ? (
        <div className="loading">
          <span className="spinner spinner-lg"></span>
          <span>Loading your assigned deliveries...</span>
        </div>
      ) : listError ? (
        <div className="toast error delivery-list-error">
          <p>{listError}</p>
          <button className="btn btn-secondary btn-sm" onClick={fetchAssigned}>Retry</button>
        </div>
      ) : orders.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🛵</div>
          <p className="empty-state-title">No active deliveries</p>
          <p className="empty-state-description">
            Newly assigned orders will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="delivery-order-list">
          {orders.map((order) => {
            const isActive = order._id === activeOrderId;
            return (
              <div key={order._id} className={`card delivery-order-card${isActive ? " active" : ""}`}>
                <div className="delivery-order-top">
                  <div className="delivery-order-heading">
                    <span className="delivery-order-number">#{order.orderNumber}</span>
                    <span className={`status-badge ${order.orderStatus}`}>{order.orderStatus}</span>
                  </div>
                  <div className="delivery-order-customer">
                    <span className="meta-label">Customer</span>
                    <span className="meta-value">{order.customerName || "—"}</span>
                  </div>
                </div>
                <div className="delivery-order-details">
                  <div className="delivery-order-address">
                    <span className="meta-label">Delivery address</span>
                    <span className="meta-value">{formatAddress(order.deliveryAddress)}</span>
                  </div>
                  <div className="delivery-order-total">
                    <span className="meta-label">Order total</span>
                    <span className="meta-value">{formatPrice(order.total)}</span>
                  </div>
                  <div className="delivery-order-actions">
                    {isActive ? (
                      <span className="delivery-in-progress">In progress…</span>
                    ) : order.orderStatus === "ready" ? (
                      <button
                        className="btn btn-primary"
                        onClick={() => startDelivery(order)}
                        disabled={!!activeOrderId || startingId === order._id}
                      >
                        {startingId === order._id ? "Starting…" : "Start Delivery"}
                      </button>
                    ) : (
                      <span className="delivery-in-progress">Awaiting pickup / in transit</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
