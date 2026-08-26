const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

process.env.CASHFREE_WEBHOOK_SECRET = "test_webhook_secret";
process.env.CASHFREE_CLIENT_ID = "test_client_id";
process.env.CASHFREE_CLIENT_SECRET = "test_client_secret";

const SETTINGS_MODEL = require.resolve("../models/Settings");
const MENU_MODEL = require.resolve("../models/MenuItem");
const USER_MODEL = require.resolve("../models/User");
const COUPON_MODEL = require.resolve("../models/Coupon");
const DELIVERY_UTIL = require.resolve("../utils/delivery");
const PROMO_UTIL = require.resolve("../utils/promo");
const PUBLIC_ROUTES = require.resolve("../routes/publicRoutes");

const stubModule = (absPath, exports) => {
  require.cache[absPath] = {
    id: absPath,
    filename: absPath,
    loaded: true,
    exports,
  };
};

// A single shared store object reused across every freshLoad() so that even
// module-level `require` references (e.g. the Settings capture inside
// utils/promo) point at the same store the tests mutate.
const sharedStore = { settings: {}, menuItems: [] };

const createStubs = () => {
  const store = sharedStore;
  store.settings = {};
  store.menuItems = [];

  const Settings = {
    getValue: async (key, defaultValue = null) =>
      store.settings[key] !== undefined ? store.settings[key] : defaultValue,
  };

  const MenuItem = {
    find: () => ({
      populate: () => ({
        lean: () => store.menuItems,
      }),
    }),
  };

  const User = {};

  // Minimal in-memory coupon that returns a flat ₹100 coupon for any code.
  const Coupon = {
    findValidForOrder: async (code) =>
      code
        ? {
            code,
            name: "Test Promo",
            type: "flat",
            value: 100,
            maxDiscount: 100,
            calculateDiscount: (amt) => Math.min(100, Number(amt)),
          }
        : null,
  };

  stubModule(SETTINGS_MODEL, Settings);
  stubModule(MENU_MODEL, MenuItem);
  stubModule(USER_MODEL, User);
  stubModule(COUPON_MODEL, Coupon);

  return { store, Settings, MenuItem, User, Coupon };
};

const freshLoad = () => {
  const stubs = createStubs();

  // Re-stub Coupon after clearing the cache so orderController/couponController
  // resolve to the in-memory stub (not the real Mongoose model, which would hit
  // the database). Also re-load the promo util so it re-captures the current
  // Settings stub (otherwise module-level require caching keeps a stale Settings
  // reference across freshLoad calls).
  delete require.cache[DELIVERY_UTIL];
  delete require.cache[PUBLIC_ROUTES];
  delete require.cache[PROMO_UTIL];
  stubModule(COUPON_MODEL, stubs.Coupon);

  const delivery = require(DELIVERY_UTIL);
  const publicRoutes = require(PUBLIC_ROUTES);

  return { ...stubs, delivery, publicRoutes };
};

const getRouteHandlers = (router, method, path) => {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack.map((l) => l.handle);
    }
  }
  throw new Error(`Route ${method} ${path} not found`);
};

const seedMenu = (store, price = 300) => {
  const itemId = new mongoose.Types.ObjectId();
  store.menuItems = [
    {
      _id: itemId,
      name: "Pizza",
      price,
      isAvailable: true,
      isVeg: true,
      taxRate: 5,
      category: null,
      modifiers: [],
    },
  ];
  return itemId;
};

const makeReq = (body) => ({ body });
const makeRes = () => {
  const res = { _status: 200, _body: undefined };
  res.status = function (code) {
    this._status = code;
    return this;
  };
  res.json = function (data) {
    this._body = data;
    return this;
  };
  return res;
};

// ---------------------------------------------------------------------------
// Distance + fee primitives
// ---------------------------------------------------------------------------

test("delivery fee follows the progressive schedule unchanged", () => {
  const { delivery } = freshLoad();
  assert.equal(delivery.calculateDeliveryFee(3), 30);
  assert.equal(delivery.calculateDeliveryFee(5), 50);
  assert.equal(delivery.calculateDeliveryFee(6), 65);
  assert.equal(delivery.calculateDeliveryFee(8), 95);
  assert.equal(delivery.calculateDeliveryFee(10), 125);
  assert.equal(delivery.calculateDeliveryFee(0), 0);
  assert.equal(delivery.calculateDeliveryFee(-1), 0);
  assert.equal(delivery.calculateDeliveryFee("4"), 40);
});

test("base delivery fee acts as a floor on the distance-based fee", async () => {
  const d = freshLoad();
  d.store.settings = { delivery_fee: 50 };
  assert.equal(await d.delivery.getBaseDeliveryFee(), 50);
  // 3 km → ₹30 but the base fee of ₹50 wins.
  assert.equal(Math.max(50, d.delivery.calculateDeliveryFee(3)), 50);
  // 8 km → ₹95, above the ₹50 floor.
  assert.equal(Math.max(50, d.delivery.calculateDeliveryFee(8)), 95);
});

test("getBaseDeliveryFee defaults to 0 (pure distance-based pricing)", async () => {
  const { delivery } = freshLoad();
  assert.equal(await delivery.getBaseDeliveryFee(), 0);
});

// ---------------------------------------------------------------------------
// validatePublicOrder: customer-supplied distanceKm is the source of truth
// ---------------------------------------------------------------------------

test("delivery order uses the customer-supplied distanceKm for fee and distance", async () => {
  const d = freshLoad();
  const [validatePublicOrder] = getRouteHandlers(d.publicRoutes, "post", "/orders");
  const itemId = seedMenu(d.store);

  const req = makeReq({
    orderType: "delivery",
    paymentMethod: "cod",
    customerName: "Test Customer",
    customerPhone: "9876543210",
    items: [{ menuItemId: String(itemId), qty: 1 }],
    deliveryAddress: {
      line1: "1 Main St",
      line2: "Near City Mall",
      city: "Delhi",
      state: "Delhi",
      pincode: "110001",
      distanceKm: 2,
    },
    deliveryFee: 999,
  });
  const res = makeRes();
  let nexted = false;
  await validatePublicOrder(req, res, () => {
    nexted = true;
  });

  assert.equal(nexted, true, "valid delivery order passes validation");
  assert.equal(req.body.deliveryFee, 20, "fee is recomputed from distanceKm (2 km = ₹20)");
  assert.equal(req.body.deliveryAddress.distanceKm, 2, "distanceKm is preserved");
  assert.equal(req.body.deliveryDistanceKm, 2);
  assert.equal(req.body.deliveryAddress.latitude, undefined, "no latitude is stored");
  assert.equal(req.body.deliveryAddress.longitude, undefined, "no longitude is stored");
  assert.equal(req.body.deliveryAddress.line1, "1 Main St");
  assert.equal(req.body.deliveryAddress.line2, "Near City Mall", "landmark is preserved");
  assert.equal(req.body.deliveryAddress.city, "Delhi");
  assert.equal(req.body.deliveryAddress.state, "Delhi");
});

test("delivery order is rejected when distanceKm is missing", async () => {
  const d = freshLoad();
  const [validatePublicOrder] = getRouteHandlers(d.publicRoutes, "post", "/orders");
  const itemId = seedMenu(d.store);

  const req = makeReq({
    orderType: "delivery",
    paymentMethod: "cod",
    customerPhone: "9876543210",
    items: [{ menuItemId: String(itemId), qty: 1 }],
    deliveryAddress: { line1: "1 Main St", city: "Delhi", state: "Delhi" },
  });
  const res = makeRes();
  await validatePublicOrder(req, res, () => {});
  assert.equal(res._status, 400);
  assert.match(res._body.message, /distance \(km\)/i);
});

test("delivery order requires city and state", async () => {
  const d = freshLoad();
  const [validatePublicOrder] = getRouteHandlers(d.publicRoutes, "post", "/orders");
  const itemId = seedMenu(d.store);

  const req = makeReq({
    orderType: "delivery",
    paymentMethod: "cod",
    customerPhone: "9876543210",
    items: [{ menuItemId: String(itemId), qty: 1 }],
    deliveryAddress: { line1: "12B, Rose Villa", distanceKm: 4, city: "", state: "" },
  });
  const res = makeRes();
  await validatePublicOrder(req, res, () => {});
  assert.equal(res._status, 400, "order is rejected without city/state");

  const okReq = makeReq({
    orderType: "delivery",
    paymentMethod: "cod",
    customerPhone: "9876543210",
    items: [{ menuItemId: String(itemId), qty: 1 }],
    deliveryAddress: { line1: "12B, Rose Villa", city: "Delhi", state: "Delhi", distanceKm: 2 },
  });
  const okRes = makeRes();
  let nexted = false;
  await validatePublicOrder(okReq, okRes, () => {
    nexted = true;
  });
  assert.equal(nexted, true, "order passes once city and state are provided");
  assert.equal(okReq.body.deliveryAddress.city, "Delhi");
  assert.equal(okReq.body.deliveryAddress.state, "Delhi");
});

test("delivery order without a street address is rejected with a clear message", async () => {
  const d = freshLoad();
  const [validatePublicOrder] = getRouteHandlers(d.publicRoutes, "post", "/orders");
  const itemId = seedMenu(d.store);

  const req = makeReq({
    orderType: "delivery",
    paymentMethod: "cod",
    customerPhone: "9876543210",
    items: [{ menuItemId: String(itemId), qty: 1 }],
    deliveryAddress: {
      line1: "   ",
      city: "Delhi",
      state: "Delhi",
      distanceKm: 4,
    },
  });
  const res = makeRes();
  await validatePublicOrder(req, res, () => {});
  assert.equal(res._status, 400);
  assert.match(res._body.message, /complete delivery address/i);
});

test("client-supplied deliveryFee is ignored and recomputed from distanceKm", async () => {
  const d = freshLoad();
  const [validatePublicOrder] = getRouteHandlers(d.publicRoutes, "post", "/orders");
  d.store.settings = { delivery_fee: 50 };
  const itemId = seedMenu(d.store);

  const req = makeReq({
    orderType: "delivery",
    paymentMethod: "cod",
    customerPhone: "9876543210",
    items: [{ menuItemId: String(itemId), qty: 1 }],
    deliveryAddress: {
      line1: "1 Main St",
      city: "Delhi",
      state: "Delhi",
      distanceKm: 2, // 2 km → ₹20, but base fee of ₹50 wins
    },
    deliveryFee: 999,
  });
  const res = makeRes();
  let nexted = false;
  await validatePublicOrder(req, res, () => {
    nexted = true;
  });

  assert.equal(nexted, true, "order still passes validation");
  assert.equal(req.body.deliveryFee, 50, "fee honours the base-fee floor, not the client value");
  assert.equal(req.body.deliveryAddress.distanceKm, 2);
});

test("takeaway order has no delivery fee and requires no distance", async () => {
  const d = freshLoad();
  const [validatePublicOrder] = getRouteHandlers(d.publicRoutes, "post", "/orders");
  const itemId = seedMenu(d.store);

  const req = makeReq({
    orderType: "takeaway",
    paymentMethod: "cash",
    items: [{ menuItemId: String(itemId), qty: 1 }],
  });
  const res = makeRes();
  let nexted = false;
  await validatePublicOrder(req, res, () => {
    nexted = true;
  });

  assert.equal(nexted, true, "takeaway order passes validation without distance");
  assert.equal(req.body.deliveryFee, 0);
  assert.equal(req.body.deliveryDistanceKm, 0);
});

// ---------------------------------------------------------------------------
// getOrderEstimate: authoritative fee display
// ---------------------------------------------------------------------------

test("estimate returns fee and distance from the supplied distanceKm", async () => {
  const d = freshLoad();
  const [getOrderEstimate] = getRouteHandlers(d.publicRoutes, "post", "/order-estimate");
  const itemId = seedMenu(d.store);

  const req = makeReq({
    orderType: "delivery",
    items: [{ menuItemId: String(itemId), qty: 1 }],
    deliveryAddress: {
      state: "Delhi",
      distanceKm: 2,
    },
  });
  const res = makeRes();
  await getOrderEstimate(req, res);

  assert.equal(res._status, 200);
  assert.equal(res._body.estimate.deliveryFee, 20, "2 km → ₹20");
  assert.equal(res._body.estimate.deliveryDistanceKm, 2);
});

test("estimate shows zero delivery fee when distanceKm is missing", async () => {
  const d = freshLoad();
  const [getOrderEstimate] = getRouteHandlers(d.publicRoutes, "post", "/order-estimate");
  const itemId = seedMenu(d.store);

  const req = makeReq({
    orderType: "delivery",
    items: [{ menuItemId: String(itemId), qty: 1 }],
    deliveryAddress: { state: "Delhi" },
  });
  const res = makeRes();
  await getOrderEstimate(req, res);

  assert.equal(res._status, 200);
  assert.equal(res._body.estimate.deliveryFee, 0);
  assert.equal(res._body.estimate.deliveryDistanceKm, 0);
});

// ---------------------------------------------------------------------------
// Delivery radius table (final order value after discount -> allowed km)
// ---------------------------------------------------------------------------

test("getMaxDeliveryKm maps final order value to allowed radius", () => {
  const { delivery } = freshLoad();
  const g = delivery.getMaxDeliveryKm;
  assert.equal(g(199), 0, "below minimum order value");
  assert.equal(g(200), 1);
  assert.equal(g(299), 1);
  assert.equal(g(300), 2);
  assert.equal(g(399), 2);
  assert.equal(g(400), 3);
  assert.equal(g(599), 4);
  assert.equal(g(600), 5);
  assert.equal(g(699), 5);
  assert.equal(g(700), 6);
  assert.equal(g(999), 8);
  assert.equal(g(1000), 9);
  assert.equal(g(1099), 9);
  assert.equal(g(1100), 10);
  assert.equal(g(5000), 10, "absolute cap is 10 km");
});

const runValidate = async (orderType, price, distanceKm, opts = {}) => {
  const d = freshLoad();
  const [validatePublicOrder] = getRouteHandlers(d.publicRoutes, "post", "/orders");
  const itemId = seedMenu(d.store, price);
  const req = makeReq({
    orderType,
    paymentMethod: orderType === "delivery" ? "cod" : "cash",
    customerName: "Test Customer",
    customerPhone: "9876543210",
    items: [{ menuItemId: String(itemId), qty: 1 }],
    ...(orderType === "delivery"
      ? { deliveryAddress: { line1: "1 Main St", city: "Delhi", state: "Delhi", distanceKm } }
      : {}),
    ...opts,
  });
  const res = makeRes();
  let nexted = false;
  await validatePublicOrder(req, res, () => {
    nexted = true;
  });
  return { d, req, res, nexted };
};

test("delivery radius follows the final-value table and rejects out-of-range distances", async () => {
  const cases = [
    [199, 1, false, "below minimum order value"],
    [200, 1, true, "₹200 -> 1 km"],
    [200, 2, false, "₹200 -> 2 km rejected"],
    [299, 1, true, "₹299 -> 1 km"],
    [300, 2, true, "₹300 -> 2 km"],
    [399, 2, true, "₹399 -> 2 km"],
    [400, 3, true, "₹400 -> 3 km"],
    [599, 4, true, "₹599 -> 4 km"],
    [600, 5, true, "₹600 -> 5 km"],
    [699, 5, true, "₹699 -> 5 km"],
    [700, 6, true, "₹700 -> 6 km"],
    [999, 8, true, "₹999 -> 8 km"],
    [1000, 9, true, "₹1000 -> 9 km"],
    [1099, 9, true, "₹1099 -> 9 km"],
    [1100, 10, true, "₹1100 -> 10 km"],
    [1100, 10.1, false, "above absolute 10 km cap"],
  ];
  for (const [price, km, expectOk, note] of cases) {
    const { res, nexted } = await runValidate("delivery", price, km);
    if (expectOk) {
      assert.equal(nexted, true, `₹${price} + ${km} km should be accepted (${note})`);
    } else {
      assert.equal(res._status, 400, `₹${price} + ${km} km should be rejected (${note})`);
    }
  }
});

test("out-of-range delivery distance returns a clear actionable error", async () => {
  const { res } = await runValidate("delivery", 300, 5);
  assert.equal(res._status, 400);
  assert.match(res._body.message, /allows delivery within 2 km/i);
});

test("takeaway order is unaffected by delivery-radius rules", async () => {
  const { nexted } = await runValidate("takeaway", 50, 0);
  assert.equal(nexted, true, "small takeaway order is accepted");
});

// ---------------------------------------------------------------------------
// Bulk-order promo eligibility (admin-configurable minimum, default ₹700)
// ---------------------------------------------------------------------------

test("promo code is eligible at/above the bulk minimum (₹700) and not below", async () => {
  const d = freshLoad();
  const [getOrderEstimate] = getRouteHandlers(d.publicRoutes, "post", "/order-estimate");

  const eligibleId = seedMenu(d.store, 700);
  let req = makeReq({
    orderType: "delivery",
    items: [{ menuItemId: String(eligibleId), qty: 1 }],
    couponCode: "SAVE100",
    deliveryAddress: { state: "Delhi", distanceKm: 2 },
  });
  let res = makeRes();
  await getOrderEstimate(req, res);
  assert.equal(res._status, 200);
  assert.ok(res._body.estimate.coupon, "coupon eligible at ₹700");
  assert.equal(res._body.estimate.couponDiscount, 100, "₹100 flat discount applied");

  const belowId = seedMenu(d.store, 699);
  req = makeReq({
    orderType: "delivery",
    items: [{ menuItemId: String(belowId), qty: 1 }],
    couponCode: "SAVE100",
    deliveryAddress: { state: "Delhi", distanceKm: 2 },
  });
  res = makeRes();
  await getOrderEstimate(req, res);
  assert.equal(res._status, 200);
  assert.equal(res._body.estimate.coupon, null, "coupon not eligible below ₹700");
  assert.equal(res._body.estimate.couponDiscount, 0, "no discount below the floor");
});

test("bulk promo minimum is admin-configurable via settings", async () => {
  const d = freshLoad();
  d.store.settings.min_promo_order_value = 500;
  const [getOrderEstimate] = getRouteHandlers(d.publicRoutes, "post", "/order-estimate");

  const eligibleId = seedMenu(d.store, 500);
  let req = makeReq({
    orderType: "delivery",
    items: [{ menuItemId: String(eligibleId), qty: 1 }],
    couponCode: "SAVE100",
    deliveryAddress: { state: "Delhi", distanceKm: 2 },
  });
  let res = makeRes();
  await getOrderEstimate(req, res);
  assert.equal(res._status, 200);
  assert.ok(res._body.estimate.coupon, "coupon eligible at ₹500 when floor is 500");

  const belowId = seedMenu(d.store, 499);
  req = makeReq({
    orderType: "delivery",
    items: [{ menuItemId: String(belowId), qty: 1 }],
    couponCode: "SAVE100",
    deliveryAddress: { state: "Delhi", distanceKm: 2 },
  });
  res = makeRes();
  await getOrderEstimate(req, res);
  assert.equal(res._body.estimate.coupon, null, "coupon not eligible below ₹500 floor");
});

after(() => {
  for (const absPath of [SETTINGS_MODEL, MENU_MODEL, USER_MODEL, COUPON_MODEL, DELIVERY_UTIL, PUBLIC_ROUTES]) {
    delete require.cache[absPath];
  }
});