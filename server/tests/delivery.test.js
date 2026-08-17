const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret";
process.env.RAZORPAY_KEY_ID = "rzp_test_test_key_id";
process.env.RAZORPAY_KEY_SECRET = "test_key_secret";

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

const RESTAURANT = { latitude: 28.6139, longitude: 77.209 };
// ~3.9 km straight-line east of the restaurant at the same latitude.
const CUSTOMER = { latitude: 28.6139, longitude: 77.249 };

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

test("haversine returns straight-line distance in km", () => {
  const { delivery } = freshLoad();
  assert.equal(delivery.haversineDistanceKm(28.6, 77.2, 28.6, 77.2), 0);
  const kmPerDegreeLat = delivery.haversineDistanceKm(0, 0, 1, 0);
  assert.ok(kmPerDegreeLat > 110 && kmPerDegreeLat < 112, "1 degree of latitude ≈ 111 km");
  const kmPerDegreeLngAtEquator = delivery.haversineDistanceKm(0, 0, 0, 1);
  assert.ok(kmPerDegreeLngAtEquator > 110 && kmPerDegreeLngAtEquator < 112);
});

// ---------------------------------------------------------------------------
// Server-side delivery fee computation
// ---------------------------------------------------------------------------

test("delivery fee computation requires configured restaurant coordinates", async () => {
  const { delivery } = freshLoad();
  await assert.rejects(
    () => delivery.computeDeliveryFeeForOrder({ latitude: CUSTOMER.latitude, longitude: CUSTOMER.longitude }),
    (err) => err.status === 400 && /configured/.test(err.message)
  );
});

test("delivery fee computation rejects invalid customer coordinates", async () => {
  const d = freshLoad();
  d.store.settings = { restaurant_latitude: RESTAURANT.latitude, restaurant_longitude: RESTAURANT.longitude };
  await assert.rejects(
    () => deliveryReject(d, "not-a-number", CUSTOMER.longitude),
    (err) => err.status === 400
  );
  await assert.rejects(
    () => deliveryReject(d, CUSTOMER.latitude, 500),
    (err) => err.status === 400
  );
  async function deliveryReject(scope, lat, lng) {
    return scope.delivery.computeDeliveryFeeForOrder({ latitude: lat, longitude: lng });
  }
});

test("delivery fee is computed from customer coords vs restaurant coords", async () => {
  const d = freshLoad();
  d.store.settings = { restaurant_latitude: RESTAURANT.latitude, restaurant_longitude: RESTAURANT.longitude };

  // Identical coordinates → zero distance, zero fee.
  const zero = await d.delivery.computeDeliveryFeeForOrder({ latitude: RESTAURANT.latitude, longitude: RESTAURANT.longitude });
  assert.equal(zero.distanceKm, 0);
  assert.equal(zero.deliveryFee, 0);

  const result = await d.delivery.computeDeliveryFeeForOrder({ latitude: CUSTOMER.latitude, longitude: CUSTOMER.longitude });
  assert.ok(result.distanceKm > 3.5 && result.distanceKm < 4.5, `distance was ${result.distanceKm}`);
  assert.equal(result.deliveryFee, 39, "3.9 km → ₹39 (first 5 km at ₹10/km)");
});

// ---------------------------------------------------------------------------
// validatePublicOrder: client-supplied distance/fee must never be trusted
// ---------------------------------------------------------------------------

test("delivery order uses server-calculated fee and distance, ignoring client values", async () => {
  const d = freshLoad();
  const [validatePublicOrder] = getRouteHandlers(d.publicRoutes, "post", "/orders");
  d.store.settings = { restaurant_latitude: RESTAURANT.latitude, restaurant_longitude: RESTAURANT.longitude };
  const itemId = seedMenu(d.store);

  const req = makeReq({
    orderType: "delivery",
    paymentMethod: "cod",
    customerName: "Test Customer",
    customerPhone: "9876543210",
    items: [{ menuItemId: String(itemId), qty: 1 }],
    deliveryAddress: {
      line1: "1 Main St",
      city: "Delhi",
      state: "Delhi",
      distanceKm: 0.5,
      latitude: CUSTOMER.latitude,
      longitude: CUSTOMER.longitude,
    },
    deliveryFee: 5,
  });
  const res = makeRes();
  let nexted = false;
  await validatePublicOrder(req, res, () => {
    nexted = true;
  });

  assert.equal(nexted, true, "valid delivery order passes validation");
  assert.equal(req.body.deliveryFee, 39, "client-supplied ₹5 fee is replaced by server fee");
  assert.equal(req.body.deliveryAddress.distanceKm, 3.9, "client-supplied 0.5 km is replaced by server distance");
  assert.equal(req.body.deliveryDistanceKm, 3.9);
  assert.equal(req.body.deliveryAddress.latitude, CUSTOMER.latitude);
  assert.equal(req.body.deliveryAddress.longitude, CUSTOMER.longitude);
  assert.equal(req.body.deliveryAddress.line1, "1 Main St");
  assert.equal(req.body.deliveryAddress.city, "Delhi");
  assert.equal(req.body.deliveryAddress.state, "Delhi");
});

test("delivery order without customer location is rejected", async () => {
  const d = freshLoad();
  const [validatePublicOrder] = getRouteHandlers(d.publicRoutes, "post", "/orders");
  d.store.settings = { restaurant_latitude: RESTAURANT.latitude, restaurant_longitude: RESTAURANT.longitude };
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
});

test("delivery order is rejected when the restaurant has no configured location", async () => {
  const d = freshLoad();
  const [validatePublicOrder] = getRouteHandlers(d.publicRoutes, "post", "/orders");
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
      latitude: CUSTOMER.latitude,
      longitude: CUSTOMER.longitude,
    },
  });
  const res = makeRes();
  await validatePublicOrder(req, res, () => {});
  assert.equal(res._status, 400);
  assert.match(res._body.message, /configured/);
});

test("public users cannot override the restaurant's configured coordinates", async () => {
  const d = freshLoad();
  const [validatePublicOrder] = getRouteHandlers(d.publicRoutes, "post", "/orders");
  // Restaurant coordinates always come from Settings, never from the client.
  d.store.settings = { restaurant_latitude: RESTAURANT.latitude, restaurant_longitude: RESTAURANT.longitude };
  const itemId = seedMenu(d.store);

  const req = makeReq({
    orderType: "delivery",
    paymentMethod: "cod",
    customerPhone: "9876543210",
    items: [{ menuItemId: String(itemId), qty: 1 }],
    // Client attempts to spoof the restaurant location to the customer's own
    // coordinates (which would zero the distance) plus a bogus top-level key.
    deliveryAddress: {
      line1: "1 Main St",
      city: "Delhi",
      state: "Delhi",
      latitude: CUSTOMER.latitude,
      longitude: CUSTOMER.longitude,
      restaurant_latitude: CUSTOMER.latitude,
      restaurant_longitude: CUSTOMER.longitude,
    },
    restaurant_latitude: CUSTOMER.latitude,
    restaurant_longitude: CUSTOMER.longitude,
  });
  const res = makeRes();
  let nexted = false;
  await validatePublicOrder(req, res, () => {
    nexted = true;
  });

  assert.equal(nexted, true, "order still passes validation");
  assert.equal(req.body.deliveryFee, 39, "fee is computed from Settings coordinates, not the spoofed ones");
  assert.equal(req.body.deliveryAddress.distanceKm, 3.9);
});

test("takeaway order has no delivery fee and requires no location", async () => {
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

  assert.equal(nexted, true, "takeaway order passes validation without location");
  assert.equal(req.body.deliveryFee, 0);
  assert.equal(req.body.deliveryDistanceKm, 0);
});

// ---------------------------------------------------------------------------
// getOrderEstimate: authoritative fee display
// ---------------------------------------------------------------------------

test("estimate returns server-calculated delivery fee and distance", async () => {
  const d = freshLoad();
  const [getOrderEstimate] = getRouteHandlers(d.publicRoutes, "post", "/order-estimate");
  d.store.settings = { restaurant_latitude: RESTAURANT.latitude, restaurant_longitude: RESTAURANT.longitude };
  const itemId = seedMenu(d.store);

  const req = makeReq({
    orderType: "delivery",
    items: [{ menuItemId: String(itemId), qty: 1 }],
    deliveryAddress: {
      state: "Delhi",
      latitude: CUSTOMER.latitude,
      longitude: CUSTOMER.longitude,
      distanceKm: 0.5,
    },
  });
  const res = makeRes();
  await getOrderEstimate(req, res);

  assert.equal(res._status, 200);
  assert.equal(res._body.estimate.deliveryFee, 39, "client-supplied 0.5 km is ignored");
  assert.equal(res._body.estimate.deliveryDistanceKm, 3.9);
});

test("estimate shows zero delivery fee when customer location is missing", async () => {
  const d = freshLoad();
  const [getOrderEstimate] = getRouteHandlers(d.publicRoutes, "post", "/order-estimate");
  d.store.settings = { restaurant_latitude: RESTAURANT.latitude, restaurant_longitude: RESTAURANT.longitude };
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