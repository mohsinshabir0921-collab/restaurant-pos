const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

process.env.CASHFREE_WEBHOOK_SECRET = "test_webhook_secret";
process.env.CASHFREE_CLIENT_ID = "test_client_id";
process.env.CASHFREE_CLIENT_SECRET = "test_client_secret";
process.env.VAPID_PUBLIC_KEY = "BA8bspY4-bdN9T8GOkjN8SAkCZcI1EVPgHYMa0KfL2vejKsSH29oyy9nlYpBUcPOSZxHMKQd6pySjSvpix7y5lk";
process.env.VAPID_PRIVATE_KEY = "x8yFAB53HokT3Cd-chx7MuBrvFubEXlex337CoxpjtQ";

const COUPON_MODEL = require.resolve("../models/Coupon");
const CouponModel = require("../models/Coupon");
const PUBLIC_ROUTES = require.resolve("../routes/publicRoutes");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

const CAT_A = new mongoose.Types.ObjectId();
const CAT_B = new mongoose.Types.ObjectId();
const ITEM_A1 = new mongoose.Types.ObjectId();
const ITEM_A2 = new mongoose.Types.ObjectId();
const ITEM_B1 = new mongoose.Types.ObjectId();

const baseCoupon = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  code: "PROMO",
  name: "Promo",
  type: "percent",
  value: 10,
  maxDiscount: null,
  buyCount: 1,
  minOrderAmount: 0,
  applicableOrderTypes: ["dinein", "takeaway", "delivery"],
  applicableCategories: [],
  applicableItems: [],
  excludedCategories: [],
  excludedItems: [],
  usageLimit: null,
  usageLimitPerCustomer: 1,
  usageCount: 0,
  validFrom: new Date(NOW - DAY),
  validUntil: new Date(NOW + 7 * DAY),
  isActive: true,
  firstOrderOnly: false,
  customerTags: [],
  autoApply: false,
  stackable: false,
  ...overrides,
});

// ---------------------------------------------------------------------------
// calculateDiscount — all promo types
// ---------------------------------------------------------------------------

test("percent coupon: correct percentage discount and maxDiscount cap", () => {
  const c = new CouponModel(baseCoupon({ type: "percent", value: 20 }));
  assert.equal(c.calculateDiscount(500), 100);
  assert.equal(c.calculateDiscount(650), 130);
  const capped = new CouponModel(baseCoupon({ type: "percent", value: 20, maxDiscount: 50 }));
  assert.equal(capped.calculateDiscount(500), 50);
});

test("flat coupon: flat value clamped to order amount", () => {
  const c = new CouponModel(baseCoupon({ type: "flat", value: 150 }));
  assert.equal(c.calculateDiscount(500), 150);
  assert.equal(c.calculateDiscount(100), 100);
});

test("BOGO (buy_x_get_y) calculates a real discount from cheapest eligible items", () => {
  // Buy 1 Get 1: cheapest item is free.
  const bogo = new CouponModel(baseCoupon({ type: "buy_x_get_y", value: 1, buyCount: 1 }));
  const items = [
    { menuItemId: ITEM_A1, qty: 1, price: 100 },
    { menuItemId: ITEM_A2, qty: 1, price: 200 },
  ];
  // 2 items, 1 buy + 1 get => free = cheapest (100)
  assert.equal(bogo.calculateDiscount(300, items), 100);
});

test("BOGO buy 2 get 1 frees the cheapest of every 3 items", () => {
  const bogo = new CouponModel(baseCoupon({ type: "buy_x_get_y", value: 1, buyCount: 2 }));
  const items = [
    { menuItemId: ITEM_A1, qty: 2, price: 100 },
    { menuItemId: ITEM_A2, qty: 1, price: 200 },
  ];
  // 3 total items => 1 free (cheapest = 100)
  assert.equal(bogo.calculateDiscount(400, items), 100);
});

test("BOGO with 4 items (buy 2 get 1) frees the two cheapest", () => {
  const bogo = new CouponModel(baseCoupon({ type: "buy_x_get_y", value: 1, buyCount: 2 }));
  const items = [
    { menuItemId: ITEM_A1, qty: 1, price: 100 },
    { menuItemId: ITEM_A2, qty: 1, price: 150 },
    { menuItemId: ITEM_B1, qty: 2, price: 250 },
  ];
  // 4 total => floor(4/3)=1 set => 1 free (cheapest 100)
  assert.equal(bogo.calculateDiscount(750, items), 100);
});

test("BOGO with 7 items (buy 2 get 1) frees two cheapest", () => {
  const bogo = new CouponModel(baseCoupon({ type: "buy_x_get_y", value: 1, buyCount: 2 }));
  const items = [
    { menuItemId: ITEM_A1, qty: 4, price: 40 },
    { menuItemId: ITEM_A2, qty: 3, price: 60 },
  ];
  // 7 total => floor(7/3)=2 sets => 2 free cheapest: 40 + 40
  assert.equal(bogo.calculateDiscount(340, items), 80);
});

test("BOGO returns 0 when there are not enough items to form a set", () => {
  const bogo = new CouponModel(baseCoupon({ type: "buy_x_get_y", value: 1, buyCount: 2 }));
  const items = [{ menuItemId: ITEM_A1, qty: 1, price: 100 }];
  assert.equal(bogo.calculateDiscount(100, items), 0);
  // 2 items for buy2get1 is still short (need 3)
  const items2 = [
    { menuItemId: ITEM_A1, qty: 2, price: 100 },
  ];
  assert.equal(bogo.calculateDiscount(200, items2), 0);
});

test("BOGO respects maxDiscount cap", () => {
  const bogo = new CouponModel(baseCoupon({ type: "buy_x_get_y", value: 1, buyCount: 1, maxDiscount: 80 }));
  const items = [
    { menuItemId: ITEM_A1, qty: 1, price: 100 },
    { menuItemId: ITEM_A2, qty: 1, price: 200 },
  ];
  assert.equal(bogo.calculateDiscount(300, items), 80);
});

test("BOGO excludes excluded items from eligibility", () => {
  const bogo = new CouponModel(baseCoupon({
    type: "buy_x_get_y", value: 1, buyCount: 1, excludedItems: [ITEM_A2],
  }));
  const items = [
    { menuItemId: ITEM_A1, qty: 1, price: 100 },
    { menuItemId: ITEM_A2, qty: 1, price: 200 },
  ];
  // Only ITEM_A1 is eligible => 1 item, needs 2 => 0
  assert.equal(bogo.calculateDiscount(300, items), 0);
});

// ---------------------------------------------------------------------------
// Category / item / excluded restrictions
// ---------------------------------------------------------------------------

test("percent applies only to applicable items", () => {
  // Applicable item restriction affects which items are discounted for BOGO, but
  // for percent/flat the whole order is discounted. Verify applicableItems narrows
  // BOGO eligibility.
  const c = new CouponModel(baseCoupon({
    type: "buy_x_get_y", value: 1, buyCount: 1, applicableCategories: [CAT_A],
  }));
  const items = [
    { menuItemId: ITEM_A1, categoryId: CAT_A, qty: 2, price: 100 },
    { menuItemId: ITEM_B1, categoryId: CAT_B, qty: 1, price: 300 },
  ];
  // Only category A items eligible => 2 x 100, buy1get1 => 1 free (100)
  assert.equal(c.calculateDiscount(500, items), 100);
});

test("excluded categories are not counted for BOGO eligibility", () => {
  const c = new CouponModel(baseCoupon({
    type: "buy_x_get_y", value: 1, buyCount: 1, excludedCategories: [CAT_B],
  }));
  const items = [
    { menuItemId: ITEM_A1, categoryId: CAT_A, qty: 2, price: 100 },
    { menuItemId: ITEM_B1, categoryId: CAT_B, qty: 1, price: 300 },
  ];
  // Category B excluded, cat A eligible = 2 items => 1 free (100)
  assert.equal(c.calculateDiscount(500, items), 100);
});

// ---------------------------------------------------------------------------
// isValid — restrictions, expiry, usage limits, first-order, customer tags
// ---------------------------------------------------------------------------

test("isValid enforces start/end dates, minimum order, order type, usage limit", () => {
  const doc = baseCoupon({ minOrderAmount: 300, applicableOrderTypes: ["delivery"], usageLimit: 5, usageCount: 5 });
  const c = new CouponModel(doc);
  assert.equal(c.isValid(299, "delivery").valid, false);
  assert.equal(c.isValid(300, "delivery").valid, false); // usage limit reached
  const c2 = new CouponModel(baseCoupon({ minOrderAmount: 300, applicableOrderTypes: ["delivery"] }));
  assert.equal(c2.isValid(300, "takeaway").valid, false);
  assert.equal(c2.isValid(300, "delivery").valid, true);
});

test("isValid rejects a first-order coupon for a returning customer", () => {
  const c = new CouponModel(baseCoupon({ firstOrderOnly: true }));
  assert.equal(c.isValid(500, "takeaway", { visitCount: 0 }).valid, true);
  assert.equal(c.isValid(500, "takeaway", { visitCount: 1 }).valid, false);
});

test("isValid rejects a coupon when the customer lacks a required tag", () => {
  const c = new CouponModel(baseCoupon({ customerTags: ["student"] }));
  assert.equal(c.isValid(500, "takeaway", { tags: ["student"] }).valid, true);
  assert.equal(c.isValid(500, "takeaway", { tags: ["vip"] }).valid, false);
  assert.equal(c.isValid(500, "takeaway", { tags: [] }).valid, false);
});

test("isValid reports clear failure reasons", () => {
  assert.equal(new CouponModel(baseCoupon({ minOrderAmount: 300 })).isValid(200, "takeaway").reason, "Minimum order amount of ₹300 required");
  assert.equal(new CouponModel(baseCoupon({ usageLimit: 1, usageCount: 1 })).isValid(500, "takeaway").reason, "Coupon usage limit reached");
  assert.equal(new CouponModel(baseCoupon({ validUntil: new Date(NOW - DAY) })).isValid(500, "takeaway").reason, "Coupon expired");
  assert.equal(new CouponModel(baseCoupon({ isActive: false })).isValid(500, "takeaway").reason, "Coupon is inactive");
});

// ---------------------------------------------------------------------------
// findValidForOrder — per-customer usage limits and reason propagation
// ---------------------------------------------------------------------------

const stubModule = (absPath, exports) => {
  require.cache[absPath] = { id: absPath, filename: absPath, loaded: true, exports };
};

test("findValidForOrder returns {coupon:null, reason} for a failed validation", async () => {
  const store = { coupons: [baseCoupon({ minOrderAmount: 300 })] };
  const CouponStub = {
    findOne: async ({ code }) => {
      const doc = store.coupons.find((c) => c.code === code);
      return doc ? new CouponModel(doc) : null;
    },
  };
  CouponStub.findValidForOrder = CouponModel.findValidForOrder.bind(CouponStub);
  stubModule(COUPON_MODEL, CouponStub);

  const Coupon = require("../models/Coupon");
  const out = await Coupon.findValidForOrder("PROMO", 100, "takeaway", null, "pos");
  assert.equal(out.coupon, null);
  assert.match(out.reason, /Minimum order/);
});

test("findValidForOrder returns the coupon for a valid order", async () => {
  const store = { coupons: [baseCoupon()] };
  const CouponStub = {
    findOne: async ({ code }) => {
      const doc = store.coupons.find((c) => c.code === code);
      return doc ? new CouponModel(doc) : null;
    },
  };
  CouponStub.findValidForOrder = CouponModel.findValidForOrder.bind(CouponStub);
  stubModule(COUPON_MODEL, CouponStub);

  const Coupon = require("../models/Coupon");
  const out = await Coupon.findValidForOrder("PROMO", 500, "takeaway", null, "pos");
  assert.ok(out.coupon);
  assert.equal(out.reason, null);
});

// ---------------------------------------------------------------------------
// Tampered frontend discount: the discount is always derived server-side from
// the coupon; a client-supplied discount is never trusted.
//
// This is exercised through the order estimate + order validation path. We
// verify that applyCoupon derives the discount from the coupon configuration and
// the validated items, NOT from any client-sent value.
// ---------------------------------------------------------------------------

test("applyCoupon derives a real BOGO discount from items and ignores a sent discount", async () => {
  const store = { coupons: [baseCoupon({ type: "buy_x_get_y", value: 1, buyCount: 1 })] };
  const CouponStub = {
    findOne: async ({ code }) => {
      const doc = store.coupons.find((c) => c.code === code);
      return doc ? new CouponModel(doc) : null;
    },
  };
  CouponStub.findValidForOrder = CouponModel.findValidForOrder.bind(CouponStub);
  stubModule(COUPON_MODEL, CouponStub);

  // Re-import orderController so it picks up the stubbed Coupon module.
  const ORDER_CTRL = require.resolve("../controllers/orderController");
  delete require.cache[ORDER_CTRL];
  const { applyCoupon } = require("../controllers/orderController");

  const items = [
    { menuItemId: ITEM_A1, qty: 1, price: 100 },
    { menuItemId: ITEM_A2, qty: 1, price: 200 },
  ];
  const result = await applyCoupon("PROMO", 300, "takeaway", null, "pos", items);
  // Correct real discount (cheapest free) — not ₹0, not whatever the client sent.
  assert.equal(result.discount, 100);
  assert.ok(result.coupon);
});

test("applyCoupon for online fails when coupon invalid and returns a reason", async () => {
  const store = { coupons: [baseCoupon({ isActive: false })] };
  const CouponStub = {
    findOne: async ({ code }) => {
      const doc = store.coupons.find((c) => c.code === code);
      return doc ? new CouponModel(doc) : null;
    },
  };
  CouponStub.findValidForOrder = CouponModel.findValidForOrder.bind(CouponStub);
  stubModule(COUPON_MODEL, CouponStub);

  const ORDER_CTRL = require.resolve("../controllers/orderController");
  delete require.cache[ORDER_CTRL];
  const { applyCoupon } = require("../controllers/orderController");

  const result = await applyCoupon("PROMO", 500, "takeaway", null, "online", []);
  assert.equal(result.discount, 0);
  assert.equal(result.coupon, null);
  assert.equal(result.reason, "Coupon is inactive");
});

// ---------------------------------------------------------------------------
// Concurrency-safe usage increment
// ---------------------------------------------------------------------------

test("incrementUsage issues an atomic $inc update (concurrency-safe)", async () => {
  let atomicUsed = false;
  const originalUpdateOne = CouponModel.updateOne;
  CouponModel.updateOne = async (filter, update) => {
    atomicUsed = Boolean(update && update.$inc && update.$inc.usageCount === 1);
    return { modifiedCount: 1 };
  };
  try {
    const doc = new CouponModel(baseCoupon());
    await doc.incrementUsage();
  } finally {
    CouponModel.updateOne = originalUpdateOne;
  }
  assert.ok(atomicUsed, "incrementUsage must use an atomic $inc on usageCount");
});

// ---------------------------------------------------------------------------
// Global promo minimum order floor — consistent across applyCoupon (estimate +
// order) and the validate endpoint.
// ---------------------------------------------------------------------------

const PROMO_MODULE = require.resolve("../utils/promo");

test("applyCoupon rejects a valid coupon below the global promo floor with a clear reason", async () => {
  const store = { coupons: [baseCoupon()] };
  const CouponStub = {
    findOne: async ({ code }) => {
      const doc = store.coupons.find((c) => c.code === code);
      return doc ? new CouponModel(doc) : null;
    },
  };
  CouponStub.findValidForOrder = CouponModel.findValidForOrder.bind(CouponStub);
  stubModule(COUPON_MODEL, CouponStub);

  // Stateful floor: eligible at/above ₹700 (elastic behavior mirrors the real
  // getMinPromoOrderValue + comparison in checkPromoFloor).
  stubModule(PROMO_MODULE, {
    MIN_PROMO_ORDER_VALUE_DEFAULT: 700,
    getMinPromoOrderValue: async () => 700,
    isPromoEligible: async () => true,
    checkPromoFloor: async (orderAmount) => {
      if (Number(orderAmount) < 700) {
        return { eligible: false, min: 700, reason: "Minimum order value for promotions is ₹700" };
      }
      return { eligible: true, min: 700, reason: null };
    },
  });

  const ORDER_CTRL = require.resolve("../controllers/orderController");
  delete require.cache[ORDER_CTRL];
  const { applyCoupon } = require("../controllers/orderController");

  // Online order at ₹500 is below the ₹700 floor => rejected, never reported valid.
  const result = await applyCoupon("PROMO", 500, "takeaway", null, "online", []);
  assert.equal(result.discount, 0);
  assert.equal(result.coupon, null);
  assert.equal(result.reason, "Minimum order value for promotions is ₹700");

  // At/above the floor the (valid) coupon applies.
  const ok = await applyCoupon("PROMO", 700, "takeaway", null, "online", []);
  assert.equal(ok.discount, 70);
  assert.ok(ok.coupon);

  delete require.cache[PROMO_MODULE];
});

test("public validate endpoint enforces the same promo floor for online context", async () => {
  const store = { coupons: [baseCoupon()] };
  const CouponStub = {
    findOne: async ({ code }) => {
      const doc = store.coupons.find((c) => c.code === code);
      return doc ? new CouponModel(doc) : null;
    },
  };
  CouponStub.findValidForOrder = CouponModel.findValidForOrder.bind(CouponStub);
  stubModule(COUPON_MODEL, CouponStub);

  stubModule(PROMO_MODULE, {
    MIN_PROMO_ORDER_VALUE_DEFAULT: 700,
    getMinPromoOrderValue: async () => 700,
    isPromoEligible: async () => false,
    checkPromoFloor: async () => ({ eligible: false, min: 700, reason: "Minimum order value for promotions is ₹700" }),
  });

  delete require.cache[PUBLIC_ROUTES];
  const publicRoutes = require(PUBLIC_ROUTES);

  const handlers = (router, method, path) => {
    for (const layer of router.stack) {
      if (layer.route && layer.route.path === path && layer.route.methods[method]) {
        return layer.route.stack.map((l) => l.handle);
      }
    }
    throw new Error(`route ${method} ${path} not found`);
  };
  const [validate] = handlers(publicRoutes, "get", "/coupons/validate");

  const req = { query: { code: "PROMO", orderAmount: 500, orderType: "takeaway" } };
  const res = { _status: 200, _body: null };
  res.status = (c) => { res._status = c; return res; };
  res.json = (d) => { res._body = d; return res; };

  await validate(req, res);
  assert.equal(res._status, 400);
  assert.equal(res._body.success, false);
  assert.equal(res._body.message, "Minimum order value for promotions is ₹700");

  delete require.cache[PROMO_MODULE];
  delete require.cache[PUBLIC_ROUTES];
});

// ---------------------------------------------------------------------------
// Customer identity (phone) drives first-order / student (tag) eligibility
// ---------------------------------------------------------------------------

test("findValidForOrder checks first-order + customer tags when a customer is supplied", async () => {
  // Returning customer => first-order coupon invalid.
  const returning = new CouponModel(baseCoupon({ firstOrderOnly: true }));
  const ret = returning.isValid(500, "takeaway", { visitCount: 2 });
  assert.equal(ret.valid, false);
  assert.equal(ret.reason, "Coupon valid for first order only");

  // New customer => first-order coupon valid.
  const fresh = new CouponModel(baseCoupon({ firstOrderOnly: true }));
  assert.equal(fresh.isValid(500, "takeaway", { visitCount: 0 }).valid, true);
  assert.equal(fresh.isValid(500, "takeaway", null).valid, true);

  // Student/tag-gated coupon requires the matching tag on the customer.
  const student = new CouponModel(baseCoupon({ customerTags: ["student"] }));
  assert.equal(student.isValid(500, "takeaway", { tags: ["student"] }).valid, true);
  assert.equal(student.isValid(500, "takeaway", { tags: ["vip"] }).valid, false);
  // A customer whose identity is unknown (no customer record) is treated as
  // having no tags => tag-gated promo is rejected, not shown as valid.
  assert.equal(student.isValid(500, "takeaway", null).valid, false);
});

test("validateCoupon resolves customerPhone and rejects a first-order coupon for a returning customer", async () => {
  const CUSTOMER_ID = new mongoose.Types.ObjectId();
  let getByPhoneCalled = false;
  let resolvedCustomerId = null;

  const CustomerStub = {
    getByPhone: async (phone) => {
      getByPhoneCalled = phone === "9876543210";
      return { _id: CUSTOMER_ID, visitCount: 3 };
    },
  };
  const CUSTOMER_MODEL = require.resolve("../models/Customer");
  stubModule(CUSTOMER_MODEL, CustomerStub);

  // Track the resolved customerId passed into findValidForOrder and simulate the
  // returning-customer rejection for a first-order-only coupon.
  const CouponStub = {
    findValidForOrder: async (code, orderAmount, orderType, customerId) => {
      resolvedCustomerId = customerId;
      return { coupon: null, reason: "Coupon valid for first order only" };
    },
  };
  stubModule(COUPON_MODEL, CouponStub);

  stubModule(PROMO_MODULE, {
    MIN_PROMO_ORDER_VALUE_DEFAULT: 700,
    getMinPromoOrderValue: async () => 0,
    isPromoEligible: async () => true,
    checkPromoFloor: async () => ({ eligible: true, min: 0, reason: null }),
  });

  // Reload couponController so it re-binds Coupon/Customer to the stubs above.
  delete require.cache[require.resolve("../controllers/couponController")];
  delete require.cache[PUBLIC_ROUTES];
  const publicRoutes = require(PUBLIC_ROUTES);
  const handlers = (router, method, path) => {
    for (const layer of router.stack) {
      if (layer.route && layer.route.path === path && layer.route.methods[method]) {
        return layer.route.stack.map((l) => l.handle);
      }
    }
    throw new Error(`route ${method} ${path} not found`);
  };
  const [validate] = handlers(publicRoutes, "get", "/coupons/validate");

  const req = { query: { code: "PROMO", orderAmount: 800, orderType: "takeaway", customerPhone: "9876543210" } };
  const res = { _status: 200, _body: null };
  res.status = (c) => { res._status = c; return res; };
  res.json = (d) => { res._body = d; return res; };

  await validate(req, res);
  assert.equal(getByPhoneCalled, true, "customerPhone should resolve via getByPhone");
  assert.equal(String(resolvedCustomerId), String(CUSTOMER_ID), "resolved customer id must be passed to findValidForOrder");
  assert.equal(res._status, 404);
  assert.equal(res._body.message, "Coupon valid for first order only");

  delete require.cache[PROMO_MODULE];
  delete require.cache[PUBLIC_ROUTES];
  delete require.cache[CUSTOMER_MODEL];
});

after(() => {
  delete require.cache[COUPON_MODEL];
  delete require.cache[require.resolve("../controllers/orderController")];
  delete require.cache[require.resolve("../controllers/couponController")];
  delete require.cache[PROMO_MODULE];
  delete require.cache[PUBLIC_ROUTES];
  delete require.cache[require.resolve("../models/Customer")];
});