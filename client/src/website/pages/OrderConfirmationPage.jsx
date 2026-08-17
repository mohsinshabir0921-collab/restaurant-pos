import { Link, Navigate } from "react-router-dom";
import { useOrder } from "../context/OrderContext";
import { useWebsite } from "../context/WebsiteContext";
import { formatPrice } from "../components/common";
import Reveal from "../components/Reveal";
import { useEffect } from "react";

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
  const { lastOrder } = useOrder();
  const { restaurantName } = useWebsite();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  if (!lastOrder) {
    return <Navigate to="/" replace />;
  }

  const order = lastOrder;
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
                {order.items?.map((item, index) => (
                  <li key={index} className="confirmation-item">
                    <span className="confirmation-item-qty">{item.qty}×</span>
                    <span className="confirmation-item-name">{item.name}</span>
                    <span className="confirmation-item-price">{formatPrice(item.price * item.qty)}</span>
                  </li>
                ))}
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