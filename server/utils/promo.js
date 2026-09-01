const Settings = require("../models/Settings");

// Minimum order value required to use any promo code on the public website.
// Admin-configurable via Settings.min_promo_order_value; defaults to ₹700 so
// promo codes (bulk-order discounts) are only available once an order reaches
// the bulk threshold. POS/in-store coupons are not subject to this floor.
const MIN_PROMO_ORDER_VALUE_DEFAULT = 700;

const getMinPromoOrderValue = async () => {
  const v = Number(await Settings.getValue("min_promo_order_value", MIN_PROMO_ORDER_VALUE_DEFAULT));
  return Number.isFinite(v) && v > 0 ? v : 0;
};

// Returns true when a promo code may be considered for the given order value on
// the public website. `orderAmount` is the order value after discounts.
const isPromoEligible = async (orderAmount) => {
  const min = await getMinPromoOrderValue();
  return !(min > 0 && Number(orderAmount) < min);
};

// Unified promo-floor check used identically by the validate, estimate and
// order-creation flows so a coupon is never reported valid below the floor.
// Returns { eligible, min, reason }.
const checkPromoFloor = async (orderAmount) => {
  const min = await getMinPromoOrderValue();
  if (min > 0 && Number(orderAmount) < min) {
    return {
      eligible: false,
      min,
      reason: `Minimum order value for promotions is ₹${min}`,
    };
  }
  return { eligible: true, min, reason: null };
};

module.exports = {
  MIN_PROMO_ORDER_VALUE_DEFAULT,
  getMinPromoOrderValue,
  isPromoEligible,
  checkPromoFloor,
};
