const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const mongoose = require("mongoose");

const MenuItem = require("../models/MenuItem");
const Settings = require("../models/Settings");
const User = require("../models/User");

const { createOrder, calculateTax, calculateServiceCharge, applyCoupon } = require("../controllers/orderController");
const { validateCoupon } = require("../controllers/couponController");
const { getPublicActive } = require("../controllers/bannerController");
const {
  createCashfreeOrder,
  verifyCashfreePayment,
  createAdditionalCashfreeOrder,
  verifyAdditionalCashfreePayment,
  resolveOrderByAdditionalPaymentToken,
  getAdditionalPaymentLinkInfo,
} = require("../controllers/paymentController");
const { getPublicOrderTracking, getPublicRecentOrders } = require("../controllers/deliveryController");
const { calculateDeliveryFee, getBaseDeliveryFee, getMaxDeliveryKm, MIN_DELIVERY_ORDER_VALUE } = require("../utils/delivery");
const { isRestaurantOpenNow } = require("../utils/openingHours");
const { handleError } = require("../utils/httpError");

// ---------------------------------------------------------------------------
// Public website backend.
//
// These endpoints expose a safe, read-mostly subset of the existing POS API to
// the public restaurant website. All heavy logic is delegated to the shared
// POS controllers (orderController / couponController / paymentController) so
// there is no second order system and no duplicated backend logic. The only
// additions here are:
//   - a dedicated "Website Orders" staff user so shared logic that records a
//     `createdBy` / `collectedBy` / stock movement author still has a valid
//     user reference (StockMovement.createdBy is required),
//   - server-side validation of menu items/prices/modifiers against the menu
//     catalogue so the public (untrusted) client cannot tamper with prices.
// ---------------------------------------------------------------------------

const WEBSITE_USER_EMAIL = "website-orders@khyennchyenn.local";
let websiteUserCache = null;

const getWebsiteUser = async () => {
  if (websiteUserCache) return websiteUserCache;

  let user = await User.findOne({ email: WEBSITE_USER_EMAIL });
  if (!user) {
    user = await User.create({
      name: "Website Orders",
      email: WEBSITE_USER_EMAIL,
      password: crypto.randomBytes(24).toString("hex"),
      role: "cashier",
      isActive: true,
    });
  } else if (!user.isActive) {
    user.isActive = true;
    await user.save();
  }

  websiteUserCache = user;
  return user;
};

// Injects the website system user so shared POS controllers that expect an
// authenticated user (createdBy, stock movements, collectedBy) work unchanged.
const attachWebsiteUser = async (req, res, next) => {
  try {
    req.user = await getWebsiteUser();
    // Marks a request as coming from the public (unauthenticated customer)
    // website flow, so shared controllers can apply customer-facing security
    // checks (e.g. phone ownership) without breaking the POS staff flow.
    req.publicRequest = true;
    next();
  } catch (error) {
    return handleError(res, error);
  }
};

// Resolves an existing customer id from a phone number (used to feed
// customer-state-dependent coupon checks: first order, tags, per-customer
// usage). A phone with no matching record represents a brand-new customer, so
// we return null (coupon checks then treat them as a first-time, tag-less
// customer). We never create a customer record just from a preview/validate.
const resolveCustomerIdByPhone = async (phone) => {
  if (!phone || !String(phone).trim()) return null;
  const Customer = require("../models/Customer");
  const existing = await Customer.getByPhone(String(phone).trim());
  return existing ? String(existing._id) : null;
};

// Validates cart items against the menu catalogue and rebuilds them with
// authoritative data (name, price, isVeg, taxRate, category, modifier prices).
const validateAndBuildItems = async (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    const error = new Error("Items are required");
    error.status = 400;
    throw error;
  }

  const ids = items
    .map((item) => item.menuItemId)
    .filter((id) => id && mongoose.Types.ObjectId.isValid(id));

  const dbItems = await MenuItem.find({ _id: { $in: ids } })
    .populate("category", "_id name")
    .lean();
  const dbMap = new Map(dbItems.map((item) => [String(item._id), item]));

  return items.map((raw) => {
    if (!raw.menuItemId || !mongoose.Types.ObjectId.isValid(raw.menuItemId)) {
      const error = new Error("Each item must reference a valid menu item");
      error.status = 400;
      throw error;
    }

    const dbItem = dbMap.get(String(raw.menuItemId));
    if (!dbItem) {
      const error = new Error("Menu item not found");
      error.status = 400;
      throw error;
    }
    if (!dbItem.isAvailable) {
      const error = new Error(`${dbItem.name} is currently unavailable`);
      error.status = 400;
      throw error;
    }

    const qty = Number(raw.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      const error = new Error(`Invalid quantity for ${dbItem.name}`);
      error.status = 400;
      throw error;
    }

    const modifiers = [];
    if (Array.isArray(raw.modifiers)) {
      for (const selected of raw.modifiers) {
        const group = (dbItem.modifiers || []).find((g) => g.name === selected.name);
        const option = group?.options?.find((o) => o.name === selected.option);
        if (!group || !option) {
          const error = new Error(`Invalid modifier for ${dbItem.name}`);
          error.status = 400;
          throw error;
        }
        modifiers.push({ name: group.name, option: option.name, price: option.price });
      }
    }

    return {
      menuItemId: dbItem._id,
      name: dbItem.name,
      // Base price + any selected modifier/size deltas (e.g. Half/Full, R/M/L/XL).
      price: dbItem.price + modifiers.reduce((sum, m) => sum + (Number(m.price) || 0), 0),
      qty,
      isVeg: dbItem.isVeg,
      taxRate: dbItem.taxRate || 0,
      categoryId: dbItem.category?._id || null,
      category: dbItem.category?.name || "",
      modifiers,
      notes: typeof raw.notes === "string" ? raw.notes.trim() : "",
    };
  });
};

// Sanitizes and locks down an incoming website order before delegating to the
// shared createOrder controller.
const validatePublicOrder = async (req, res, next) => {
  try {
    const { orderType = "takeaway", paymentMethod = "cash" } = req.body;

    if (!["takeaway", "delivery"].includes(orderType)) {
      return res.status(400).json({
        success: false,
        message: "Online orders support takeaway and delivery only",
      });
    }
    if (!["cash", "upi", "cod"].includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment method",
      });
    }
    if (paymentMethod === "cod" && orderType !== "delivery") {
      return res.status(400).json({
        success: false,
        message: "Cash on Delivery is only available for delivery orders",
      });
    }

    // --- Server-side availability + feature-toggle enforcement ---------------
    // The frontend already hides disabled options, but these checks are the
    // authoritative gate so a direct API call cannot bypass a disabled feature.
    const onlineOrderingEnabled = await Settings.getValue("online_ordering_enabled", true);
    if (onlineOrderingEnabled === false) {
      return res.status(403).json({
        success: false,
        message: "The restaurant is not accepting online orders at the moment",
      });
    }
    const openingHoursValue = await Settings.getValue("opening_hours", null);
    if (!isRestaurantOpenNow(openingHoursValue)) {
      return res.status(403).json({
        success: false,
        message: "The restaurant is currently closed for online orders",
      });
    }

    const websiteEnabled = await Settings.getValue("website_enabled", true);
    if (!websiteEnabled) {
      return res.status(403).json({
        success: false,
        message: "Online ordering is currently disabled",
      });
    }

    const [deliveryEnabled, takeawayEnabled, cashEnabled, onlineEnabled] = await Promise.all([
      Settings.getValue("delivery_enabled", true),
      Settings.getValue("takeaway_enabled", true),
      Settings.getValue("cash_payment_enabled", true),
      Settings.getValue("online_payment_enabled", true),
    ]);
    if (orderType === "delivery" && !deliveryEnabled) {
      return res.status(400).json({ success: false, message: "Delivery orders are currently disabled" });
    }
    if (orderType === "takeaway" && !takeawayEnabled) {
      return res.status(400).json({ success: false, message: "Takeaway orders are currently disabled" });
    }
    if ((paymentMethod === "cod" || paymentMethod === "cash") && !cashEnabled) {
      return res.status(400).json({ success: false, message: "Cash payment is currently disabled" });
    }
    if (paymentMethod === "upi" && !onlineEnabled) {
      return res.status(400).json({ success: false, message: "Online payment is currently disabled" });
    }

    const cleanItems = await validateAndBuildItems(req.body.items);
    const subtotal = cleanItems.reduce((sum, item) => sum + item.price * item.qty, 0);

    // Apply any promo code up front so delivery eligibility can use the final
    // payable order value (after discount, before delivery fee). The shared
    // createOrder controller re-applies the coupon, so this is purely for
    // validation gating on the public website.
    let couponDiscount = 0;
    const couponCode = req.body.couponCode;
    if (couponCode && String(couponCode).trim()) {
      const customerId = await resolveCustomerIdByPhone(req.body.customerPhone);
      const couponResult = await applyCoupon(String(couponCode).trim(), subtotal, orderType, customerId, "online", cleanItems);
      couponDiscount = couponResult.discount;
    }
    const finalOrderValue = subtotal - couponDiscount;

    let deliveryFee = 0;
    let deliveryDistanceKm = 0;
    if (orderType === "delivery") {
      const address = req.body.deliveryAddress;
      if (
        !address ||
        !String(address.line1 || "").trim() ||
        !String(address.city || "").trim() ||
        !String(address.state || "").trim()
      ) {
        return res.status(400).json({
          success: false,
          message: "A complete delivery address is required",
        });
      }
      if (!String(req.body.customerPhone || "").trim()) {
        return res.status(400).json({
          success: false,
          message: "Phone number is required for delivery",
        });
      }
      // Delivery distance is provided by the customer in kilometres and is the
      // single source of truth for the fee. The server still validates it and
      // applies the configured base/minimum fee (delivery_fee) as a floor.
      const distanceKm = Number(address.distanceKm);
      if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
        return res.status(400).json({
          success: false,
          message: "Delivery distance (km) is required",
        });
      }
      // Delivery eligibility is gated on the final payable order value (after
      // discount, before delivery fee). We never silently clamp the distance;
      // instead we reject with a clear instruction to the customer.
      if (finalOrderValue < MIN_DELIVERY_ORDER_VALUE) {
        return res.status(400).json({
          success: false,
          message: `Delivery requires a minimum order value of ₹${MIN_DELIVERY_ORDER_VALUE}`,
        });
      }
      const maxKm = getMaxDeliveryKm(finalOrderValue);
      if (distanceKm > maxKm) {
        return res.status(400).json({
          success: false,
          message: `Your order value allows delivery within ${maxKm} km. Please add more items or choose a nearer delivery address.`,
        });
      }
      const baseFee = await getBaseDeliveryFee();
      deliveryFee = Math.max(baseFee, calculateDeliveryFee(distanceKm));
      deliveryDistanceKm = distanceKm;
      req.body.deliveryAddress = {
        line1: String(address.line1).trim(),
        line2: String(address.line2 || "").trim() || undefined,
        city: String(address.city).trim(),
        state: String(address.state).trim(),
        pincode: String(address.pincode || "").trim() || undefined,
        distanceKm: deliveryDistanceKm,
      };
    }

    // Overwrite anything the client should not control.
    req.body.items = cleanItems;
    req.body.source = "online";
    req.body.orderType = orderType;
    req.body.paymentMethod = paymentMethod;
    req.body.deliveryFee = deliveryFee;
    req.body.deliveryDistanceKm = deliveryDistanceKm;
    req.body.tableId = null;
    req.body.tableNo = null;
    req.body.loyaltyPointsUsed = 0;
    req.body.discount = 0;
    delete req.body.splitPayments;

    next();
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }
    return handleError(res, error);
  }
};

// Returns the exact same price breakdown the shared order logic will apply,
// so the website can show an authoritative total before placing an order.
const getOrderEstimate = async (req, res) => {
  try {
    const { orderType = "takeaway", couponCode, deliveryAddress, customerPhone } = req.body;

    const cleanItems = await validateAndBuildItems(req.body.items);
    const subtotal = cleanItems.reduce((sum, item) => sum + item.price * item.qty, 0);

    let couponDiscount = 0;
    let coupon = null;
    let couponReason = null;
    if (couponCode && String(couponCode).trim()) {
      const customerId = await resolveCustomerIdByPhone(customerPhone);
      const result = await applyCoupon(String(couponCode).trim(), subtotal, orderType, customerId, "online", cleanItems);
      couponDiscount = result.discount;
      coupon = result.coupon;
      couponReason = result.reason;
    }

    const isInterState =
      deliveryAddress &&
      deliveryAddress.state &&
      deliveryAddress.state !== (await Settings.getValue("restaurant_state", ""));

    const { cgst, sgst, igst, totalTax } = await calculateTax(
      subtotal - couponDiscount,
      cleanItems,
      isInterState
    );
    const serviceCharge = await calculateServiceCharge(subtotal - couponDiscount);
    let deliveryFee = 0;
    let deliveryDistanceKm = 0;
    if (orderType === "delivery") {
      const distanceKm = Number(deliveryAddress?.distanceKm);
      if (Number.isFinite(distanceKm) && distanceKm > 0) {
        const finalOrderValue = subtotal - couponDiscount;
        if (finalOrderValue < MIN_DELIVERY_ORDER_VALUE) {
          return res.status(400).json({
            success: false,
            message: `Delivery requires a minimum order value of ₹${MIN_DELIVERY_ORDER_VALUE}`,
          });
        }
        const maxKm = getMaxDeliveryKm(finalOrderValue);
        if (distanceKm > maxKm) {
          return res.status(400).json({
            success: false,
            message: `Your order value allows delivery within ${maxKm} km. Please add more items or choose a nearer delivery address.`,
          });
        }
        const baseFee = await getBaseDeliveryFee();
        deliveryDistanceKm = distanceKm;
        deliveryFee = Math.max(baseFee, calculateDeliveryFee(distanceKm));
      }
    }

    let total = subtotal - couponDiscount + totalTax + serviceCharge + deliveryFee;
    total = Math.round(total);

    return res.status(200).json({
      success: true,
      estimate: {
        subtotal: Math.round(subtotal * 100) / 100,
        couponDiscount: Math.round(couponDiscount * 100) / 100,
        coupon: coupon
          ? { code: coupon.code, name: coupon.name, discount: Math.round(couponDiscount * 100) / 100 }
          : null,
        couponReason,
        tax: totalTax,
        cgst,
        sgst,
        igst,
        serviceCharge,
        deliveryFee,
        deliveryDistanceKm,
        total,
      },
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }
    return handleError(res, error);
  }
};

router.post("/orders", validatePublicOrder, attachWebsiteUser, createOrder);
router.get("/orders/recent", getPublicRecentOrders);
router.get("/orders/:orderNumber/track", getPublicOrderTracking);
router.post("/order-estimate", getOrderEstimate);
router.get("/banners", getPublicActive);
router.get("/coupons/validate", (req, res, next) => {
  // Public website promo validation is subject to the bulk-order promo floor.
  req.query = req.query || {};
  req.query.context = "online";
  return validateCoupon(req, res);
});
router.post("/payment/create-order", attachWebsiteUser, createCashfreeOrder);
router.post("/payment/verify", attachWebsiteUser, verifyCashfreePayment);
// Public additional-payment entry points. The customer reaches these either
// through a shareable payment link (/pay/:token, resolved server-side by the
// token) or through the legacy track page (order number + phone). In both cases
// the shared createAdditionalCashfreeOrder / verifyAdditionalCashfreePayment
// controllers are reused unchanged; the public ownership guard in
// paymentController accepts the token OR the phone match before any session is
// created or verified. The amount is always server-derived
// (order.additionalAmountDue), never taken from the client.
//
// GET /payment/link/:token returns only the order number + outstanding amount
// (no phone, customer data, or internal ids) so the customer page can render.
router.get(
  "/payment/link/:token",
  attachWebsiteUser,
  (req, res) => getAdditionalPaymentLinkInfo(req, res)
);
router.post(
  "/payment/create-additional-order",
  attachWebsiteUser,
  async (req, res) => {
    try {
      const token = String(req.body.token || "").trim();
      if (token) {
        const order = await resolveOrderByAdditionalPaymentToken(token);
        if (!order) {
          return res.status(404).json({ success: false, message: "Invalid or expired payment link" });
        }
        req.body.orderId = String(order._id);
        req.body.token = token;
      } else {
        const order = await Order.findOne({
          orderNumber: String(req.body.orderNumber || req.body.orderId || "").trim(),
        });
        if (!order) {
          return res.status(404).json({ success: false, message: "Order not found" });
        }
        req.body.orderId = String(order._id);
      }
      return createAdditionalCashfreeOrder(req, res);
    } catch (error) {
      return handleError(res, error);
    }
  }
);
router.post(
  "/payment/verify-additional",
  attachWebsiteUser,
  async (req, res) => {
    try {
      const token = String(req.body.token || "").trim();
      if (token) {
        const order = await resolveOrderByAdditionalPaymentToken(token);
        if (!order) {
          return res.status(404).json({ success: false, message: "Invalid or expired payment link" });
        }
        req.body.orderId = String(order._id);
        req.body.token = token;
      }
      return verifyAdditionalCashfreePayment(req, res);
    } catch (error) {
      return handleError(res, error);
    }
  }
);

module.exports = router;
