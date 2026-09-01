import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { websiteAPI } from "../services/api";
import { usePayment } from "../hooks/useOrder";
import { useWebsite } from "../context/WebsiteContext";
import DeliveryMap from "../../components/DeliveryMap";
import { formatPrice } from "../components/common";

const POLL_MS = 8000;
const TERMINAL_STATUSES = ["delivered", "cancelled", "completed", "refunded"];

const STATUS_COPY = {
  pending: "Order received",
  confirmed: "Order confirmed",
  preparing: "Being prepared",
  ready: "Order ready",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  served: "Served",
  paid: "Paid",
  completed: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

const formatAddress = (addr) => {
  if (!addr) return "—";
  const parts = [addr.line1, addr.city, addr.state, addr.pincode].filter(Boolean);
  return parts.join(", ") || "—";
};

const formatTime = (value) => {
  if (!value) return null;
  try {
    return new Date(value).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
};

const formatDateTime = (value) => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

export default function TrackOrderPage() {
  const { orderNumber } = useParams();
  const { restaurantName } = useWebsite();

  return (
    <div className="track-page">
      <div className="container">
        <div className="track-hero">
          <h1>Track your order</h1>
          <p>
            {orderNumber
              ? "Enter the phone number you used when placing your order to see its live updates."
              : "Enter the phone number you used when placing your order to find your recent orders."}
          </p>
        </div>
        {orderNumber ? (
          <TrackOrderContent
            key={orderNumber}
            orderNumber={orderNumber}
            restaurantName={restaurantName}
          />
        ) : (
          <RecentOrdersLookup />
        )}
      </div>
    </div>
  );
}

function RecentOrdersLookup() {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState("");

  const findOrders = async (e) => {
    e.preventDefault();
    const trimmed = phone.trim();
    if (!trimmed) return;
    setLoading(true);
    setError("");
    try {
      const res = await websiteAPI.getRecentOrders(trimmed);
      setOrders(res.data?.orders || []);
    } catch (err) {
      setOrders([]);
      setError(err.response?.data?.message || "Could not look up your orders. Please try again.");
    } finally {
      setSearched(true);
      setLoading(false);
    }
  };

  const showEmpty = searched && !loading && !error && orders.length === 0;

  return (
    <div className="track-lookup">
      <form className="track-form" onSubmit={findOrders}>
        <div className="track-field">
          <label htmlFor="track-lookup-phone">Phone number</label>
          <input
            id="track-lookup-phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Enter the phone number used at checkout"
            required
          />
        </div>
        {error && <p className="track-error">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? "Finding your orders…" : "Find My Orders"}
        </button>
      </form>

      {loading && <p className="track-loading">Finding your recent orders…</p>}

      {showEmpty && (
        <div className="track-empty">
          <p>No recent orders found for this phone number.</p>
          <p>Check the number you used at checkout and try again.</p>
        </div>
      )}

      {searched && !loading && orders.length > 0 && (
        <ul className="recent-orders-list">
          {orders.map((order) => (
            <li key={order.orderNumber} className="recent-order-card">
              <div className="recent-order-top">
                <span className="recent-order-number">{order.orderNumber}</span>
                <span className={`track-status ${order.orderStatus}`}>
                  {STATUS_COPY[order.orderStatus] || order.orderStatus}
                </span>
              </div>
              <div className="recent-order-meta">
                <span>{formatDateTime(order.createdAt)}</span>
                <span>{formatPrice(order.total)}</span>
              </div>
              <Link className="btn btn-primary" to={`/track/${order.orderNumber}`}>
                Track Order
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TrackOrderContent({ orderNumber, restaurantName }) {
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [verified, setVerified] = useState(false);
  const [tracking, setTracking] = useState(null);
  const [error, setError] = useState("");
  const [payState, setPayState] = useState("idle"); // idle | processing | success | error
  const [payMessage, setPayMessage] = useState("");

  const { openAdditionalCashfree } = usePayment();

  const status = tracking?.deliveryStatus || tracking?.orderStatus || null;
  const terminal = TERMINAL_STATUSES.includes(status);
  const additionalDue = Number(tracking?.additionalAmountDue || 0);

  const handlePayAdditional = async () => {
    if (!phone.trim()) return;
    setPayState("processing");
    setPayMessage("");
    try {
      const res = await websiteAPI.createAdditionalCashfreeOrder(orderNumber, phone.trim());
      if (!res.data?.success) {
        setPayState("error");
        setPayMessage(res.data?.message || "Could not start the payment");
        return;
      }
      await new Promise((resolve) => {
        openAdditionalCashfree({
          orderId: res.data.orderId,
          phone: phone.trim(),
          paymentSessionId: res.data.paymentSessionId,
          environment: res.data.environment,
          cashfreeOrderId: res.data.cashfreeOrderId,
          onSuccess: () => {
            setPayState("success");
            setPayMessage("Payment received. Your order is all settled.");
            resolve();
          },
          onFailure: (message) => {
            setPayState("error");
            setPayMessage(message || "Payment could not be completed");
            resolve();
          },
          onPending: (message) => {
            setPayState("error");
            setPayMessage(message || "We could not confirm the payment right now.");
            resolve();
          },
        });
      });
      await poll();
    } catch (err) {
      setPayState("error");
      setPayMessage(err?.response?.data?.message || "Could not start the payment");
    }
  };

  const verify = useCallback(async () => {
    setSubmitting(true);
    setError("");
    try {
      const res = await websiteAPI.trackOrder(orderNumber, phone.trim());
      if (res.data?.success) {
        setTracking(res.data.tracking);
        setVerified(true);
      }
    } catch (err) {
      setVerified(false);
      setTracking(null);
      setError(
        err.response?.status === 404
          ? "Order not found. Please check the phone number you entered."
          : err.response?.data?.message || "Could not load your order tracking. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }, [orderNumber, phone]);

  const poll = useCallback(async () => {
    if (!verified) return;
    try {
      const res = await websiteAPI.trackOrder(orderNumber, phone.trim());
      if (res.data?.success) {
        setTracking(res.data.tracking);
      }
    } catch {
      // Keep the last known state; the next poll tick retries.
    }
  }, [orderNumber, phone, verified]);

  useEffect(() => {
    if (!verified || terminal) return;
    const timer = setInterval(poll, POLL_MS);
    return () => clearInterval(timer);
  }, [verified, terminal, poll]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!phone.trim()) return;
    verify();
  };

  if (!verified) {
    return (
      <form className="track-form" onSubmit={handleSubmit}>
        <div className="track-field">
          <label htmlFor="track-order-number">Order number</label>
          <input id="track-order-number" type="text" value={orderNumber} readOnly />
        </div>
        <div className="track-field">
          <label htmlFor="track-phone">Phone number</label>
          <input
            id="track-phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Enter the phone number used at checkout"
            required
          />
        </div>
        {error && <p className="track-error">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? "Checking…" : "Track my order"}
        </button>
      </form>
    );
  }

  return (
    <div className="track-live">
      <div className="track-live-header">
        <div className="track-order-badge">
          <span className="track-label">Order</span>
          <strong className="track-order-number">{orderNumber}</strong>
        </div>
        <div className="track-status-block">
          <span className="track-label">Status</span>
          <span className={`track-status ${status}`}>
            {STATUS_COPY[status] || status}
          </span>
        </div>
      </div>

      <div className="track-map-wrap">
        <DeliveryMap
          destination={{
            latitude: tracking?.destination?.latitude,
            longitude: tracking?.destination?.longitude,
            label: "Delivery destination",
          }}
          positions={
            tracking?.latestLocation
              ? [
                  {
                    id: "boy",
                    kind: "boy",
                    lat: tracking.latestLocation.lat,
                    lng: tracking.latestLocation.lng,
                    label: tracking.assignedTo?.name
                      ? `${tracking.assignedTo.name}'s location`
                      : "Delivery partner location",
                  },
                ]
              : []
          }
          height={340}
          fallback="Waiting for delivery partner location."
        />
      </div>

      <div className="track-meta">
        <div className="track-meta-item">
          <span className="track-label">Destination</span>
          <span className="track-value">{formatAddress(tracking?.destination)}</span>
        </div>
        {tracking?.assignedTo?.name && (
          <div className="track-meta-item">
            <span className="track-label">Delivery partner</span>
            <span className="track-value">{tracking.assignedTo.name}</span>
          </div>
        )}
        <div className="track-meta-item">
          <span className="track-label">Last updated</span>
          <span className="track-value">
            {tracking?.latestLocation
              ? formatTime(tracking.latestLocation.timestamp) || "—"
              : "Waiting for delivery partner location"}
          </span>
        </div>
        <div className="track-meta-item">
          <span className="track-label">Ordered from</span>
          <span className="track-value">{restaurantName || "Our restaurant"}</span>
        </div>
      </div>

      {additionalDue > 0 && (
        <div className="track-additional-pay">
          <div className="track-additional-info">
            <span className="track-label">Additional payment due</span>
            <strong className="track-additional-amount">{formatPrice(additionalDue)}</strong>
          </div>
          {payState === "success" ? (
            <p className="track-additional-success">{payMessage}</p>
          ) : (
            <>
              <button
                className="btn btn-primary"
                onClick={handlePayAdditional}
                disabled={payState === "processing"}
              >
                {payState === "processing" ? "Processing…" : "Pay now"}
              </button>
              {payState === "error" && <p className="track-error">{payMessage}</p>}
            </>
          )}
        </div>
      )}

      <div className="track-actions">
        <button className="btn btn-ghost" onClick={() => setVerified(false)}>
          Track another order
        </button>
        <Link className="btn btn-ghost" to="/">
          Back to home
        </Link>
      </div>
    </div>
  );
}