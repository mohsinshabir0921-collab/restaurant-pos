const Settings = require("../models/Settings");

// Progressive website delivery pricing:
//   First 5 km: ₹10/km, then ₹15/km beyond (progressive).
//   3 km = 30, 5 km = 50, 6 km = 65, 8 km = 95, 10 km = 125.
// The absolute distance is capped at MAX_DELIVERY_KM (10 km).
const calculateDeliveryFee = (distanceKm) => {
  const km = Number(distanceKm);
  if (!Number.isFinite(km) || km <= 0) return 0;
  const capped = Math.min(km, MAX_DELIVERY_KM);
  const fee = Math.min(capped, 5) * 10 + Math.max(0, capped - 5) * 15;
  return Math.round(fee);
};

// Minimum order value (after discounts, before delivery fee) required to be
// eligible for delivery on the public website.
const MIN_DELIVERY_ORDER_VALUE = 200;

// Absolute maximum delivery radius, regardless of order value.
const MAX_DELIVERY_KM = 10;

// Maximum allowed delivery radius (km) for a given final payable order value
// (after discount, before delivery fee). Returns 0 when the order value is
// below the delivery eligibility threshold (MIN_DELIVERY_ORDER_VALUE).
const getMaxDeliveryKm = (orderValue) => {
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

// Configurable base/minimum delivery fee. Admins set `delivery_fee` in
// Settings; it acts as a floor so the final fee is never below this amount,
// while the distance-based progressive fee still applies for longer distances.
// A value of 0 (the default) preserves the existing pure distance-based pricing
// and is not surfaced as a separate "flat fee".
const getBaseDeliveryFee = async () => {
  const value = await Settings.getValue("delivery_fee", 0);
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

module.exports = {
  calculateDeliveryFee,
  getBaseDeliveryFee,
  getMaxDeliveryKm,
  MIN_DELIVERY_ORDER_VALUE,
  MAX_DELIVERY_KM,
};
