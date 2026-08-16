const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const express = require("express");

process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret";
process.env.RAZORPAY_KEY_ID = "rzp_test_test_key_id";
process.env.RAZORPAY_KEY_SECRET = "test_key_secret";

const ORDERS_MODEL = require.resolve("../models/Order");
const PAYMENT_MODEL = require.resolve("../models/Payment");
const INVENTORY_MODEL = require.resolve("../models/InventoryItem");
const RECIPE_MODEL = require.resolve("../models/Recipe");
const STOCK_MODEL = require.resolve("../models/StockMovement");
const RAZORPAY_CONFIG = require.resolve("../config/razorpay");
const PAYMENT_CONTROLLER = require.resolve("../controllers/paymentController");
const WEBHOOK_CONTROLLER = require.resolve("../controllers/webhookController");
const PAYMENT_ROUTES = require.resolve("../routes/paymentRoutes");

const TRANSITIONS = {
  pending: ["confirmed", "preparing", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready", "served", "cancelled"],
  ready: ["served", "cancelled"],
  served: ["paid", "completed", "cancelled"],
  paid: ["completed", "cancelled"],
  completed: ["refunded"],
  cancelled: [],
  refunded: [],
};

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
    orders: [],
    payments: [],
    inventory: [],
    recipes: [],
    stockMovements: [],
    capturedPayments: [],
    deductions: [],
    orderSeq: 1000,
    paymentSeq: 1,
  };

  const makeOrderDoc = (data = {}) => {
    const doc = {
      _id: data._id || `order_${store.orderSeq}`,
      orderNumber: data.orderNumber || `ORD${store.orderSeq}`,
      customer: data.customer ?? null,
      customerName: data.customerName || "Test Customer",
      customerPhone: data.customerPhone || "",
      customerEmail: data.customerEmail || "",
      total: data.total ?? 500,
      items: data.items || [],
      paymentMethod: data.paymentMethod || "cash",
      paymentGateway: data.paymentGateway || null,
      paymentStatus: data.paymentStatus || "pending",
      orderStatus: data.orderStatus || "pending",
      razorpayOrderId: data.razorpayOrderId ?? null,
      razorpayPaymentId: data.razorpayPaymentId ?? null,
      razorpaySignature: data.razorpaySignature ?? null,
      paidAt: data.paidAt ?? null,
      inventoryDeducted: data.inventoryDeducted ?? false,
      createdBy: data.createdBy ?? "user_1",
    };
    doc.__saves = 0;
    doc.save = async function () {
      doc.__saves += 1;
      return doc;
    };
    doc.canTransitionTo = function (status) {
      return (TRANSITIONS[this.orderStatus] || []).includes(status);
    };
    doc.transitionTo = async function (status, userId) {
      if (!this.canTransitionTo(status)) {
        throw new Error(`Cannot transition from ${this.orderStatus} to ${status}`);
      }
      this.orderStatus = status;
      if (status === "paid" || status === "completed") {
        this.paymentStatus = "paid";
        this.paidAt = this.paidAt || new Date();
      }
      if (userId) this.updatedBy = userId;
      return this.save();
    };
    return doc;
  };

  const Order = {
    findOne: async (filter) =>
      store.orders.find((o) =>
        Object.entries(filter).every(([k, v]) => o[k] === v)
      ) || null,
    findById: async (id) =>
      store.orders.find((o) => String(o._id) === String(id)) || null,
    findOneAndUpdate: async (filter, update, opts = {}) => {
      const doc = store.orders.find((o) => String(o._id) === String(filter._id));
      if (!doc) return null;
      const claim = filter.inventoryDeducted && filter.inventoryDeducted.$ne === true;
      if (claim) {
        if (doc.inventoryDeducted === true) return null;
        doc.inventoryDeducted = true;
        return doc;
      }
      Object.assign(doc, update.$set || {});
      return doc;
    },
    updateOne: async () => ({}),
    create: async (data) => {
      const doc = makeOrderDoc(data);
      store.orders.push(doc);
      return doc;
    },
  };

  const Payment = {
    findOne: (filter) => {
      const matches = store.payments.filter((p) =>
        Object.entries(filter).every(([k, v]) => p[k] === v)
      );
      return { sort: async () => (matches.length ? matches[matches.length - 1] : null) };
    },
    ensurePaid: async (data) => {
      const existing = store.payments.find((p) => String(p.order) === String(data.order));
      if (existing) {
        existing.status = "paid";
        existing.method = data.method;
        existing.gateway = data.gateway;
        if (data.gatewayData.gatewayOrderId) existing.gatewayOrderId = data.gatewayData.gatewayOrderId;
        if (data.gatewayData.gatewayPaymentId) existing.gatewayPaymentId = data.gatewayData.gatewayPaymentId;
        if (data.gatewayData.gatewaySignature) existing.gatewaySignature = data.gatewayData.gatewaySignature;
        existing.collectedBy = data.collectedBy;
        existing.collectedAt = data.collectedAt || new Date();
        return existing;
      }
      const rec = {
        _id: `payrec_${store.paymentSeq++}`,
        order: data.order,
        customer: data.customer,
        amount: data.amount,
        method: data.method,
        gateway: data.gateway,
        status: "paid",
        collectedBy: data.collectedBy,
        collectedAt: data.collectedAt || new Date(),
        ...(data.gatewayData || {}),
      };
      store.payments.push(rec);
      return rec;
    },
    create: async (data) => {
      const rec = { _id: `payrec_${store.paymentSeq++}`, ...data };
      rec.markFailed = async function (reason) {
        rec.status = "failed";
        rec.notes = reason;
        return rec;
      };
      store.payments.push(rec);
      return rec;
    },
  };

  const InventoryItem = {
    findById: async (id) =>
      store.inventory.find((i) => String(i._id) === String(id)) || null,
  };

  const Recipe = {
    getByMenuItem: async (menuItemId) =>
      store.recipes.find((r) => String(r.menuItemId) === String(menuItemId)) || null,
  };

  const StockMovement = {
    create: async (data) => {
      store.stockMovements.push(data);
      return data;
    },
  };

  let orderSeq = 0;
  const razorpay = {
    _createdOrders: [],
    orders: {
      create: async (options) => {
        const rec = {
          id: `order_${++orderSeq}`,
          amount: options.amount,
          currency: options.currency,
          status: "created",
          receipt: options.receipt,
          notes: options.notes,
          payment: options.payment,
        };
        razorpay._createdOrders.push(rec);
        return rec;
      },
      fetch: async (orderId) => {
        const found = razorpay._createdOrders.find((o) => o.id === orderId);
        if (!found) {
          const err = new Error("Order not found");
          err.statusCode = 404;
          throw err;
        }
        return found;
      },
    },
    payments: {
      fetch: async (paymentId) => {
        const found = store.capturedPayments.find((p) => p.id === paymentId);
        if (!found) {
          const err = new Error("Payment not found");
          err.statusCode = 404;
          throw err;
        }
        return found;
      },
    },
  };

  stubModule(ORDERS_MODEL, Order);
  stubModule(PAYMENT_MODEL, Payment);
  stubModule(INVENTORY_MODEL, InventoryItem);
  stubModule(RECIPE_MODEL, Recipe);
  stubModule(STOCK_MODEL, StockMovement);
  stubModule(RAZORPAY_CONFIG, razorpay);

  return { store, Order, Payment, razorpay };
};

const freshLoad = () => {
  const stubs = createStubs();

  for (const absPath of [PAYMENT_CONTROLLER, WEBHOOK_CONTROLLER, PAYMENT_ROUTES]) {
    delete require.cache[absPath];
  }

  const paymentController = require(PAYMENT_CONTROLLER);
  const webhookController = require(WEBHOOK_CONTROLLER);

  const buildApp = () => {
    const app = express();
    app.use("/api/payment/webhook", express.raw({ type: "application/json" }));
    app.use(express.json());
    const paymentRoutes = require(PAYMENT_ROUTES);
    app.use("/api/payment", paymentRoutes);
    return app;
  };

  return { ...stubs, paymentController, webhookController, buildApp };
};

const seedOrder = (stubs, overrides = {}) => {
  const doc = stubs.store.orders.length
    ? stubs.store.orders[0]
    : (() => {
        const d = {
          _id: "ord_1",
          orderNumber: "ORD200000001",
          customer: null,
          customerName: "Test Customer",
          total: 500,
          items: [{ menuItemId: "menu_1", name: "Pizza", qty: 1, price: 500 }],
          paymentMethod: "cash",
          paymentGateway: null,
          paymentStatus: "pending",
          orderStatus: "pending",
          razorpayOrderId: null,
          razorpayPaymentId: null,
          razorpaySignature: null,
          paidAt: null,
          inventoryDeducted: false,
          createdBy: "user_1",
        };
        d.__saves = 0;
        d.save = async function () {
          d.__saves += 1;
          return d;
        };
        d.canTransitionTo = function (status) {
          return (TRANSITIONS[this.orderStatus] || []).includes(status);
        };
        d.transitionTo = async function (status, userId) {
          if (!this.canTransitionTo(status)) {
            throw new Error(`Cannot transition from ${this.orderStatus} to ${status}`);
          }
          this.orderStatus = status;
          if (status === "paid" || status === "completed") {
            this.paymentStatus = "paid";
            this.paidAt = this.paidAt || new Date();
          }
          if (userId) this.updatedBy = userId;
          return this.save();
        };
        stubs.store.orders.push(d);
        return d;
      })();

  Object.assign(doc, overrides);
  return doc;
};

const seedInventory = (stubs) => {
  const inv = {
    _id: "inv_1",
    name: "Dough",
    currentStock: 100,
    adjustStock: async function (delta, reason) {
      inv.currentStock += delta;
      stubs.store.deductions.push({ item: inv.name, delta, reason });
      return { item: inv._id, qty: delta, reason };
    },
  };
  stubs.store.inventory.push(inv);
  stubs.store.recipes.push({
    menuItemId: "menu_1",
    isActive: true,
    ingredients: [{ item: { _id: "inv_1" }, quantity: 1 }],
  });
};

const signWebhook = (rawBody) =>
  crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

const capturedPayload = (orderId, paymentId, overrides = {}) => ({
  entity: "event",
  account_id: "acc_test",
  event: "payment.captured",
  contains: ["payment"],
  payload: {
    payment: {
      entity: {
        id: paymentId,
        order_id: orderId,
        amount: 50000,
        currency: "INR",
        status: "captured",
        ...overrides,
      },
    },
  },
  created_at: Math.floor(Date.now() / 1000),
});

const failedPayload = (orderId, paymentId) => ({
  entity: "event",
  account_id: "acc_test",
  event: "payment.failed",
  contains: ["payment"],
  payload: {
    payment: {
      entity: {
        id: paymentId,
        order_id: orderId,
        amount: 50000,
        currency: "INR",
        status: "failed",
      },
    },
  },
  created_at: Math.floor(Date.now() / 1000),
});

const postWebhook = async (app, { rawBody, signature, extraHeaders = {} }) => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/payment/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(signature ? { "X-Razorpay-Signature": signature } : {}),
        ...extraHeaders,
      },
      body: rawBody,
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    server.close();
  }
};

const makeReq = (body, user = { _id: "user_1" }) => ({
  body,
  user,
  get: () => undefined,
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

const verifySignature = (orderId, paymentId) =>
  crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

test("1. valid webhook signature is accepted", async () => {
  const stubs = freshLoad();
  seedOrder(stubs, { razorpayOrderId: "order_1" });

  const rawBody = JSON.stringify(capturedPayload("order_1", "pay_1"));
  const { status } = await postWebhook(stubs.buildApp(), {
    rawBody,
    signature: signWebhook(rawBody),
  });

  assert.equal(status, 200);
});

test("2. invalid webhook signature is rejected with 400", async () => {
  const stubs = freshLoad();
  seedOrder(stubs, { razorpayOrderId: "order_1" });

  const rawBody = JSON.stringify(capturedPayload("order_1", "pay_1"));
  const { status, body } = await postWebhook(stubs.buildApp(), {
    rawBody,
    signature: "deadbeef",
  });

  assert.equal(status, 400);
  assert.equal(body.success, false);
});

test("2b. missing webhook signature is rejected with 400", async () => {
  const stubs = freshLoad();
  seedOrder(stubs, { razorpayOrderId: "order_1" });

  const rawBody = JSON.stringify(capturedPayload("order_1", "pay_1"));
  const { status } = await postWebhook(stubs.buildApp(), { rawBody });

  assert.equal(status, 400);
});

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------

test("3. payment.captured marks the order paid/confirmed", async () => {
  const stubs = freshLoad();
  seedInventory(stubs);
  seedOrder(stubs, { razorpayOrderId: "order_1" });

  const rawBody = JSON.stringify(capturedPayload("order_1", "pay_1"));
  const { status } = await postWebhook(stubs.buildApp(), {
    rawBody,
    signature: signWebhook(rawBody),
  });

  const order = stubs.store.orders[0];
  assert.equal(status, 200);
  assert.equal(order.paymentStatus, "paid");
  assert.equal(order.orderStatus, "confirmed");
  assert.equal(order.razorpayPaymentId, "pay_1");
  assert.ok(order.paidAt);
  assert.equal(stubs.store.payments.filter((p) => p.status === "paid").length, 1);
});

test("4. payment.captured received twice has no duplicate effects", async () => {
  const stubs = freshLoad();
  seedInventory(stubs);
  seedOrder(stubs, { razorpayOrderId: "order_1" });

  const rawBody = JSON.stringify(capturedPayload("order_1", "pay_1"));
  const app = stubs.buildApp();
  const sig = signWebhook(rawBody);

  const first = await postWebhook(app, { rawBody, signature: sig });
  const second = await postWebhook(app, { rawBody, signature: sig });

  const order = stubs.store.orders[0];
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(order.paymentStatus, "paid");
  assert.equal(stubs.store.deductions.length, 1, "inventory deducted exactly once");
  assert.equal(stubs.store.payments.filter((p) => p.status === "paid").length, 1);
});

test("5. payment.failed marks the order failed", async () => {
  const stubs = freshLoad();
  seedOrder(stubs, { razorpayOrderId: "order_1" });

  const rawBody = JSON.stringify(failedPayload("order_1", "pay_1"));
  const { status } = await postWebhook(stubs.buildApp(), {
    rawBody,
    signature: signWebhook(rawBody),
  });

  const order = stubs.store.orders[0];
  assert.equal(status, 200);
  assert.equal(order.paymentStatus, "failed");
  assert.equal(stubs.store.deductions.length, 0, "no inventory deduction on failure");
  assert.equal(stubs.store.payments.filter((p) => p.status === "failed").length, 1);
});

test("6. payment.failed received twice has no duplicate effects", async () => {
  const stubs = freshLoad();
  seedInventory(stubs);
  seedOrder(stubs, { razorpayOrderId: "order_1" });

  const rawBody = JSON.stringify(failedPayload("order_1", "pay_1"));
  const app = stubs.buildApp();
  const sig = signWebhook(rawBody);

  const first = await postWebhook(app, { rawBody, signature: sig });
  const second = await postWebhook(app, { rawBody, signature: sig });

  const order = stubs.store.orders[0];
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(order.paymentStatus, "failed");
  assert.equal(stubs.store.payments.filter((p) => p.status === "failed").length, 1);
  assert.equal(stubs.store.deductions.length, 0);
});

test("6b. payment.failed never downgrades a paid order", async () => {
  const stubs = freshLoad();
  seedInventory(stubs);
  seedOrder(stubs, { razorpayOrderId: "order_1" });

  const capturedBody = JSON.stringify(capturedPayload("order_1", "pay_1"));
  await postWebhook(stubs.buildApp(), {
    rawBody: capturedBody,
    signature: signWebhook(capturedBody),
  });

  const failedBody = JSON.stringify(failedPayload("order_1", "pay_1"));
  const { status } = await postWebhook(stubs.buildApp(), {
    rawBody: failedBody,
    signature: signWebhook(failedBody),
  });

  const order = stubs.store.orders[0];
  assert.equal(status, 200);
  assert.equal(order.paymentStatus, "paid", "paid order stays paid");
  assert.equal(stubs.store.payments.filter((p) => p.status === "paid").length, 1);
});

// ---------------------------------------------------------------------------
// Browser verification + webhook reconciliation
// ---------------------------------------------------------------------------

const setupVerifiedFlow = (stubs) => {
  seedInventory(stubs);
  seedOrder(stubs);
  stubs.store.capturedPayments.push({
    id: "pay_1",
    order_id: "order_1",
    amount: 50000,
    currency: "INR",
    status: "captured",
  });
};

test("7. webhook before browser verification keeps state consistent", async () => {
  const stubs = freshLoad();
  setupVerifiedFlow(stubs);
  const order = stubs.store.orders[0];
  order.razorpayOrderId = "order_1";

  // webhook first
  const rawBody = JSON.stringify(capturedPayload("order_1", "pay_1"));
  const first = await postWebhook(stubs.buildApp(), {
    rawBody,
    signature: signWebhook(rawBody),
  });
  assert.equal(first.status, 200);
  assert.equal(order.paymentStatus, "paid");

  // browser verification afterwards
  const res = makeRes();
  await stubs.paymentController.verifyRazorpayPayment(
    makeReq({
      orderId: "ord_1",
      razorpay_order_id: "order_1",
      razorpay_payment_id: "pay_1",
      razorpay_signature: verifySignature("order_1", "pay_1"),
    }),
    res
  );

  assert.equal(res._status, 200);
  assert.equal(res._body.success, true);
  assert.equal(stubs.store.deductions.length, 1, "inventory deducted exactly once");
  assert.equal(stubs.store.payments.filter((p) => p.status === "paid").length, 1);
});

test("8. browser verification before webhook keeps state consistent", async () => {
  const stubs = freshLoad();
  setupVerifiedFlow(stubs);
  const order = stubs.store.orders[0];
  order.razorpayOrderId = "order_1";

  // browser verification first
  const res = makeRes();
  await stubs.paymentController.verifyRazorpayPayment(
    makeReq({
      orderId: "ord_1",
      razorpay_order_id: "order_1",
      razorpay_payment_id: "pay_1",
      razorpay_signature: verifySignature("order_1", "pay_1"),
    }),
    res
  );
  assert.equal(res._status, 200);
  assert.equal(order.paymentStatus, "paid");

  // webhook afterwards
  const rawBody = JSON.stringify(capturedPayload("order_1", "pay_1"));
  const webhookRes = await postWebhook(stubs.buildApp(), {
    rawBody,
    signature: signWebhook(rawBody),
  });
  assert.equal(webhookRes.status, 200);

  assert.equal(stubs.store.deductions.length, 1, "inventory deducted exactly once");
  assert.equal(stubs.store.payments.filter((p) => p.status === "paid").length, 1);
});

test("9. repeated browser verification is idempotent", async () => {
  const stubs = freshLoad();
  setupVerifiedFlow(stubs);
  const order = stubs.store.orders[0];
  order.razorpayOrderId = "order_1";

  const req = makeReq({
    orderId: "ord_1",
    razorpay_order_id: "order_1",
    razorpay_payment_id: "pay_1",
    razorpay_signature: verifySignature("order_1", "pay_1"),
  });

  const first = makeRes();
  await stubs.paymentController.verifyRazorpayPayment(req, first);
  assert.equal(first._status, 200);

  const second = makeRes();
  await stubs.paymentController.verifyRazorpayPayment(req, second);
  assert.equal(second._status, 200);
  assert.equal(second._body.message, "Payment already verified");

  assert.equal(order.paymentStatus, "paid");
  assert.equal(stubs.store.deductions.length, 1, "inventory deducted exactly once");
  assert.equal(stubs.store.payments.filter((p) => p.status === "paid").length, 1);
});

// ---------------------------------------------------------------------------
// Order creation idempotency + capture config
// ---------------------------------------------------------------------------

test("12. retrying createRazorpayOrder reuses the existing Razorpay order", async () => {
  const stubs = freshLoad();
  seedOrder(stubs);

  const req = makeReq({ orderId: "ord_1", amount: 1 });
  const first = makeRes();
  await stubs.paymentController.createRazorpayOrder(req, first);

  const second = makeRes();
  await stubs.paymentController.createRazorpayOrder(req, second);

  assert.equal(first._status, 200);
  assert.equal(second._status, 200);
  assert.equal(first._body.success, true);
  assert.equal(second._body.success, true);
  assert.equal(first._body.razorpayOrderId, second._body.razorpayOrderId);
  assert.equal(stubs.razorpay._createdOrders.length, 1, "no duplicate Razorpay order");
  assert.equal(first._body.amount, 50000, "amount is order total, client amount ignored");
});

test("12b. createRazorpayOrder passes explicit automatic capture config", async () => {
  const stubs = freshLoad();
  seedOrder(stubs);

  const res = makeRes();
  await stubs.paymentController.createRazorpayOrder(makeReq({ orderId: "ord_1" }), res);

  const created = stubs.razorpay._createdOrders[0];
  assert.ok(created, "a Razorpay order was created");
  assert.deepEqual(created.payment, {
    capture: "automatic",
    capture_options: { automatic_expiry_period: 12 },
  });
  assert.equal(res._body.key, "rzp_test_test_key_id", "frontend receives only the Key ID");
  assert.equal(res._body.currency, "INR");
});

test("13. existing test-mode checkout flow still works end-to-end", async () => {
  const stubs = freshLoad();
  setupVerifiedFlow(stubs);
  const order = stubs.store.orders[0];

  // 1. create-order
  const createRes = makeRes();
  await stubs.paymentController.createRazorpayOrder(makeReq({ orderId: "ord_1" }), createRes);
  assert.equal(createRes._status, 200);
  assert.ok(createRes._body.razorpayOrderId);
  const razorpayOrderId = createRes._body.razorpayOrderId;

  // 2. simulate the captured payment for that razorpay order
  stubs.store.capturedPayments.push({
    id: "pay_1",
    order_id: razorpayOrderId,
    amount: 50000,
    currency: "INR",
    status: "captured",
  });

  // 3. browser verification
  const verifyRes = makeRes();
  await stubs.paymentController.verifyRazorpayPayment(
    makeReq({
      orderId: "ord_1",
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: "pay_1",
      razorpay_signature: verifySignature(razorpayOrderId, "pay_1"),
    }),
    verifyRes
  );
  assert.equal(verifyRes._status, 200);
  assert.equal(verifyRes._body.success, true);
  assert.equal(order.paymentStatus, "paid");
  assert.equal(order.orderStatus, "confirmed");
  assert.equal(stubs.store.deductions.length, 1);
  assert.equal(stubs.store.payments.filter((p) => p.status === "paid").length, 1);
});

after(() => {
  for (const absPath of [ORDERS_MODEL, PAYMENT_MODEL, INVENTORY_MODEL, RECIPE_MODEL, STOCK_MODEL, RAZORPAY_CONFIG, PAYMENT_CONTROLLER, WEBHOOK_CONTROLLER, PAYMENT_ROUTES]) {
    delete require.cache[absPath];
  }
});