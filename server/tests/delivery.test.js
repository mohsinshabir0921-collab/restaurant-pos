const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

process.env.CASHFREE_WEBHOOK_SECRET = "test_webhook_secret";
process.env.CASHFREE_CLIENT_ID = "test_client_id";
process.env.CASHFREE_CLIENT_SECRET = "test_client_secret";

const SETTINGS_MODEL = require.resolve("../models/Settings");
const MENU_MODEL = require.resolve("../models/MenuItem");
const USER_MODEL = require.resolve("../models/User");
const DELIVERY_UTIL = require.resolve("../utils/delivery");
const PUBLIC_ROUTES = require.resolve("../routes/publicRoutes");

const stubModule = (absPath, exports) => {
  require.cache[absPath] = {
    id: absPath,
    filename: absPath,
    loaded: true,
    exports,
  };
};

const createStubs = () => {
  const store = {
    settings: {},
    menuItems: [],
  };

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

  stubModule(SETTINGS_MODEL, Settings);
  stubModule(MENU_MODEL, MenuItem);
  stubModule(USER_MODEL, User);

  return { store, Settings, MenuItem, User };
};

const freshLoad = () => {
  const stubs = createStubs();

  for (const absPath of [DELIVERY_UTIL, PUBLIC_ROUTES]) {
    delete require.cache[absPath];
  }

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

const seedMenu = (store) => {
  const itemId = new mongoose.Types.ObjectId();
  store.menuItems = [
    {
      _id: itemId,
      name: "Pizza",
      price: 300,
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
      distanceKm: 4.2,
    },
    deliveryFee: 999,
  });
  const res = makeRes();
  let nexted = false;
  await validatePublicOrder(req, res, () => {
    nexted = true;
  });

  assert.equal(nexted, true, "valid delivery order passes validation");
  assert.equal(req.body.deliveryFee, 42, "fee is recomputed from distanceKm (4.2 km = ₹42)");
  assert.equal(req.body.deliveryAddress.distanceKm, 4.2, "distanceKm is preserved");
  assert.equal(req.body.deliveryDistanceKm, 4.2);
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
    deliveryAddress: { line1: "12B, Rose Villa", city: "Delhi", state: "Delhi", distanceKm: 4 },
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
      distanceKm: 3, // 3 km → ₹30, but base fee of ₹50 wins
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
  assert.equal(req.body.deliveryAddress.distanceKm, 3);
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
      distanceKm: 4.2,
    },
  });
  const res = makeRes();
  await getOrderEstimate(req, res);

  assert.equal(res._status, 200);
  assert.equal(res._body.estimate.deliveryFee, 42, "4.2 km → ₹42");
  assert.equal(res._body.estimate.deliveryDistanceKm, 4.2);
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

after(() => {
  for (const absPath of [SETTINGS_MODEL, MENU_MODEL, USER_MODEL, DELIVERY_UTIL, PUBLIC_ROUTES]) {
    delete require.cache[absPath];
  }
});