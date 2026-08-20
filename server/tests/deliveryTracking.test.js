const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

process.env.CASHFREE_WEBHOOK_SECRET = "test_webhook_secret";
process.env.CASHFREE_CLIENT_ID = "test_client_id";
process.env.CASHFREE_CLIENT_SECRET = "test_client_secret";

const ORDER_MODEL = require.resolve("../models/Order");
const USER_MODEL = require.resolve("../models/User");
const DELIVERY_LOCATION_MODEL = require.resolve("../models/DeliveryLocation");
const DELIVERY_CONTROLLER = require.resolve("../controllers/deliveryController");
const ORDER_CONTROLLER = require.resolve("../controllers/orderController");
const DELIVERY_ROUTES = require.resolve("../routes/deliveryRoutes");
const ORDER_ROUTES = require.resolve("../routes/orderRoutes");
const PUBLIC_ROUTES = require.resolve("../routes/publicRoutes");
const PAYMENT_CONTROLLER = require.resolve("../controllers/paymentController");
const WEBHOOK_CONTROLLER = require.resolve("../controllers/webhookController");

// Captured before any stubModule call so the model-shape test can use the real
// schema while the controller tests keep using the stubbed models.
const DeliveryLocationModel = require("../models/DeliveryLocation");

const stubModule = (absPath, exports) => {
  require.cache[absPath] = {
    id: absPath,
    filename: absPath,
    loaded: true,
    exports,
  };
};

const ALLOWED_TRANSITIONS = {
  pending: ["confirmed", "preparing", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready", "served", "cancelled"],
  ready: ["served", "out_for_delivery", "cancelled"],
  out_for_delivery: ["delivered"],
  delivered: ["paid", "completed"],
  served: ["paid", "completed", "cancelled"],
  paid: ["completed", "cancelled"],
  completed: ["refunded"],
  cancelled: [],
  refunded: [],
};

const makeOrder = (overrides = {}) => ({
  _id: overrides._id || new mongoose.Types.ObjectId(),
  orderNumber: overrides.orderNumber || "ORD202608170001",
  orderType: overrides.orderType || "delivery",
  orderStatus: overrides.orderStatus || "ready",
  assignedTo: overrides.assignedTo || null,
  customerName: overrides.customerName || "Test Customer",
  customerPhone: overrides.customerPhone || "9876543210",
  customerEmail: overrides.customerEmail || "customer@test.com",
  deliveryAddress: overrides.deliveryAddress || {
    line1: "1 Main St",
    latitude: 28.6139,
    longitude: 77.249,
  },
  total: overrides.total !== undefined ? overrides.total : 354,
  estimatedDeliveryTime: overrides.estimatedDeliveryTime || null,
  actualDeliveryTime: overrides.actualDeliveryTime || null,
  createdAt: overrides.createdAt || new Date("2026-08-17T10:00:00Z"),
  updatedAt: overrides.updatedAt || new Date("2026-08-17T10:00:00Z"),
  canTransitionTo: function (newStatus) {
    return ALLOWED_TRANSITIONS[this.orderStatus]?.includes(newStatus) ?? false;
  },
  transitionTo: async function (newStatus, userId) {
    if (!this.canTransitionTo(newStatus)) {
      throw new Error(`Cannot transition from ${this.orderStatus} to ${newStatus}`);
    }
    this.orderStatus = newStatus;
    if (newStatus === "paid" || newStatus === "completed") {
      this.paymentStatus = "paid";
      this.paidAt = this.paidAt || new Date();
    }
    if (newStatus === "completed") {
      this.completedAt = new Date();
    }
    if (newStatus === "cancelled") {
      this.cancelledAt = new Date();
      this.paymentStatus = this.paymentStatus === "paid" ? "paid" : "failed";
    }
    if (newStatus === "refunded") {
      this.paymentStatus = "refunded";
    }
    if (userId) {
      this.updatedBy = userId;
    }
    return this.save();
  },
  save: async function () {
    return this;
  },
});

const makeUser = (overrides = {}) => ({
  _id: overrides._id || new mongoose.Types.ObjectId(),
  name: overrides.name || "Delivery Staff",
  email: overrides.email || "delivery@local.test",
  password: "hashed-not-in-response",
  role: overrides.role || "delivery",
  isActive: overrides.isActive !== undefined ? overrides.isActive : true,
});

const createStubs = (store) => {
  const Order = {
    findById: (id) => {
      const order = store.orders.find((o) => o._id.toString() === id.toString()) || null;
      const query = {
        populate: () => query,
        lean: async () => order,
        then: (resolve, reject) => Promise.resolve(order).then(resolve, reject),
      };
      return query;
    },
    findOne: async (query) =>
      store.orders.find((o) => {
        if (query.orderNumber !== undefined && String(o.orderNumber) !== String(query.orderNumber)) {
          return false;
        }
        return true;
      }) || null,
    find: (query) => {
      store.lastFindQuery = query;
      return {
        sort: () => ({
          limit: (n) => {
            store.lastLimit = n;
            return {
              lean: async () => store.recentOrdersResult || [],
            };
          },
          lean: async () => store.assignedResult,
        }),
      };
    },
  };

  const User = {
    findById: (id) => {
      const user = store.users.find((u) => u._id.toString() === id.toString());
      return {
        select: async () => user || null,
      };
    },
  };

  const DeliveryLocation = {
    create: async (doc) => {
      const created = { _id: new mongoose.Types.ObjectId(), ...doc };
      store.locations.push(created);
      store.latestLocation = created;
      return created;
    },
    findOne: (query) => {
      store.lastLocationQuery = query;
      return {
        sort: () => ({
          lean: async () => store.latestLocation,
        }),
      };
    },
  };

  stubModule(ORDER_MODEL, Order);
  stubModule(USER_MODEL, User);
  stubModule(DELIVERY_LOCATION_MODEL, DeliveryLocation);
};

const freshLoad = (store) => {
  createStubs(store);
  for (const absPath of [
    DELIVERY_CONTROLLER,
    ORDER_CONTROLLER,
    DELIVERY_ROUTES,
    ORDER_ROUTES,
    PUBLIC_ROUTES,
    PAYMENT_CONTROLLER,
    WEBHOOK_CONTROLLER,
  ]) {
    delete require.cache[absPath];
  }

  const deliveryController = require(DELIVERY_CONTROLLER);
  const deliveryRoutes = require(DELIVERY_ROUTES);
  const orderRoutes = require(ORDER_ROUTES);
  const publicRoutes = require(PUBLIC_ROUTES);
  const paymentController = require(PAYMENT_CONTROLLER);
  const webhookController = require(WEBHOOK_CONTROLLER);

  return { deliveryController, deliveryRoutes, orderRoutes, publicRoutes, paymentController, webhookController };
};

const getRouteHandlers = (router, method, path) => {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack.map((l) => l.handle);
    }
  }
  throw new Error(`Route ${method} ${path} not found`);
};

const makeReq = (overrides = {}) => ({
  params: overrides.params || {},
  query: overrides.query || {},
  body: overrides.body || {},
  user: overrides.user || { _id: new mongoose.Types.ObjectId(), role: "delivery" },
});

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

const makeNext = () => {
  let called = false;
  const next = () => {
    called = true;
  };
  next.called = () => called;
  return next;
};

// ---------------------------------------------------------------------------
// Delivery role authorization
// ---------------------------------------------------------------------------

test("delivery location route rejects non-delivery roles", () => {
  const { deliveryRoutes } = freshLoad({ orders: [], users: [], locations: [], assignedResult: [], latestLocation: null });
  const [, authorize] = getRouteHandlers(deliveryRoutes, "post", "/location");

  for (const role of ["admin", "cashier", "kitchen"]) {
    const res = makeRes();
    const next = makeNext();
    authorize(makeReq({ user: { _id: new mongoose.Types.ObjectId(), role } }), res, next);
    assert.equal(res._status, 403, `${role} should be denied`);
    assert.equal(next.called(), false);
  }

  const res = makeRes();
  const next = makeNext();
  authorize(makeReq({ user: { _id: new mongoose.Types.ObjectId(), role: "delivery" } }), res, next);
  assert.equal(res._status, 200, "delivery role should pass authorization");
  assert.equal(next.called(), true);
});

test("assigned orders route rejects non-delivery roles", () => {
  const { deliveryRoutes } = freshLoad({ orders: [], users: [], locations: [], assignedResult: [], latestLocation: null });
  const [, authorize] = getRouteHandlers(deliveryRoutes, "get", "/assigned");

  for (const role of ["admin", "cashier", "kitchen"]) {
    const res = makeRes();
    const next = makeNext();
    authorize(makeReq({ user: { _id: new mongoose.Types.ObjectId(), role } }), res, next);
    assert.equal(res._status, 403, `${role} should be denied`);
    assert.equal(next.called(), false);
  }

  const res = makeRes();
  const next = makeNext();
  authorize(makeReq({ user: { _id: new mongoose.Types.ObjectId(), role: "delivery" } }), res, next);
  assert.equal(next.called(), true);
});

test("tracking route allows admin, cashier and delivery but not kitchen", () => {
  const { orderRoutes } = freshLoad({ orders: [], users: [], locations: [], assignedResult: [], latestLocation: null });
  const [, authorize] = getRouteHandlers(orderRoutes, "get", "/:id/tracking");

  for (const role of ["admin", "cashier", "delivery"]) {
    const res = makeRes();
    const next = makeNext();
    authorize(makeReq({ user: { _id: new mongoose.Types.ObjectId(), role } }), res, next);
    assert.equal(next.called(), true, `${role} should pass tracking authorization`);
  }

  const res = makeRes();
  const next = makeNext();
  authorize(makeReq({ user: { _id: new mongoose.Types.ObjectId(), role: "kitchen" } }), res, next);
  assert.equal(res._status, 403, "kitchen should be denied tracking");
});

test("assign route allows admin and cashier but not delivery or kitchen", () => {
  const { orderRoutes } = freshLoad({ orders: [], users: [], locations: [], assignedResult: [], latestLocation: null });
  const [, authorize] = getRouteHandlers(orderRoutes, "post", "/:id/assign");

  for (const role of ["admin", "cashier"]) {
    const res = makeRes();
    const next = makeNext();
    authorize(makeReq({ user: { _id: new mongoose.Types.ObjectId(), role } }), res, next);
    assert.equal(next.called(), true, `${role} should pass assign authorization`);
  }

  for (const role of ["delivery", "kitchen"]) {
    const res = makeRes();
    const next = makeNext();
    authorize(makeReq({ user: { _id: new mongoose.Types.ObjectId(), role } }), res, next);
    assert.equal(res._status, 403, `${role} should be denied assign`);
  }
});

// ---------------------------------------------------------------------------
// Order assignment
// ---------------------------------------------------------------------------

test("admin can assign a delivery boy to a delivery order", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const boy = makeUser({ name: "Ravi", email: "ravi@delivery.local" });
  const order = makeOrder({ _id: new mongoose.Types.ObjectId(), orderStatus: "ready" });
  store.orders.push(order);
  store.users.push(boy);

  const { deliveryController } = freshLoad(store);
  const adminId = new mongoose.Types.ObjectId();
  const res = makeRes();
  await deliveryController.assignDeliveryBoy(
    makeReq({ params: { id: String(order._id) }, body: { deliveryBoyId: String(boy._id) }, user: { _id: adminId, role: "admin" } }),
    res
  );

  assert.equal(res._status, 200);
  assert.equal(order.assignedTo.toString(), boy._id.toString());
  assert.equal(res._body.order.assignedTo.name, "Ravi");
  assert.equal(res._body.order.assignedTo.role, "delivery");
  assert.equal(res._body.order.orderNumber, order.orderNumber);
});

test("cashier can assign a delivery boy to a delivery order", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const boy = makeUser({ name: "Ravi" });
  const order = makeOrder();
  store.orders.push(order);
  store.users.push(boy);

  const { deliveryController } = freshLoad(store);
  const res = makeRes();
  await deliveryController.assignDeliveryBoy(
    makeReq({ params: { id: String(order._id) }, body: { deliveryBoyId: String(boy._id) }, user: { _id: new mongoose.Types.ObjectId(), role: "cashier" } }),
    res
  );

  assert.equal(res._status, 200);
  assert.equal(order.assignedTo.toString(), boy._id.toString());
});

test("cannot assign a non-delivery user", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const cashier = makeUser({ name: "Maya", role: "cashier" });
  const order = makeOrder();
  store.orders.push(order);
  store.users.push(cashier);

  const { deliveryController } = freshLoad(store);
  const res = makeRes();
  await deliveryController.assignDeliveryBoy(
    makeReq({ params: { id: String(order._id) }, body: { deliveryBoyId: String(cashier._id) }, user: { _id: new mongoose.Types.ObjectId(), role: "admin" } }),
    res
  );

  assert.equal(res._status, 400);
  assert.match(res._body.message, /not a delivery staff member/);
  assert.equal(order.assignedTo, null);
});

test("cannot assign a delivery boy to a non-delivery order", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const boy = makeUser();
  const order = makeOrder({ orderType: "dinein" });
  store.orders.push(order);
  store.users.push(boy);

  const { deliveryController } = freshLoad(store);
  const res = makeRes();
  await deliveryController.assignDeliveryBoy(
    makeReq({ params: { id: String(order._id) }, body: { deliveryBoyId: String(boy._id) }, user: { _id: new mongoose.Types.ObjectId(), role: "admin" } }),
    res
  );

  assert.equal(res._status, 400);
  assert.match(res._body.message, /Only delivery orders/);
  assert.equal(order.assignedTo, null);
});

test("cannot assign a missing order or missing/inactive delivery user", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const boy = makeUser();
  store.users.push(boy);
  const { deliveryController } = freshLoad(store);

  const missingOrder = makeRes();
  await deliveryController.assignDeliveryBoy(
    makeReq({ params: { id: String(new mongoose.Types.ObjectId()) }, body: { deliveryBoyId: String(boy._id) }, user: { _id: new mongoose.Types.ObjectId(), role: "admin" } }),
    missingOrder
  );
  assert.equal(missingOrder._status, 404);

  const order = makeOrder();
  store.orders.push(order);

  const missingUser = makeRes();
  await deliveryController.assignDeliveryBoy(
    makeReq({ params: { id: String(order._id) }, body: { deliveryBoyId: String(new mongoose.Types.ObjectId()) }, user: { _id: new mongoose.Types.ObjectId(), role: "admin" } }),
    missingUser
  );
  assert.equal(missingUser._status, 404);

  const inactive = makeUser({ isActive: false });
  store.users.push(inactive);
  const inactiveRes = makeRes();
  await deliveryController.assignDeliveryBoy(
    makeReq({ params: { id: String(order._id) }, body: { deliveryBoyId: String(inactive._id) }, user: { _id: new mongoose.Types.ObjectId(), role: "admin" } }),
    inactiveRes
  );
  assert.equal(inactiveRes._status, 400);
  assert.match(inactiveRes._body.message, /inactive/);
});

// ---------------------------------------------------------------------------
// Assigned orders
// ---------------------------------------------------------------------------

test("delivery boy sees only their own active assigned delivery orders", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const boy = makeUser({ name: "Ravi" });
  const myOrder = makeOrder({
    orderStatus: "out_for_delivery",
    assignedTo: boy._id,
    deliveryAddress: { line1: "2 Rose Villa", latitude: 28.61, longitude: 77.25 },
  });
  store.users.push(boy);
  store.orders.push(myOrder);
  store.assignedResult = [myOrder];

  const { deliveryController } = freshLoad(store);
  const res = makeRes();
  await deliveryController.getAssignedOrders(makeReq({ user: { _id: boy._id, role: "delivery" } }), res);

  assert.equal(res._status, 200);
  assert.equal(res._body.orders.length, 1);
  assert.equal(res._body.orders[0].deliveryAddress.latitude, 28.61);
  assert.equal(res._body.orders[0].orderStatus, "out_for_delivery");

  assert.equal(store.lastFindQuery.assignedTo.toString(), boy._id.toString());
  assert.equal(store.lastFindQuery.orderType, "delivery");
  assert.deepEqual(store.lastFindQuery.orderStatus.$in, ["ready", "out_for_delivery"]);
});

// ---------------------------------------------------------------------------
// Location reporting
// ---------------------------------------------------------------------------

test("delivery boy cannot report location for another person's order", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const boyA = makeUser({ name: "A" });
  const boyB = makeUser({ name: "B" });
  const order = makeOrder({ orderStatus: "out_for_delivery", assignedTo: boyB._id });
  store.users.push(boyA, boyB);
  store.orders.push(order);

  const { deliveryController } = freshLoad(store);
  const res = makeRes();
  await deliveryController.reportLocation(
    makeReq({ body: { orderId: String(order._id), lat: 28.6, lng: 77.2 }, user: { _id: boyA._id, role: "delivery" } }),
    res
  );

  assert.equal(res._status, 403);
  assert.equal(store.locations.length, 0, "no location should be persisted");
});

test("invalid coordinates are rejected", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const boy = makeUser();
  const order = makeOrder({ orderStatus: "out_for_delivery", assignedTo: boy._id });
  store.users.push(boy);
  store.orders.push(order);

  const { deliveryController } = freshLoad(store);

  for (const [lat, lng] of [[91, 77.2], [28.6, 181], [-91, 77.2], [28.6, -181], ["not-a-number", 77.2], [null, 77.2]]) {
    const res = makeRes();
    await deliveryController.reportLocation(
      makeReq({ body: { orderId: String(order._id), lat, lng }, user: { _id: boy._id, role: "delivery" } }),
      res
    );
    assert.equal(res._status, 400, `lat=${lat} lng=${lng} should be rejected`);
  }
  assert.equal(store.locations.length, 0);
});

test("location is accepted only while the order is out for delivery", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const boy = makeUser();
  const ready = makeOrder({ orderStatus: "ready", assignedTo: boy._id });
  const delivered = makeOrder({ orderStatus: "delivered", assignedTo: boy._id });
  store.users.push(boy);
  store.orders.push(ready, delivered);

  const { deliveryController } = freshLoad(store);

  const readyRes = makeRes();
  await deliveryController.reportLocation(
    makeReq({ body: { orderId: String(ready._id), lat: 28.6, lng: 77.2 }, user: { _id: boy._id, role: "delivery" } }),
    readyRes
  );
  assert.equal(readyRes._status, 400);

  const deliveredRes = makeRes();
  await deliveryController.reportLocation(
    makeReq({ body: { orderId: String(delivered._id), lat: 28.6, lng: 77.2 }, user: { _id: boy._id, role: "delivery" } }),
    deliveredRes
  );
  assert.equal(deliveredRes._status, 400);

  assert.equal(store.locations.length, 0, "no location stored before out_for_delivery");
});

test("location is persisted as history and never from a client-supplied boy id", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const boy = makeUser({ name: "Ravi" });
  const order = makeOrder({ orderStatus: "out_for_delivery", assignedTo: boy._id });
  store.users.push(boy);
  store.orders.push(order);

  const { deliveryController } = freshLoad(store);

  const first = makeRes();
  await deliveryController.reportLocation(
    makeReq({
      body: { orderId: String(order._id), lat: 28.61, lng: 77.21, deliveryBoy: String(new mongoose.Types.ObjectId()) },
      user: { _id: boy._id, role: "delivery" },
    }),
    first
  );
  assert.equal(first._status, 201);
  assert.equal(first._body.location.lat, 28.61);
  assert.equal(first._body.location.lng, 77.21);

  const second = makeRes();
  await deliveryController.reportLocation(
    makeReq({ body: { orderId: String(order._id), lat: 28.62, lng: 77.22 }, user: { _id: boy._id, role: "delivery" } }),
    second
  );
  assert.equal(second._status, 201);

  assert.equal(store.locations.length, 2, "history is kept, the record is not overwritten");
  for (const location of store.locations) {
    assert.equal(location.deliveryBoy.toString(), boy._id.toString(), "deliveryBoy always comes from the session");
    assert.equal(location.order.toString(), order._id.toString());
    assert.equal(location.status, "out_for_delivery");
  }
  assert.equal(store.lastLocationQuery.order.toString(), order._id.toString());
});

// ---------------------------------------------------------------------------
// Order tracking
// ---------------------------------------------------------------------------

test("admin and cashier can read tracking for any delivery", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const boy = makeUser({ name: "Ravi", email: "ravi@delivery.local" });
  const order = makeOrder({
    orderStatus: "out_for_delivery",
    assignedTo: boy._id,
    estimatedDeliveryTime: new Date("2026-08-17T11:00:00Z"),
  });
  store.users.push(boy);
  store.orders.push(order);
  store.latestLocation = { _id: new mongoose.Types.ObjectId(), lat: 28.63, lng: 77.23, status: "out_for_delivery", timestamp: new Date("2026-08-17T10:30:00Z") };

  const { deliveryController } = freshLoad(store);

  for (const role of ["admin", "cashier"]) {
    const res = makeRes();
    await deliveryController.getOrderTracking(
      makeReq({ params: { id: String(order._id) }, user: { _id: new mongoose.Types.ObjectId(), role } }),
      res
    );
    assert.equal(res._status, 200, `${role} should read tracking`);
    assert.equal(res._body.tracking.orderNumber, order.orderNumber);
    assert.equal(res._body.tracking.orderStatus, "out_for_delivery");
    assert.equal(res._body.tracking.assignedTo.name, "Ravi");
    assert.equal(res._body.tracking.destination.latitude, 28.6139);
    assert.equal(res._body.tracking.destination.longitude, 77.249);
    assert.equal(res._body.tracking.latestLocation.lat, 28.63);
    assert.equal(res._body.tracking.latestLocation.lng, 77.23);
  }
});

test("delivery boy can read tracking for their own assigned delivery", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const boy = makeUser({ name: "Ravi" });
  const order = makeOrder({ orderStatus: "out_for_delivery", assignedTo: boy._id });
  store.users.push(boy);
  store.orders.push(order);
  store.latestLocation = { _id: new mongoose.Types.ObjectId(), lat: 28.6, lng: 77.2, status: "out_for_delivery", timestamp: new Date() };

  const { deliveryController } = freshLoad(store);
  const res = makeRes();
  await deliveryController.getOrderTracking(
    makeReq({ params: { id: String(order._id) }, user: { _id: boy._id, role: "delivery" } }),
    res
  );
  assert.equal(res._status, 200);
  assert.equal(res._body.tracking.assignedTo.name, "Ravi");
});

test("delivery boy cannot read tracking for another delivery", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const boyA = makeUser({ name: "A" });
  const boyB = makeUser({ name: "B" });
  const order = makeOrder({ orderStatus: "out_for_delivery", assignedTo: boyB._id });
  store.users.push(boyA, boyB);
  store.orders.push(order);

  const { deliveryController } = freshLoad(store);
  const res = makeRes();
  await deliveryController.getOrderTracking(
    makeReq({ params: { id: String(order._id) }, user: { _id: boyA._id, role: "delivery" } }),
    res
  );
  assert.equal(res._status, 403);
});

test("tracking for a non-delivery order is rejected", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const order = makeOrder({ orderType: "takeaway" });
  store.orders.push(order);

  const { deliveryController } = freshLoad(store);
  const res = makeRes();
  await deliveryController.getOrderTracking(
    makeReq({ params: { id: String(order._id) }, user: { _id: new mongoose.Types.ObjectId(), role: "admin" } }),
    res
  );
  assert.equal(res._status, 400);
});

// ---------------------------------------------------------------------------
// Public customer tracking
// ---------------------------------------------------------------------------

test("public tracking requires matching order number and phone", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const order = makeOrder({ customerPhone: "9876543210" });
  store.orders.push(order);

  const { deliveryController } = freshLoad(store);

  const missingPhone = makeRes();
  await deliveryController.getPublicOrderTracking(
    makeReq({ params: { orderNumber: order.orderNumber }, query: {} }),
    missingPhone
  );
  assert.equal(missingPhone._status, 400);

  const wrongPhone = makeRes();
  await deliveryController.getPublicOrderTracking(
    makeReq({ params: { orderNumber: order.orderNumber }, query: { phone: "1111111111" } }),
    wrongPhone
  );
  assert.equal(wrongPhone._status, 404, "wrong phone must not reveal the order");

  const unknownOrder = makeRes();
  await deliveryController.getPublicOrderTracking(
    makeReq({ params: { orderNumber: "ORD0000000000" }, query: { phone: "9876543210" } }),
    unknownOrder
  );
  assert.equal(unknownOrder._status, 404);

  const ok = makeRes();
  await deliveryController.getPublicOrderTracking(
    makeReq({ params: { orderNumber: order.orderNumber }, query: { phone: "9876543210" } }),
    ok
  );
  assert.equal(ok._status, 200);
  assert.equal(ok._body.tracking.orderNumber, order.orderNumber);
  assert.equal(ok._body.tracking.destination.latitude, 28.6139);
  assert.equal(ok._body.tracking.destination.longitude, 77.249);
});

test("public tracking does not expose private delivery-boy information", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const boy = makeUser({ name: "Ravi", email: "ravi@delivery.local", password: "top-secret" });
  const order = makeOrder({
    orderStatus: "out_for_delivery",
    assignedTo: boy._id,
    customerPhone: "9876543210",
  });
  store.users.push(boy);
  store.orders.push(order);
  store.latestLocation = { _id: new mongoose.Types.ObjectId(), lat: 28.6, lng: 77.2, timestamp: new Date() };

  const { deliveryController } = freshLoad(store);
  const res = makeRes();
  await deliveryController.getPublicOrderTracking(
    makeReq({ params: { orderNumber: order.orderNumber }, query: { phone: "9876543210" } }),
    res
  );

  assert.equal(res._status, 200);
  assert.deepEqual(res._body.tracking.assignedTo, { name: "Ravi" });
  assert.equal("email" in res._body.tracking.assignedTo, false);
  assert.equal("password" in res._body.tracking.assignedTo, false);
  assert.equal(res._body.tracking.latestLocation.lat, 28.6);
  assert.equal(res._body.tracking.deliveryStatus, "out_for_delivery");
});

test("public tracking rejects non-delivery orders", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const order = makeOrder({ orderType: "takeaway", customerPhone: "9876543210" });
  store.orders.push(order);

  const { deliveryController } = freshLoad(store);
  const res = makeRes();
  await deliveryController.getPublicOrderTracking(
    makeReq({ params: { orderNumber: order.orderNumber }, query: { phone: "9876543210" } }),
    res
  );
  assert.equal(res._status, 400);
});

test("public tracking still requires both order number and phone", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const order = makeOrder({ customerPhone: "9876543210" });
  store.orders.push(order);

  const { deliveryController } = freshLoad(store);

  const noPhone = makeRes();
  await deliveryController.getPublicOrderTracking(
    makeReq({ params: { orderNumber: order.orderNumber }, query: {} }),
    noPhone
  );
  assert.equal(noPhone._status, 400, "tracking must still require the phone");

  const noOrderNumber = makeRes();
  await deliveryController.getPublicOrderTracking(
    makeReq({ params: {}, query: { phone: "9876543210" } }),
    noOrderNumber
  );
  assert.equal(noOrderNumber._status, 400, "tracking must still require the order number");
});

// ---------------------------------------------------------------------------
// Public recent orders (phone-first lookup)
// ---------------------------------------------------------------------------

test("recent orders filters server-side by the supplied phone number", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null, recentOrdersResult: [] };
  const mine1 = makeOrder({ orderNumber: "ORD202608170001", customerPhone: "9876543210", createdAt: new Date("2026-08-17T10:00:00Z") });
  const mine2 = makeOrder({ orderNumber: "ORD202608170002", customerPhone: "9876543210", createdAt: new Date("2026-08-17T11:00:00Z") });
  const theirs = makeOrder({ orderNumber: "ORD202608170003", customerPhone: "1111111111", createdAt: new Date("2026-08-17T12:00:00Z") });
  store.orders.push(mine1, mine2, theirs);
  store.recentOrdersResult = [mine2, mine1];

  const { deliveryController } = freshLoad(store);
  const res = makeRes();
  await deliveryController.getPublicRecentOrders(makeReq({ query: { phone: "9876543210" } }), res);

  assert.equal(res._status, 200);
  assert.equal(store.lastFindQuery.customerPhone, "9876543210", "the query must be filtered by the caller's phone");
  assert.equal(res._body.orders.length, 2);
  const numbers = res._body.orders.map((o) => o.orderNumber);
  assert.ok(numbers.includes("ORD202608170001"));
  assert.ok(numbers.includes("ORD202608170002"));
  assert.equal(numbers.includes("ORD202608170003"), false, "another customer's order must never appear");
});

test("recent orders returns an empty list for an unrelated phone", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null, recentOrdersResult: [] };
  store.orders.push(makeOrder({ orderNumber: "ORD202608170001", customerPhone: "9876543210" }));

  const { deliveryController } = freshLoad(store);
  const res = makeRes();
  await deliveryController.getPublicRecentOrders(makeReq({ query: { phone: "9999999999" } }), res);

  assert.equal(res._status, 200, "an unknown phone must not 404 and must not reveal whether it exists");
  assert.deepEqual(res._body.orders, []);
});

test("recent orders requires a phone number", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null, recentOrdersResult: [] };
  const { deliveryController } = freshLoad(store);
  const res = makeRes();
  await deliveryController.getPublicRecentOrders(makeReq({ query: {} }), res);
  assert.equal(res._status, 400);
});

test("recent orders response contains only safe customer-facing fields", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null, recentOrdersResult: [] };
  const order = makeOrder({
    orderNumber: "ORD202608170001",
    customerPhone: "9876543210",
    customerName: "Asha",
    customerEmail: "secret@test.com",
    paymentMethod: "upi",
    paymentStatus: "paid",
    cashfreePaymentId: "pay_secret",
    deliveryAddress: { line1: "1 Main St", latitude: 28.6139, longitude: 77.249 },
    total: 354,
    assignedTo: new mongoose.Types.ObjectId(),
    createdAt: new Date("2026-08-17T10:00:00Z"),
  });
  store.orders.push(order);
  store.recentOrdersResult = [order];

  const { deliveryController } = freshLoad(store);
  const res = makeRes();
  await deliveryController.getPublicRecentOrders(makeReq({ query: { phone: "9876543210" } }), res);

  assert.equal(res._status, 200);
  assert.equal(res._body.orders.length, 1);
  const safe = res._body.orders[0];
  assert.deepEqual(
    Object.keys(safe).sort(),
    ["createdAt", "orderNumber", "orderStatus", "orderType", "total"]
  );
  assert.equal(safe.total, 354);
  assert.equal(safe.orderNumber, order.orderNumber);
});

test("recent orders limits results to the latest 10", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null, recentOrdersResult: [] };
  const orders = Array.from({ length: 12 }, (_, i) =>
    makeOrder({
      orderNumber: `ORD20260817${String(i + 1).padStart(4, "0")}`,
      customerPhone: "9876543210",
      createdAt: new Date(Date.UTC(2026, 7, 17, i + 1)),
    })
  );
  store.orders.push(...orders);
  store.recentOrdersResult = orders.slice(0, 10);

  const { deliveryController } = freshLoad(store);
  const res = makeRes();
  await deliveryController.getPublicRecentOrders(makeReq({ query: { phone: "9876543210" } }), res);

  assert.equal(res._status, 200);
  assert.equal(store.lastLimit, 10, "the query must be capped at 10");
  assert.equal(res._body.orders.length, 10);
});

test("recent orders route is mounted on the public router", () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null, recentOrdersResult: [] };
  const { publicRoutes } = freshLoad(store);
  const handlers = getRouteHandlers(publicRoutes, "get", "/orders/recent");
  assert.equal(typeof handlers[0], "function");
});

// ---------------------------------------------------------------------------
// Delivery status updates
// ---------------------------------------------------------------------------

test("status update route allows admin, kitchen and delivery but not cashier", () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const { orderRoutes } = freshLoad(store);
  const [, authorize] = getRouteHandlers(orderRoutes, "patch", "/:id/status");

  for (const role of ["admin", "kitchen", "delivery"]) {
    const res = makeRes();
    const next = makeNext();
    authorize(makeReq({ user: { _id: new mongoose.Types.ObjectId(), role } }), res, next);
    assert.equal(next.called(), true, `${role} should pass status authorization`);
  }

  for (const role of ["cashier", "waiter", "manager", "staff"]) {
    const res = makeRes();
    const next = makeNext();
    authorize(makeReq({ user: { _id: new mongoose.Types.ObjectId(), role } }), res, next);
    assert.equal(res._status, 403, `${role} should be denied status updates`);
    assert.equal(next.called(), false);
  }
});

test("delivery user can start their assigned delivery order", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const boy = makeUser({ name: "Ravi" });
  const order = makeOrder({ orderStatus: "ready", assignedTo: boy._id });
  store.users.push(boy);
  store.orders.push(order);

  const { orderRoutes } = freshLoad(store);
  const [, , updateOrderStatus] = getRouteHandlers(orderRoutes, "patch", "/:id/status");

  const res = makeRes();
  await updateOrderStatus(
    makeReq({ params: { id: String(order._id) }, body: { orderStatus: "out_for_delivery" }, user: { _id: boy._id, role: "delivery" } }),
    res
  );

  assert.equal(res._status, 200);
  assert.equal(order.orderStatus, "out_for_delivery");
  assert.equal(order.updatedBy.toString(), boy._id.toString());
});

test("delivery user can complete their assigned delivery order", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const boy = makeUser({ name: "Ravi" });
  const order = makeOrder({ orderStatus: "out_for_delivery", assignedTo: boy._id });
  store.users.push(boy);
  store.orders.push(order);

  const { orderRoutes } = freshLoad(store);
  const [, , updateOrderStatus] = getRouteHandlers(orderRoutes, "patch", "/:id/status");

  const res = makeRes();
  await updateOrderStatus(
    makeReq({ params: { id: String(order._id) }, body: { orderStatus: "delivered" }, user: { _id: boy._id, role: "delivery" } }),
    res
  );

  assert.equal(res._status, 200);
  assert.equal(order.orderStatus, "delivered");
});

test("delivery user cannot modify another delivery boy's order", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const boyA = makeUser({ name: "A" });
  const boyB = makeUser({ name: "B" });
  const order = makeOrder({ orderStatus: "ready", assignedTo: boyB._id });
  store.users.push(boyA, boyB);
  store.orders.push(order);

  const { orderRoutes } = freshLoad(store);
  const [, , updateOrderStatus] = getRouteHandlers(orderRoutes, "patch", "/:id/status");

  const res = makeRes();
  await updateOrderStatus(
    makeReq({ params: { id: String(order._id) }, body: { orderStatus: "out_for_delivery" }, user: { _id: boyA._id, role: "delivery" } }),
    res
  );

  assert.equal(res._status, 403);
  assert.equal(order.orderStatus, "ready", "status must not change");
});

test("delivery user cannot modify dine-in or takeaway orders", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const boy = makeUser({ name: "Ravi" });
  const dineIn = makeOrder({ orderType: "dinein", orderStatus: "ready", assignedTo: boy._id });
  const takeaway = makeOrder({ orderType: "takeaway", orderStatus: "ready", assignedTo: boy._id });
  store.users.push(boy);
  store.orders.push(dineIn, takeaway);

  const { orderRoutes } = freshLoad(store);
  const [, , updateOrderStatus] = getRouteHandlers(orderRoutes, "patch", "/:id/status");

  for (const order of [dineIn, takeaway]) {
    const res = makeRes();
    await updateOrderStatus(
      makeReq({ params: { id: String(order._id) }, body: { orderStatus: "out_for_delivery" }, user: { _id: boy._id, role: "delivery" } }),
      res
    );
    assert.equal(res._status, 403, `${order.orderType} should be rejected`);
    assert.equal(order.orderStatus, "ready");
  }
});

test("delivery user cannot use arbitrary status transitions", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const boy = makeUser({ name: "Ravi" });
  const ready = makeOrder({ orderStatus: "ready", assignedTo: boy._id });
  const outForDelivery = makeOrder({ orderStatus: "out_for_delivery", assignedTo: boy._id });
  const delivered = makeOrder({ orderStatus: "delivered", assignedTo: boy._id });
  store.users.push(boy);
  store.orders.push(ready, outForDelivery, delivered);

  const { orderRoutes } = freshLoad(store);
  const [, , updateOrderStatus] = getRouteHandlers(orderRoutes, "patch", "/:id/status");

  const cases = [
    { order: ready, to: "delivered", from: "ready" },
    { order: ready, to: "cancelled", from: "ready" },
    { order: ready, to: "paid", from: "ready" },
    { order: outForDelivery, to: "paid", from: "out_for_delivery" },
    { order: outForDelivery, to: "served", from: "out_for_delivery" },
    { order: outForDelivery, to: "cancelled", from: "out_for_delivery" },
    { order: delivered, to: "paid", from: "delivered" },
    { order: delivered, to: "completed", from: "delivered" },
  ];

  for (const { order, to, from } of cases) {
    const res = makeRes();
    await updateOrderStatus(
      makeReq({ params: { id: String(order._id) }, body: { orderStatus: to }, user: { _id: boy._id, role: "delivery" } }),
      res
    );
    assert.equal(res._status, 403, `delivery should not move ${from} -> ${to}`);
    assert.equal(order.orderStatus, from, "status must not change");
  }
});

test("admin and kitchen can still update order status", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const adminOrder = makeOrder({ orderType: "dinein", orderStatus: "ready" });
  const kitchenOrder = makeOrder({ orderType: "dinein", orderStatus: "preparing" });
  store.orders.push(adminOrder, kitchenOrder);

  const { orderRoutes } = freshLoad(store);
  const [, , updateOrderStatus] = getRouteHandlers(orderRoutes, "patch", "/:id/status");

  const adminRes = makeRes();
  await updateOrderStatus(
    makeReq({ params: { id: String(adminOrder._id) }, body: { orderStatus: "served" }, user: { _id: new mongoose.Types.ObjectId(), role: "admin" } }),
    adminRes
  );
  assert.equal(adminRes._status, 200);
  assert.equal(adminOrder.orderStatus, "served");

  const kitchenRes = makeRes();
  await updateOrderStatus(
    makeReq({ params: { id: String(kitchenOrder._id) }, body: { orderStatus: "ready" }, user: { _id: new mongoose.Types.ObjectId(), role: "kitchen" } }),
    kitchenRes
  );
  assert.equal(kitchenRes._status, 200);
  assert.equal(kitchenOrder.orderStatus, "ready");
});

test("assigned orders response includes total and no private customer fields", async () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const boy = makeUser({ name: "Ravi" });
  const order = makeOrder({
    orderStatus: "out_for_delivery",
    assignedTo: boy._id,
    total: 354,
    customerName: "Asha",
    deliveryAddress: { line1: "2 Rose Villa", latitude: 28.61, longitude: 77.25 },
  });
  store.users.push(boy);
  store.orders.push(order);
  store.assignedResult = [order];

  const { deliveryController } = freshLoad(store);
  const res = makeRes();
  await deliveryController.getAssignedOrders(makeReq({ user: { _id: boy._id, role: "delivery" } }), res);

  assert.equal(res._status, 200);
  assert.equal(res._body.orders.length, 1);
  const safe = res._body.orders[0];
  assert.equal(safe.total, 354);
  assert.equal(safe.orderNumber, order.orderNumber);
  assert.equal(safe.orderStatus, "out_for_delivery");
  assert.equal(safe.orderType, "delivery");
  assert.equal(safe.customerName, "Asha");
  assert.deepEqual(safe.deliveryAddress, { line1: "2 Rose Villa", latitude: 28.61, longitude: 77.25 });
  assert.equal(safe.assignedTo.toString(), boy._id.toString());
  assert.equal("customerPhone" in safe, false, "customer phone must not be exposed");
  assert.equal("customerEmail" in safe, false, "customer email must not be exposed");
});

// ---------------------------------------------------------------------------
// DeliveryLocation model shape
// ---------------------------------------------------------------------------

test("DeliveryLocation model enforces coordinate ranges and indexes", async () => {
  const location = new DeliveryLocationModel({
    order: new mongoose.Types.ObjectId(),
    deliveryBoy: new mongoose.Types.ObjectId(),
    lat: 91,
    lng: 0,
  });
  await assert.rejects(
    location.validate(),
    (err) => Boolean(err && err.errors && err.errors.lat),
    "lat above 90 should fail validation"
  );
});

test("payment and webhook controllers still export their Cashfree surface unchanged", () => {
  const store = { orders: [], users: [], locations: [], assignedResult: [], latestLocation: null };
  const { paymentController, webhookController } = freshLoad(store);
  assert.equal(typeof paymentController.createCashfreeOrder, "function");
  assert.equal(typeof paymentController.verifyCashfreePayment, "function");
  assert.equal(typeof webhookController.handleCashfreeWebhook, "function");
});

after(() => {
  for (const absPath of [
    ORDER_MODEL,
    USER_MODEL,
    DELIVERY_LOCATION_MODEL,
    DELIVERY_CONTROLLER,
    ORDER_CONTROLLER,
    DELIVERY_ROUTES,
    ORDER_ROUTES,
    PUBLIC_ROUTES,
    PAYMENT_CONTROLLER,
    WEBHOOK_CONTROLLER,
  ]) {
    delete require.cache[absPath];
  }
});
