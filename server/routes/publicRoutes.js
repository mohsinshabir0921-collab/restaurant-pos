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
const { createCashfreeOrder, verifyCashfreePayment } = require("../controllers/paymentController");
const { getPublicOrderTracking, getPublicRecentOrders } = require("../controllers/deliveryController");
const {
  getRestaurantCoordinates,
  computeDeliveryDistanceAndFee,
  computeDeliveryFeeForOrder,
} = require("../utils/delivery");
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
    next();
  } catch (error) {
    return handleError(res, error);
  }
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
    .populate("category", "name")
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
      price: dbItem.price,
      qty,
      isVeg: dbItem.isVeg,
      taxRate: dbItem.taxRate || 0,
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

    const cleanItems = await validateAndBuildItems(req.body.items);

    let deliveryFee = 0;
    let deliveryDistanceKm = 0;
    if (orderType === "delivery") {
      const address = req.body.deliveryAddress || {};
      // The customer's coordinates are the authoritative delivery location.
      // Only a house/flat/shop number is required as a human-readable drop
      // point; city/state/pincode are optional because they cannot be derived
      // without a geocoder and must never block an order.
      if (!String(address.line1 || "").trim()) {
        return res.status(400).json({
          success: false,
          message: "A house, flat, or shop number is required for delivery",
        });
      }
      if (!String(req.body.customerPhone || "").trim()) {
        return res.status(400).json({
          success: false,
          message: "Phone number is required for delivery",
        });
      }
      // The distance and delivery fee are always computed server-side from the
      // customer's coordinates and the restaurant's configured location. Any
      // client-supplied distanceKm / deliveryFee is ignored.
      const delivery = await computeDeliveryFeeForOrder({
        latitude: address.latitude,
        longitude: address.longitude,
      });
      deliveryFee = delivery.deliveryFee;
      deliveryDistanceKm = delivery.distanceKm;
      req.body.deliveryAddress = {
        line1: String(address.line1).trim(),
        line2: String(address.line2 || "").trim() || undefined,
        city: String(address.city || "").trim() || undefined,
        state: String(address.state || "").trim() || undefined,
        pincode: String(address.pincode || "").trim() || undefined,
        latitude: Number(address.latitude),
        longitude: Number(address.longitude),
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
    const { orderType = "takeaway", couponCode, deliveryAddress } = req.body;

    const cleanItems = await validateAndBuildItems(req.body.items);
    const subtotal = cleanItems.reduce((sum, item) => sum + item.price * item.qty, 0);

    let couponDiscount = 0;
    let coupon = null;
    if (couponCode && String(couponCode).trim()) {
      const result = await applyCoupon(String(couponCode).trim(), subtotal, orderType, null);
      couponDiscount = result.discount;
      coupon = result.coupon;
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
      const lat = Number(deliveryAddress?.latitude);
      const lng = Number(deliveryAddress?.longitude);
      const restaurant = await getRestaurantCoordinates();
      if (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180 &&
        restaurant
      ) {
        const delivery = computeDeliveryDistanceAndFee(lat, lng, restaurant);
        deliveryDistanceKm = delivery.distanceKm;
        deliveryFee = delivery.deliveryFee;
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
router.get("/coupons/validate", validateCoupon);
router.post("/payment/create-order", attachWebsiteUser, createCashfreeOrder);
router.post("/payment/verify", attachWebsiteUser, verifyCashfreePayment);

module.exports = router;
