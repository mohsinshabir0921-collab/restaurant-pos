import { Link, useParams } from "react-router-dom";
import { useOrder } from "../context/OrderContext";
import { useWebsite } from "../context/WebsiteContext";
import { formatPrice } from "../components/common";
import Reveal from "../components/Reveal";
import { useEffect, useState } from "react";
import { getOrderItemSize, getOrderItemAddons } from "../../utils/orderItem";
import { websiteAPI } from "../services/api";

const formatDate = (iso) => {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
};

const STATUS_COPY = {
  confirmed: "Your order has been confirmed and is being prepared.",
  pending: "Your order has been received and is awaiting payment.",
  preparing: "Your order is being prepared.",
  ready: "Your order is ready!",
  completed: "Your order has been completed. Thank you!",
  cancelled: "Your order has been cancelled.",
};

export default function OrderConfirmationPage() {
  const { orderNumber: paramOrderNumber } = useParams();
  const { lastOrder } = useOrder();
  const { restaurantName } = useWebsite();

  const [phone, setPhone] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [verifiedTracking, setVerifiedTracking] = useState(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [paramOrderNumber]);

  // Fast path: sessionStorage still has matching order
  const fastPathOrder =
    lastOrder && (!paramOrderNumber || lastOrder.orderNumber === paramOrderNumber)
      ? lastOrder
      : null;

  // Old route backward compat: /order-confirmation without param and with lastOrder
  const hasParam = Boolean(paramOrderNumber);
  const needsVerification = hasParam && !fastPathOrder && !verifiedTracking;

  const handleVerify = async (e) => {
    e.preventDefault();
    if (!phone.trim() || !paramOrderNumber) return;
    setVerifying(true);
    setError("");
    try {
      const res = await websiteAPI.trackOrder(paramOrderNumber, phone.trim());
      if (res.data?.success) {
        setVerifiedTracking(res.data.tracking);
      } else {
        setError("Could not verify order. Please check phone number.");
      }
    } catch (err) {
      if (err.response?.status === 404) {
        setError("Order not found. Please check the order number and phone number.");
      } else {
        setError(err.response?.data?.message || "Could not verify order. Please try again.");
      }
    } finally {
      setVerifying(false);
    }
  };

  // Case G: old route without param and no lastOrder -> graceful error, not redirect
  if (!hasParam && !fastPathOrder) {
    return (
      <div className="page-container confirmation-page">
        <div className="container">
          <Reveal className="confirmation-card">
            <div className="confirmation-icon" aria-hidden="true">
              <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h1 className="confirmation-title">No order found</h1>
            <p className="confirmation-status">We could not find your recent order on this device. Please check your order number or track your order with your phone number.</p>
            <div className="confirmation-actions">
              <Link to="/track" className="btn btn-outline btn-lg">
                Track order
              </Link>
              <Link to="/" className="btn btn-primary btn-lg">
                Back to Home
              </Link>
            </div>
          </Reveal>
        </div>
      </div>
    );
  }

  // Fast path: show full confirmation from lastOrder
  if (fastPathOrder) {
    const order = fastPathOrder;
    const isOnlinePayment = order.paymentMethod === "upi";
    const isCod = order.paymentMethod === "cod";
    const pickup = order.pickupAt || order.pickupDate;
    const address = order.deliveryAddress;

    return (
      <div className="page-container confirmation-page">
        <div className="container">
          <Reveal className="confirmation-card">
            <div className={`confirmation-icon ${order.orderStatus === "cancelled" ? "cancelled" : "success"}`} aria-hidden="true">
              {order.orderStatus === "cancelled" ? (
                <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              ) : (
                <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <path d="M22 4 12 14.01l-3-3" />
                </svg>
              )}
            </div>

            <h1 className="confirmation-title">
              {order.orderStatus === "cancelled" ? "Order Cancelled" : "Order Placed!"}
            </h1>
            <p className="confirmation-status">
              {STATUS_COPY[order.orderStatus] || `Order status: ${order.orderStatus}`}
            </p>

            <div className="confirmation-badge">
              <span className="confirmation-label">Order Number</span>
              <strong className="confirmation-number">{order.orderNumber}</strong>
            </div>

            <div className="confirmation-grid">
              <div className="confirmation-block">
                <h3>Order Summary</h3>
                <ul className="confirmation-items">
                  {order.items?.map((item, index) => {
                    const size = getOrderItemSize(item);
                    const addons = getOrderItemAddons(item);
                    return (
                    <li key={index} className="confirmation-item">
                      <span className="confirmation-item-qty">{item.qty}×</span>
                      <span className="confirmation-item-name">
                        {item.name}
                        {size && <span className="confirmation-item-size"> · {size}</span>}
                        {addons.length > 0 && <span className="confirmation-item-addons"> ({addons.join(", ")})</span>}
                      </span>
                      <span className="confirmation-item-price">{formatPrice(item.price * item.qty)}</span>
                    </li>
                    );
                  })}
                </ul>
                <dl className="confirmation-totals">
                  <div className="confirmation-row">
                    <dt>Subtotal</dt>
                    <dd>{formatPrice(order.subtotal)}</dd>
                  </div>
                  {order.discount > 0 && (
                    <div className="confirmation-row">
                      <dt>Discount{order.couponCode ? ` (${order.couponCode})` : ""}</dt>
                      <dd>−{formatPrice(order.discount)}</dd>
                    </div>
                  )}
                  {order.serviceCharge > 0 && (
                    <div className="confirmation-row">
                      <dt>Service Charge</dt>
                      <dd>{formatPrice(order.serviceCharge)}</dd>
                    </div>
                  )}
                  {order.deliveryFee > 0 && (
                    <div className="confirmation-row">
                      <dt>Delivery Fee</dt>
                      <dd>{formatPrice(order.deliveryFee)}</dd>
                    </div>
                  )}
                  {order.tax > 0 && (
                    <div className="confirmation-row">
                      <dt>Tax</dt>
                      <dd>{formatPrice(order.tax)}</dd>
                    </div>
                  )}
                  <div className="confirmation-row grand">
                    <dt>Total</dt>
                    <dd>{formatPrice(order.total)}</dd>
                  </div>
                </dl>
              </div>

              <div className="confirmation-block">
                <h3>Order Details</h3>
                <ul className="confirmation-details">
                  <li>
                    <span className="detail-label">Order Type</span>
                    <span className="detail-value">{order.orderType === "delivery" ? "Delivery" : "Takeaway"}</span>
                  </li>
                  <li>
                    <span className="detail-label">Payment Method</span>
                    <span className="detail-value">
                      {isOnlinePayment
                        ? "Paid Online"
                        : isCod
                        ? "Cash on Delivery"
                        : order.paymentMethod === "cash"
                        ? "Cash"
                        : order.paymentMethod}
                    </span>
                  </li>
                  <li>
                    <span className="detail-label">Payment Status</span>
                    <span className={`detail-value ${order.paymentStatus === "paid" ? "paid" : "due"}`}>
                      {order.paymentStatus === "paid" ? "Paid" : "Pending"}
                    </span>
                  </li>
                  <li>
                    <span className="detail-label">Name</span>
                    <span className="detail-value">{order.customerName}</span>
                  </li>
                  <li>
                    <span className="detail-label">Phone</span>
                    <span className="detail-value">{order.customerPhone}</span>
                  </li>
                  {pickup && (
                    <li>
                      <span className="detail-label">Pickup Time</span>
                      <span className="detail-value">{formatDate(pickup)}</span>
                    </li>
                  )}
                  {address && (
                    <li>
                      <span className="detail-label">Delivery Address</span>
                      <span className="detail-value">
                        {address.line1}
                        {address.line2 ? `, ${address.line2}` : ""}
                        {address.city ? `, ${address.city}` : ""}
                        {address.state ? `, ${address.state}` : ""}
                        {address.pincode ? ` — ${address.pincode}` : ""}
                      </span>
                    </li>
                  )}
                  {address?.distanceKm ? (
                    <li>
                      <span className="detail-label">Delivery Distance</span>
                      <span className="detail-value">{address.distanceKm} km</span>
                    </li>
                  ) : null}
                </ul>
                {order.notes && <p className="confirmation-note">Note: {order.notes}</p>}
              </div>
            </div>

            <div className="confirmation-actions">
              {order.orderType === "delivery" && (
                <Link to={`/track/${order.orderNumber}`} className="btn btn-outline btn-lg">
                  Track delivery
                </Link>
              )}
              <Link to="/menu" className="btn btn-primary btn-lg">
                Order Again
              </Link>
              <Link to="/" className="btn btn-ghost btn-lg">
                Back to Home
              </Link>
            </div>
            <p className="confirmation-thanks">
              Thank you for ordering from {restaurantName}! We'll text you the order status.
            </p>
          </Reveal>
        </div>
      </div>
    );
  }

  // Verified tracking recovery view (new tab / direct visit after phone verification)
  if (verifiedTracking) {
    const t = verifiedTracking;
    const status = t.deliveryStatus || t.orderStatus;
    return (
      <div className="page-container confirmation-page">
        <div className="container">
          <Reveal className="confirmation-card">
            <div className="confirmation-icon success" aria-hidden="true">
              <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <path d="M22 4 12 14.01l-3-3" />
              </svg>
            </div>
            <h1 className="confirmation-title">Order Found!</h1>
            <p className="confirmation-status">{STATUS_COPY[status] || `Order status: ${status}`}</p>
            <div className="confirmation-badge">
              <span className="confirmation-label">Order Number</span>
              <strong className="confirmation-number">{t.orderNumber}</strong>
            </div>
            <div className="confirmation-grid">
              <div className="confirmation-block">
                <h3>Order Status</h3>
                <ul className="confirmation-details">
                  <li>
                    <span className="detail-label">Status</span>
                    <span className="detail-value">{status}</span>
                  </li>
                  {t.destination?.line1 && (
                    <li>
                      <span className="detail-label">Delivery Address</span>
                      <span className="detail-value">{t.destination.line1}</span>
                    </li>
                  )}
                  {t.assignedTo?.name && (
                    <li>
                      <span className="detail-label">Delivery Partner</span>
                      <span className="detail-value">{t.assignedTo.name}</span>
                    </li>
                  )}
                  <li>
                    <span className="detail-label">Phone Verified</span>
                    <span className="detail-value">{phone.trim()}</span>
                  </li>
                </ul>
                <p className="confirmation-note">Itemized details are available on the original device. Your order status is shown above.</p>
              </div>
              <div className="confirmation-block">
                <h3>Tracking</h3>
                <p className="confirmation-status">Use the track page for live delivery updates.</p>
              </div>
            </div>
            <div className="confirmation-actions">
              <Link to={`/track/${t.orderNumber}`} className="btn btn-outline btn-lg">
                View Live Tracking
              </Link>
              <Link to="/" className="btn btn-ghost btn-lg">
                Back to Home
              </Link>
            </div>
          </Reveal>
        </div>
      </div>
    );
  }

  // Needs verification: param exists but no matching lastOrder
  if (needsVerification) {
    return (
      <div className="page-container confirmation-page">
        <div className="container">
          <Reveal className="confirmation-card">
            <h1 className="confirmation-title">Verify Your Order</h1>
            <p className="confirmation-status">Enter the phone number used at checkout to view order <strong>{paramOrderNumber}</strong>.</p>
            <form className="track-form" onSubmit={handleVerify} style={{ marginTop: 16 }}>
              <div className="track-field">
                <label htmlFor="confirm-order-number">Order Number</label>
                <input id="confirm-order-number" type="text" value={paramOrderNumber} readOnly />
              </div>
              <div className="track-field">
                <label htmlFor="confirm-phone">Phone Number</label>
                <input
                  id="confirm-phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Enter phone number used at checkout"
                  required
                />
              </div>
              {error && <p className="track-error" role="alert">{error}</p>}
              <button className="btn btn-primary btn-lg" type="submit" disabled={verifying}>
                {verifying ? "Verifying…" : "View Order"}
              </button>
            </form>
            <div className="confirmation-actions" style={{ marginTop: 16 }}>
              <Link to="/track" className="btn btn-ghost btn-lg">
                Track another order
              </Link>
              <Link to="/" className="btn btn-ghost btn-lg">
                Back to Home
              </Link>
            </div>
          </Reveal>
        </div>
      </div>
    );
  }

  // Fallback: should not reach here, but show not-found instead of redirecting to POS
  return (
    <div className="page-container confirmation-page">
      <div className="container">
        <Reveal className="confirmation-card">
          <h1 className="confirmation-title">Order Not Found</h1>
          <p className="confirmation-status">We could not find order {paramOrderNumber || ""}. Please check the order number.</p>
          <div className="confirmation-actions">
            <Link to="/track" className="btn btn-outline btn-lg">
              Track order
            </Link>
            <Link to="/" className="btn btn-primary btn-lg">
              Back to Home
            </Link>
          </div>
        </Reveal>
      </div>
    </div>
  );
}
