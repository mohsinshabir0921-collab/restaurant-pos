const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

process.env.CASHFREE_WEBHOOK_SECRET = "test_webhook_secret";
process.env.CASHFREE_CLIENT_ID = "test_client_id";
process.env.CASHFREE_CLIENT_SECRET = "test_client_secret";

const SETTINGS_MODEL = require.resolve("../models/Settings");
const MENU_MODEL = require.resolve("../models/MenuItem");
const USER_MODEL = require.resolve("../models/User");
const ORDER_MODEL = require.resolve("../models/Order");
const CUSTOMER_MODEL = require.resolve("../models/Customer");
const TABLE_MODEL = require.resolve("../models/Table");
const LOYALTY_MODEL = require.resolve("../models/LoyaltyConfig");
const COUPON_MODEL = require.resolve("../models/Coupon");
const PAYMENT_MODEL = require.resolve("../models/Payment");
const INVENTORY_MODEL = require.resolve("../models/InventoryItem");
const RECIPE_MODEL = require.resolve("../models/Recipe");
const STOCK_MODEL = require.resolve("../models/StockMovement");
const DELIVERY_UTIL = require.resolve("../utils/delivery");
const ORDER_CONTROLLER = require.resolve("../controllers/orderController");
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
    settings: {
      restaurant_latitude: RESTAURANT.latitude,
      restaurant_longitude: RESTAURANT.longitude,
    },
    menuItems: [],
    lastOrderCreateArgs: null,
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

  const User = {
    findOne: async () => ({
      _id: "user_website",
      name: "Website Orders",
      role: "cashier",
      isActive: true,
    }),
  };

  // The seam under test: capture exactly what createOrder passes to Order.create.
  const Order = {
    create: async (doc) => {
      store.lastOrderCreateArgs = doc;
      const saved = {
        ...doc,
        _id: "order_persist_1",
        orderNumber: "ORD200000001",
        save: async () => saved,
      };
      return saved;
    },
    findById: () => {
      const query = {
        populate: () => query,
        lean: async () => store.lastOrderCreateArgs,
      };
      return query;
    },
  };

  const Customer = {
    getByPhone: async () => null,
    createOrGet: async () => ({
      _id: "customer_1",
      recordVisit: async () => {},
      redeemPoints: async () => {},
    }),
  };

  const Table = {};
  const LoyaltyConfig = {
    getConfig: async () => ({ pointsPerRupee: 1, rupeePerPoint: 1, minPointsToRedeem: 100 }),
  };
  const Coupon = {};
  const Payment = {};
  const InventoryItem = {};
  const Recipe = { getByMenuItem: async () => null };
  const StockMovement = {};

  stubModule(SETTINGS_MODEL, Settings);
  stubModule(MENU_MODEL, MenuItem);
  stubModule(USER_MODEL, User);
  stubModule(ORDER_MODEL, Order);
  stubModule(CUSTOMER_MODEL, Customer);
  stubModule(TABLE_MODEL, Table);
  stubModule(LOYALTY_MODEL, LoyaltyConfig);
  stubModule(COUPON_MODEL, Coupon);
  stubModule(PAYMENT_MODEL, Payment);
  stubModule(INVENTORY_MODEL, InventoryItem);
  stubModule(RECIPE_MODEL, Recipe);
  stubModule(STOCK_MODEL, StockMovement);

  return { store, Order };
};

const freshLoad = () => {
  const stubs = createStubs();

  // Only reload the modules that consume the (stubbed) models; the model
  // stubs must stay in require.cache so the consumers pick them up.
  for (const absPath of [DELIVERY_UTIL, ORDER_CONTROLLER, PUBLIC_ROUTES]) {
    delete require.cache[absPath];
  }

  const publicRoutes = require(PUBLIC_ROUTES);
  return { ...stubs, publicRoutes };
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
// Delivery order persistence regression: the authoritative values computed by
// validatePublicOrder must reach Order.create unchanged.
// ---------------------------------------------------------------------------

test("delivery order persists latitude, longitude, distanceKm, and deliveryFee", async () => {
  const d = freshLoad();
  const handlers = getRouteHandlers(d.publicRoutes, "post", "/orders");
  const [validatePublicOrder, attachWebsiteUser, createOrder] = handlers;
  const itemId = seedMenu(d.store);

  const req = makeReq({
    orderType: "delivery",
    paymentMethod: "cod",
    customerName: "Test Customer",
    customerPhone: "9876543210",
    items: [{ menuItemId: String(itemId), qty: 1 }],
    deliveryAddress: {
      line1: "12B, Rose Villa",
      city: "Delhi",
      state: "Delhi",
      distanceKm: 0.5,
      deliveryFee: 5,
      latitude: CUSTOMER.latitude,
      longitude: CUSTOMER.longitude,
    },
    deliveryFee: 5,
  });
  const res = makeRes();

  const callNext = (handler) =>
    new Promise((resolve, reject) =>
      handler(req, res, (err) => (err ? reject(err) : resolve()))
    );

  // Mirrors express dispatch: each middleware calls next() to advance.
  await callNext(validatePublicOrder);
  await callNext(attachWebsiteUser);
  await createOrder(req, res);

  assert.equal(res._status, 201, "delivery order is created");

  const persisted = d.store.lastOrderCreateArgs;
  assert.ok(persisted, "Order.create was invoked");

  assert.equal(persisted.deliveryFee, 39, "server-calculated fee is stored");
  assert.equal(persisted.deliveryAddress.distanceKm, 3.9, "server-calculated distance is stored");
  assert.equal(persisted.deliveryAddress.latitude, CUSTOMER.latitude, "customer latitude is stored");
  assert.equal(persisted.deliveryAddress.longitude, CUSTOMER.longitude, "customer longitude is stored");
  assert.equal(persisted.deliveryAddress.line1, "12B, Rose Villa", "human-readable address is preserved");
});

after(() => {
  for (const absPath of [
    SETTINGS_MODEL,
    MENU_MODEL,
    USER_MODEL,
    ORDER_MODEL,
    CUSTOMER_MODEL,
    TABLE_MODEL,
    LOYALTY_MODEL,
    COUPON_MODEL,
    PAYMENT_MODEL,
    INVENTORY_MODEL,
    RECIPE_MODEL,
    STOCK_MODEL,
    DELIVERY_UTIL,
    ORDER_CONTROLLER,
    PUBLIC_ROUTES,
  ]) {
    delete require.cache[absPath];
  }
});