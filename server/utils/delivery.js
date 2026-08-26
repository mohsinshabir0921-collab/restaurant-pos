const Settings = require("../models/Settings");

// Progressive website delivery pricing:
//   First 5 km: ₹10/km, then ₹15/km beyond (progressive).
//   3 km = 30, 5 km = 50, 6 km = 65, 8 km = 95, 10 km = 125.
const calculateDeliveryFee = (distanceKm) => {
  const km = Number(distanceKm);
  if (!Number.isFinite(km) || km <= 0) return 0;
  const fee = Math.min(km, 5) * 10 + Math.max(0, km - 5) * 15;
  return Math.round(fee);
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
};
