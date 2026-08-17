import { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { useOrder } from "../context/OrderContext";
import { useWebsite } from "../context/WebsiteContext";
import { useToast } from "../context/ToastContext";
import { useEstimate } from "../hooks/useEstimate";
import { useCoupon } from "../hooks/useCoupon";
import { useCheckout } from "../hooks/useOrder";
import { formatPrice } from "../components/common";

const toDateInput = (date) => {
  const d = new Date(date);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
};

const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60000);

// Progressive delivery rate schedule published in the UI (first 5 km ₹10/km,
// then ₹15/km). The server calculates the distance and fee from the customer's
// detected location and remains the single source of truth for the final
// amount. These constants only render the published rate schedule as a hint.
const DELIVERY_RATE_FIRST_5_KM = 10;
const DELIVERY_RATE_AFTER_5_KM = 15;

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { cartItems, subtotal, isEmpty, unitPrice } = useCart();
  const { orderType, setOrderType, setLastOrder } = useOrder();
  const { settings, getSetting } = useWebsite();
  const { notify } = useToast();
  const { placeOrder, placing, error: placeError, clearError: clearPlaceError } = useCheckout();

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");

  // Takeaway
  const now = new Date();
  const minDate = toDateInput(now);
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("");

  // Delivery
  const [deliveryAddress, setDeliveryAddress] = useState({
    line1: "",
    line2: "",
    city: "",
    state: "",
    pincode: "",
  });

  // Detected customer coordinates (browser geolocation). Sent to the server,
  // which calculates the delivery distance and fee from these coordinates.
  const [customerLocation, setCustomerLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(null);

  const [orderNote, setOrderNote] = useState("");

  // Coupon
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const { validateCoupon, validating: couponValidating, error: couponError, clearError: clearCouponError } = useCoupon();

  // Payment
  const cashEnabled = settings.cash_payment_enabled !== false;
  const onlineEnabled = settings.online_payment_enabled !== false;
  const takeawayEnabled = settings.takeaway_enabled !== false;
  const deliveryEnabled = settings.delivery_enabled !== false;

  // If one order type is disabled in settings, force the other.
  const effectiveOrderType = !takeawayEnabled ? "delivery" : !deliveryEnabled ? "takeaway" : orderType;

  const paymentOptions = useMemo(() => {
    if (effectiveOrderType === "delivery") {
      const options = [];
      if (onlineEnabled) options.push({ value: "upi", label: "Pay Online (UPI / Card)", hint: "Secure payment via Razorpay" });
      if (cashEnabled) options.push({ value: "cod", label: "Cash on Delivery", hint: "Pay in cash when your order arrives" });
      return options;
    }
    const options = [];
    if (cashEnabled) options.push({ value: "cash", label: "Cash at Pickup", hint: "Pay when you collect your order" });
    if (onlineEnabled) options.push({ value: "upi", label: "Pay Online (UPI / Card)", hint: "Secure payment via Razorpay" });
    return options;
  }, [effectiveOrderType, cashEnabled, onlineEnabled]);

  const [paymentMethod, setPaymentMethod] = useState("");

  useEffect(() => {
    setPaymentMethod((prev) => {
      if (paymentOptions.some((opt) => opt.value === prev)) return prev;
      return paymentOptions[0]?.value || "";
    });
  }, [paymentOptions]);

  useEffect(() => {
    setAppliedCoupon(null);
    setCouponInput("");
    clearCouponError();
    clearPlaceError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderType]);

  // Location permission is only requested when the customer clicks the button.
  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setLocationError("Location detection is not supported by this browser");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCustomerLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        const message =
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Please allow location access to calculate your delivery fee."
            : err.code === err.POSITION_UNAVAILABLE
            ? "Your location is currently unavailable. Please try again."
            : err.code === err.TIMEOUT
            ? "Location detection timed out. Please try again."
            : "We couldn't detect your location. Please try again.";
        setLocationError(message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 }
    );
  };

  const deliveryState = deliveryAddress.state?.trim();
  const estimateEnabled = !isEmpty;

  const estimatePayloadDelivery = useMemo(
    () =>
      effectiveOrderType === "delivery"
        ? {
            ...deliveryAddress,
            state: deliveryState,
            ...(customerLocation
              ? { latitude: customerLocation.latitude, longitude: customerLocation.longitude }
              : {}),
          }
        : undefined,
    [effectiveOrderType, deliveryAddress, deliveryState, customerLocation]
  );

  const { estimate, loading: estimateLoading, error: estimateError } = useEstimate({
    items: cartItems,
    orderType: effectiveOrderType,
    couponCode: appliedCoupon?.code,
    deliveryAddress: estimatePayloadDelivery,
    enabled: estimateEnabled,
  });

  // Authoritative server breakdown when available. If the estimate cannot be
  // fetched, fall back to values already known on the client (cart prices).
  // The delivery fee is never estimated on the client: it is only shown when
  // the server calculates it from the detected location.
  const displayEstimate = useMemo(() => {
    if (estimate) return estimate;
    const couponDiscount = Number(appliedCoupon?.discount) || 0;
    return {
      subtotal,
      couponDiscount,
      coupon: appliedCoupon ? { code: appliedCoupon.code } : null,
      tax: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      serviceCharge: 0,
      deliveryFee: 0,
      deliveryDistanceKm: 0,
      total: subtotal - couponDiscount,
      estimateOnly: true,
    };
  }, [estimate, subtotal, appliedCoupon]);

  const couponOrderAmount = displayEstimate.subtotal;

  const handleApplyCoupon = useCallback(async () => {
    clearCouponError();
    const code = couponInput.trim();
    if (!code) return;
    const coupon = await validateCoupon(code, couponOrderAmount, effectiveOrderType);
    if (coupon) {
      setAppliedCoupon(coupon);
      notify("success", `Coupon ${coupon.code} applied`);
    }
  }, [couponInput, couponOrderAmount, effectiveOrderType, validateCoupon, clearCouponError, notify]);

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponInput("");
    clearCouponError();
  };

  const validateForm = () => {
    if (!customerName.trim()) return "Please enter your name";
    if (!customerPhone.trim()) return "Please enter your phone number";
    if (!/^[0-9+\-()\s]{8,15}$/.test(customerPhone.trim())) return "Please enter a valid phone number";
    if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim()))
      return "Please enter a valid email address";

    if (effectiveOrderType === "takeaway") {
      if (!pickupDate || !pickupTime) return "Please choose a pickup date and time";
      const pickup = new Date(`${pickupDate}T${pickupTime}`);
      if (isNaN(pickup.getTime()) || pickup.getTime() <= Date.now())
        return "Pickup date/time must be in the future";
    }

    if (effectiveOrderType === "delivery") {
      if (!deliveryAddress.line1.trim()) return "Please enter your street address";
      if (!deliveryAddress.city.trim()) return "Please enter your city";
      if (!deliveryState) return "Please enter your state";
      if (!customerLocation)
        return "Please use 'Use my current location' so we can calculate your delivery distance and fee";
    }

    if (!paymentMethod) return "Please choose a payment method";
    return null;
  };

  const buildPayload = () => {
    const pickupAt =
      effectiveOrderType === "takeaway" ? new Date(`${pickupDate}T${pickupTime}`).toISOString() : undefined;

    return {
      orderType: effectiveOrderType,
      paymentMethod,
      items: cartItems.map((item) => ({
        menuItemId: item.menuItemId,
        qty: item.qty,
        modifiers: item.modifiers || [],
        notes: item.notes || "",
      })),
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      customerEmail: customerEmail.trim() || undefined,
      pickupAt,
      deliveryAddress:
        effectiveOrderType === "delivery"
          ? {
              line1: deliveryAddress.line1.trim(),
              line2: deliveryAddress.line2.trim() || undefined,
              city: deliveryAddress.city.trim(),
              state: deliveryAddress.state.trim(),
              pincode: deliveryAddress.pincode.trim() || undefined,
              latitude: customerLocation.latitude,
              longitude: customerLocation.longitude,
            }
          : undefined,
      notes: orderNote.trim() || undefined,
      couponCode: appliedCoupon?.code || undefined,
    };
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    clearPlaceError();
    const validationError = validateForm();
    if (validationError) {
      notify("error", validationError);
      return;
    }

    const payload = buildPayload();
    const restaurantName = getSetting("restaurant_name", "Khyenn Chyenn");

    try {
      const order = await placeOrder({
        payload,
        razorpayPrefill: { name: customerName, email: customerEmail, phone: customerPhone },
        restaurantName,
      });
      setLastOrder(order);
      notify("success", `Order ${order.orderNumber} placed successfully`);
      navigate("/order-confirmation");
    } catch (err) {
      notify("error", err?.message || "Could not place your order. Please try again.");
    }
  };

  if (isEmpty) {
    return (
      <div className="page-container">
        <div className="container">
          <div className="empty-state">
            <span className="not-found-code" aria-hidden="true">🍽</span>
            <h2>Your cart is empty</h2>
            <p>Add some dishes before checking out.</p>
            <Link to="/menu" className="btn btn-primary">
              Browse Menu
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const handleOrderTypeChange = (type) => {
    setOrderType(type);
    clearPlaceError();
  };

  return (
    <div className="page-container checkout-page">
      <div className="page-hero">
        <p className="page-eyebrow">Almost There</p>
        <h1 className="page-title">Checkout</h1>
        <p className="page-subtitle">Confirm your details and place your order</p>
      </div>

      <div className="container">
        <form className="checkout-layout" onSubmit={handleSubmit} noValidate>
          <div className="checkout-main">
            <section className="checkout-section">
              <h2 className="checkout-section-title">
                <span className="step-number">1</span> Order Type
              </h2>
              <div className="order-type-options">
                {takeawayEnabled && (
                  <label className={`option-card ${effectiveOrderType === "takeaway" ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name="orderType"
                      value="takeaway"
                      checked={effectiveOrderType === "takeaway"}
                      onChange={() => handleOrderTypeChange("takeaway")}
                    />
                    <span className="option-icon" aria-hidden="true">🛍️</span>
                    <span className="option-label">
                      <strong>Takeaway</strong>
                      <small>Collect your order in-store</small>
                    </span>
                  </label>
                )}
                {deliveryEnabled && (
                  <label className={`option-card ${effectiveOrderType === "delivery" ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name="orderType"
                      value="delivery"
                      checked={effectiveOrderType === "delivery"}
                      onChange={() => handleOrderTypeChange("delivery")}
                    />
                    <span className="option-icon" aria-hidden="true">🛵</span>
                    <span className="option-label">
                      <strong>Delivery</strong>
                      <small>Get it delivered to your door</small>
                    </span>
                  </label>
                )}
              </div>
            </section>

            <section className="checkout-section">
              <h2 className="checkout-section-title">
                <span className="step-number">2</span> Your Details
              </h2>
              <div className="form-grid">
                <div className="form-field span-2">
                  <label htmlFor="customer-name">Full Name *</label>
                  <input
                    id="customer-name"
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="e.g. Priya Sharma"
                    autoComplete="name"
                    required
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="customer-phone">Phone Number *</label>
                  <input
                    id="customer-phone"
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="e.g. 9876543210"
                    autoComplete="tel"
                    required
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="customer-email">Email (optional)</label>
                  <input
                    id="customer-email"
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="e.g. you@example.com"
                    autoComplete="email"
                  />
                </div>
              </div>
            </section>

            {effectiveOrderType === "takeaway" && (
              <section className="checkout-section">
                <h2 className="checkout-section-title">
                  <span className="step-number">3</span> Pickup Details
                </h2>
                <div className="form-grid">
                  <div className="form-field">
                    <label htmlFor="pickup-date">Pickup Date *</label>
                    <input
                      id="pickup-date"
                      type="date"
                      value={pickupDate}
                      min={minDate}
                      onChange={(e) => setPickupDate(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="pickup-time">Pickup Time *</label>
                    <input
                      id="pickup-time"
                      type="time"
                      value={pickupTime}
                      min={
                        pickupDate === minDate
                          ? new Date(addMinutes(now, 20).getTime() - now.getTimezoneOffset() * 60000)
                              .toISOString()
                              .slice(11, 16)
                          : undefined
                      }
                      onChange={(e) => setPickupTime(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <p className="field-hint">Please allow at least 20 minutes for preparation.</p>
              </section>
            )}

            {effectiveOrderType === "delivery" && (
              <section className="checkout-section">
                <h2 className="checkout-section-title">
                  <span className="step-number">3</span> Delivery Address
                </h2>
                <div className="form-grid">
                  <div className="form-field span-2">
                    <label htmlFor="addr-line1">Street Address *</label>
                    <input
                      id="addr-line1"
                      type="text"
                      value={deliveryAddress.line1}
                      onChange={(e) => setDeliveryAddress((a) => ({ ...a, line1: e.target.value }))}
                      placeholder="House no, street, area"
                      autoComplete="address-line1"
                      required
                    />
                  </div>
                  <div className="form-field span-2">
                    <label htmlFor="addr-line2">Apartment / Landmark (optional)</label>
                    <input
                      id="addr-line2"
                      type="text"
                      value={deliveryAddress.line2}
                      onChange={(e) => setDeliveryAddress((a) => ({ ...a, line2: e.target.value }))}
                      placeholder="Flat, building, landmark"
                      autoComplete="address-line2"
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="addr-city">City *</label>
                    <input
                      id="addr-city"
                      type="text"
                      value={deliveryAddress.city}
                      onChange={(e) => setDeliveryAddress((a) => ({ ...a, city: e.target.value }))}
                      autoComplete="address-level2"
                      required
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="addr-state">State *</label>
                    <input
                      id="addr-state"
                      type="text"
                      value={deliveryAddress.state}
                      onChange={(e) => setDeliveryAddress((a) => ({ ...a, state: e.target.value }))}
                      placeholder="e.g. Delhi"
                      autoComplete="address-level1"
                      required
                    />
                  </div>
                  <div className="form-field span-2">
                    <label htmlFor="addr-pincode">PIN Code (optional)</label>
                    <input
                      id="addr-pincode"
                      type="text"
                      inputMode="numeric"
                      value={deliveryAddress.pincode}
                      onChange={(e) => setDeliveryAddress((a) => ({ ...a, pincode: e.target.value }))}
                      placeholder="e.g. 110001"
                      autoComplete="postal-code"
                    />
                  </div>
                  <div className="form-field span-2">
                    <label htmlFor="addr-distance">Delivery Location *</label>
                    <div className="location-detect">
                      <button
                        type="button"
                        className="btn btn-secondary btn-location"
                        onClick={handleUseMyLocation}
                        disabled={locating}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                          <circle cx="12" cy="10" r="3" />
                        </svg>
                        {locating ? "Detecting your location…" : "Use My Current Location"}
                      </button>
                      {customerLocation && !locating && (
                        <span className="location-detected">
                          {displayEstimate.deliveryDistanceKm
                            ? `Location detected · ${displayEstimate.deliveryDistanceKm} km from the restaurant`
                            : "Location detected"}
                        </span>
                      )}
                    </div>
                    {locationError && <p className="field-error">{locationError}</p>}
                  </div>
                </div>
                <p className="field-hint">
                  We use your location to calculate the delivery distance and fee
                  ({formatPrice(DELIVERY_RATE_FIRST_5_KM)}/km for the first 5 km, then {formatPrice(DELIVERY_RATE_AFTER_5_KM)}/km beyond).
                </p>
              </section>
            )}

            <section className="checkout-section">
              <h2 className="checkout-section-title">
                <span className="step-number">{effectiveOrderType === "takeaway" ? "4" : "4"}</span> Order Note
              </h2>
              <div className="form-field">
                <textarea
                  id="order-note"
                  className="notes-input"
                  rows="2"
                  value={orderNote}
                  onChange={(e) => setOrderNote(e.target.value)}
                  placeholder="Anything we should know? (optional)"
                  maxLength={300}
                />
              </div>
            </section>

            <section className="checkout-section">
              <h2 className="checkout-section-title">
                <span className="step-number">{effectiveOrderType === "takeaway" ? "5" : "5"}</span> Payment
              </h2>
              {paymentOptions.length === 0 ? (
                <p className="field-hint">No payment methods are currently available.</p>
              ) : (
                <div className="payment-options">
                  {paymentOptions.map((option) => (
                    <label key={option.value} className={`payment-option ${paymentMethod === option.value ? "selected" : ""}`}>
                      <input
                        type="radio"
                        name="paymentMethod"
                        value={option.value}
                        checked={paymentMethod === option.value}
                        onChange={() => setPaymentMethod(option.value)}
                      />
                      <span className="payment-option-label">
                        <strong>{option.label}</strong>
                        <small>{option.hint}</small>
                      </span>
                      {option.value === "upi" && <span className="payment-badge">Online</span>}
                      {option.value === "cod" && <span className="payment-badge">COD</span>}
                    </label>
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="checkout-summary">
            <h2 className="summary-title">Order Summary</h2>
            <ul className="summary-items">
              {cartItems.map((item) => (
                <li key={item.id} className="summary-item">
                  <span className="summary-item-qty">{item.qty}×</span>
                  <span className="summary-item-body">
                    <span className="summary-item-name">{item.name}</span>
                    <span className="summary-item-unit">{formatPrice(unitPrice(item))} each</span>
                  </span>
                  <span className="summary-item-price">{formatPrice(unitPrice(item) * item.qty)}</span>
                </li>
              ))}
            </ul>

            <div className="coupon-box">
              {appliedCoupon ? (
                <div className="applied-coupon">
                  <span className="applied-coupon-code">{appliedCoupon.code}</span>
                  <span className="applied-coupon-discount">−{formatPrice(appliedCoupon.discount || 0)}</span>
                  <button type="button" className="applied-coupon-remove" onClick={handleRemoveCoupon} aria-label="Remove coupon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ) : (
                <>
                  <div className="coupon-input-row">
                    <input
                      type="text"
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value)}
                      placeholder="Have a coupon? Enter code"
                      aria-label="Coupon code"
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleApplyCoupon}
                      disabled={couponValidating || !couponInput.trim()}
                    >
                      {couponValidating ? "…" : "Apply"}
                    </button>
                  </div>
                  {couponError && <p className="field-error">{couponError}</p>}
                </>
              )}
            </div>

            {estimateError && displayEstimate.estimateOnly && (
              <p className="estimate-warning">
                We couldn&apos;t verify the total right now. Showing an estimate — the final amount is confirmed when you place your order.
              </p>
            )}

            <dl className="summary-totals">
              <div className="summary-row">
                <dt>Subtotal</dt>
                <dd>{formatPrice(displayEstimate.subtotal)}</dd>
              </div>
              {displayEstimate.couponDiscount > 0 && (
                <div className="summary-row discount">
                  <dt>Coupon ({displayEstimate.coupon?.code})</dt>
                  <dd>−{formatPrice(displayEstimate.couponDiscount)}</dd>
                </div>
              )}
              {displayEstimate.serviceCharge > 0 && (
                <div className="summary-row">
                  <dt>Service Charge</dt>
                  <dd>{formatPrice(displayEstimate.serviceCharge)}</dd>
                </div>
              )}
              {displayEstimate.deliveryFee > 0 && (
                <div className="summary-row">
                  <dt>
                    Delivery Fee
                    {displayEstimate.deliveryDistanceKm ? ` (${displayEstimate.deliveryDistanceKm} km)` : ""}
                  </dt>
                  <dd>{formatPrice(displayEstimate.deliveryFee)}</dd>
                </div>
              )}
              {displayEstimate.tax > 0 && (
                <div className="summary-row">
                  <dt>Taxes (CGST {formatPrice(displayEstimate.cgst || 0)} + SGST {formatPrice(displayEstimate.sgst || 0)})
                    {displayEstimate.igst > 0 ? ` + IGST ${formatPrice(displayEstimate.igst)}` : ""}
                  </dt>
                  <dd>{formatPrice(displayEstimate.tax)}</dd>
                </div>
              )}
              <div className="summary-row grand-total">
                <dt>{displayEstimate.estimateOnly ? "Estimated Total" : "Total"}</dt>
                <dd>
                  {estimateLoading && !estimate ? (
                    <span className="total-loading">Calculating…</span>
                  ) : (
                    formatPrice(displayEstimate.total)
                  )}
                </dd>
              </div>
            </dl>

            {placeError && <p className="form-error">{placeError}</p>}

            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={placing || estimateLoading}>
              {placing ? "Placing order…" : paymentMethod === "upi" ? "Pay & Place Order" : "Place Order"}
            </button>
            <p className="summary-secure">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Your payment details are encrypted and secure.
            </p>
          </aside>
        </form>
      </div>
    </div>
  );
}