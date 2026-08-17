import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { websiteAPI } from "../services/api";
import { useWebsite } from "../context/WebsiteContext";
import DeliveryMap from "../../components/DeliveryMap";

const POLL_MS = 8000;
const TERMINAL_STATUSES = ["delivered", "cancelled", "completed", "refunded"];

const STATUS_COPY = {
  pending: "Order received",
  confirmed: "Order confirmed",
  preparing: "Being prepared",
  ready: "Order ready",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  completed: "Completed",
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

export default function TrackOrderPage() {
  const { orderNumber } = useParams();
  const { restaurantName } = useWebsite();

  return (
    <div className="track-page">
      <div className="container">
        <div className="track-hero">
          <h1>Track your order</h1>
          <p>
            Enter the phone number you used when placing your order to see live
            delivery updates.
          </p>
        </div>
        <TrackOrderContent
          key={orderNumber}
          orderNumber={orderNumber}
          restaurantName={restaurantName}
        />
      </div>
    </div>
  );
}

function TrackOrderContent({ orderNumber, restaurantName }) {
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [verified, setVerified] = useState(false);
  const [tracking, setTracking] = useState(null);
  const [error, setError] = useState("");

  const status = tracking?.deliveryStatus || tracking?.orderStatus || null;
  const terminal = TERMINAL_STATUSES.includes(status);

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
          ? "Order not found. Please check the order number and the phone number you entered."
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
          <input id="track-order-number" type="text" value={orderNumber || ""} readOnly />
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