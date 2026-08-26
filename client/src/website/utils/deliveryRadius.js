// Delivery-radius rules for the public website, mirrored exactly from the
// backend (server/utils/delivery.js) so the client-side fallback estimate and
// form validation stay consistent with the server's authoritative checks.
//
// Radius is gated on the FINAL payable order value: subtotal minus any coupon
// discount, BEFORE the delivery fee is added. The backend is still the single
// source of truth for the actual order; this module only powers the client
// fallback/UX gating when the server estimate is unavailable or rejected.

// Minimum order value (after discounts, before delivery fee) required to be
// eligible for delivery on the public website.
export const MIN_DELIVERY_ORDER_VALUE = 200;

// Absolute maximum delivery radius, regardless of order value.
export const MAX_DELIVERY_KM = 10;

// Progressive delivery fee (₹10/km for the first 5 km, then ₹15/km beyond),
// mirroring the backend's calculateDeliveryFee. Capped at MAX_DELIVERY_KM.
//   1 km = ₹10, 5 km = ₹50, 6 km = ₹65, 8 km = ₹95, 10 km = ₹125.
export const calculateDeliveryFee = (distanceKm) => {
  const km = Number(distanceKm);
  if (!Number.isFinite(km) || km <= 0) return 0;
  const capped = Math.min(km, MAX_DELIVERY_KM);
  return Math.round(Math.min(capped, 5) * 10 + Math.max(0, capped - 5) * 15);
};

// Maximum allowed delivery radius (km) for a given final payable order value
// (after discount, before delivery fee). Returns 0 when the order value is
// below the delivery eligibility threshold.
export const getMaxDeliveryKm = (orderValue) => {
  const v = Number(orderValue);
  if (!Number.isFinite(v) || v < MIN_DELIVERY_ORDER_VALUE) return 0;
  if (v <= 299) return 1;
  if (v <= 399) return 2;
  if (v <= 499) return 3;
  if (v <= 599) return 4;
  if (v <= 699) return 5;
  if (v <= 799) return 6;
  if (v <= 899) return 7;
  if (v <= 999) return 8;
  if (v <= 1099) return 9;
  return MAX_DELIVERY_KM;
};

// Validates a customer-entered delivery distance against the allowed radius
// for the order's final payable value (after coupon discount, before fee).
// Returns { valid, maxKm, entered, message? }.
export const getDeliveryDistanceValidation = (finalOrderValue, distanceKm) => {
  const km = Number(distanceKm);
  const maxKm = getMaxDeliveryKm(finalOrderValue);
  const entered = Number.isFinite(km) && km > 0;

  if (!entered) {
    return { valid: true, maxKm, entered: false };
  }
  if (maxKm === 0) {
    return {
      valid: false,
      maxKm: 0,
      entered: true,
      message: `Delivery requires a minimum order value of ₹${MIN_DELIVERY_ORDER_VALUE}.`,
    };
  }
  if (km > maxKm) {
    return {
      valid: false,
      maxKm,
      entered: true,
      message: `Delivery is available only up to ${maxKm} km for this order.`,
    };
  }
  return { valid: true, maxKm, entered: true };
};
