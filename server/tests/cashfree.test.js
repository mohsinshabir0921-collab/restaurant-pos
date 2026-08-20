const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const express = require("express");

process.env.CASHFREE_WEBHOOK_SECRET = "test_webhook_secret";
process.env.CASHFREE_CLIENT_ID = "test_client_id";
process.env.CASHFREE_CLIENT_SECRET = "test_client_secret";
process.env.CASHFREE_ENV = "sandbox";

const ORDERS_MODEL = require.resolve("../models/Order");
const PAYMENT_MODEL = require.resolve("../models/Payment");
const INVENTORY_MODEL = require.resolve("../models/InventoryItem");
const RECIPE_MODEL = require.resolve("../models/Recipe");
const STOCK_MODEL = require.resolve("../models/StockMovement");
const CASHFREE_SERVICE = require.resolve("../services/cashfree");
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
      cashfreeOrderId: data.cashfreeOrderId ?? null,
      cashfreePaymentId: data.cashfreePaymentId ?? null,
      cashfreePaymentStatus: data.cashfreePaymentStatus ?? null,
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

  let sessionSeq = 0;
  const cashfree = {
    _createdOrders: [],
    createOrder: async (options) => {
      const rec = {
        order_id: options.order_id,
        order_amount: options.order_amount,
        order_currency: options.order_currency,
        order_status: "ACTIVE",
        payment_session_id: `session_${++sessionSeq}`,
        order_note: options.order_note,
        customer_details: options.customer_details,
        order_meta: options.order_meta,
      };
      cashfree._createdOrders.push(rec);
      return rec;
    },
    createOrderSession: async (orderId, payload) => {
      const rec = { order_id: orderId, payment_session_id: `session_${++sessionSeq}`, ...payload };
      return rec;
    },
    fetchOrder: async (orderId) => {
      const found = cashfree._createdOrders.find((o) => o.order_id === orderId);
      if (!found) {
        const err = new Error("Order not found");
        err.statusCode = 404;
        throw err;
      }
      return found;
    },
    fetchOrderPayments: async (orderId) =>
      store.capturedPayments.filter((p) => p.order_id === orderId),
    fetchPayment: async (paymentId) => {
      const found = store.capturedPayments.find((p) => p.cf_payment_id === paymentId);
      if (!found) {
        const err = new Error("Payment not found");
        err.statusCode = 404;
        throw err;
      }
      return found;
    },
  };

  stubModule(ORDERS_MODEL, Order);
  stubModule(PAYMENT_MODEL, Payment);
  stubModule(INVENTORY_MODEL, InventoryItem);
  stubModule(RECIPE_MODEL, Recipe);
  stubModule(STOCK_MODEL, StockMovement);
  stubModule(CASHFREE_SERVICE, cashfree);

  return { store, Order, Payment, cashfree };
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
          customerPhone: "9876543210",
          total: 500,
          items: [{ menuItemId: "menu_1", name: "Pizza", qty: 1, price: 500 }],
          paymentMethod: "cash",
          paymentGateway: null,
          paymentStatus: "pending",
          orderStatus: "pending",
          cashfreeOrderId: null,
          cashfreePaymentId: null,
          cashfreePaymentStatus: null,
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

// Cashfree signs `x-webhook-timestamp + rawBody` with the webhook secret,
// base64-encoded.
const signWebhook = (rawBody, timestamp = "1690000000000") =>
  crypto
    .createHmac("sha256", process.env.CASHFREE_WEBHOOK_SECRET)
    .update(`${timestamp}${rawBody}`)
    .digest("base64");

const successPayload = (orderId, paymentId, overrides = {}) => ({
  data: {
    order: { order_id: orderId, order_amount: 500, order_currency: "INR" },
    payment: {
      cf_payment_id: paymentId,
      order_id: orderId,
      payment_status: "SUCCESS",
      payment_amount: 500,
      payment_currency: "INR",
      payment_message: "00::Transaction success",
      ...overrides,
    },
    customer_details: { customer_id: "cust_ord_1", customer_name: "Test Customer" },
  },
  event_time: new Date().toISOString(),
  type: "PAYMENT_SUCCESS_WEBHOOK",
});

const failedPayload = (orderId, paymentId) => ({
  data: {
    order: { order_id: orderId, order_amount: 500, order_currency: "INR" },
    payment: {
      cf_payment_id: paymentId,
      order_id: orderId,
      payment_status: "FAILED",
      payment_amount: 500,
      payment_currency: "INR",
      payment_message: "Payment failed",
    },
    customer_details: { customer_id: "cust_ord_1", customer_name: "Test Customer" },
  },
  event_time: new Date().toISOString(),
  type: "PAYMENT_FAILED_WEBHOOK",
});

const postWebhook = async (app, { rawBody, signature, timestamp = "1690000000000", extraHeaders = {} }) => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/payment/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(signature ? { "X-Webhook-Signature": signature, "X-Webhook-Timestamp": timestamp } : {}),
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

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

test("1. valid webhook signature is accepted", async () => {
  const stubs = freshLoad();
  seedOrder(stubs, { cashfreeOrderId: "pos_ord_1" });

  const rawBody = JSON.stringify(successPayload("pos_ord_1", "pay_1"));
  const { status } = await postWebhook(stubs.buildApp(), {
    rawBody,
    signature: signWebhook(rawBody),
  });

  assert.equal(status, 200);
});

test("2. invalid webhook signature is rejected with 400", async () => {
  const stubs = freshLoad();
  seedOrder(stubs, { cashfreeOrderId: "pos_ord_1" });

  const rawBody = JSON.stringify(successPayload("pos_ord_1", "pay_1"));
  const { status, body } = await postWebhook(stubs.buildApp(), {
    rawBody,
    signature: "deadbeef",
  });

  assert.equal(status, 400);
  assert.equal(body.success, false);
});

test("2b. missing webhook signature is rejected with 400", async () => {
  const stubs = freshLoad();
  seedOrder(stubs, { cashfreeOrderId: "pos_ord_1" });

  const rawBody = JSON.stringify(successPayload("pos_ord_1", "pay_1"));
  const { status } = await postWebhook(stubs.buildApp(), { rawBody });

  assert.equal(status, 400);
});

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------

test("3. PAYMENT_SUCCESS_WEBHOOK marks the order paid/confirmed", async () => {
  const stubs = freshLoad();
  seedInventory(stubs);
  seedOrder(stubs, { cashfreeOrderId: "pos_ord_1" });

  const rawBody = JSON.stringify(successPayload("pos_ord_1", "pay_1"));
  const { status } = await postWebhook(stubs.buildApp(), {
    rawBody,
    signature: signWebhook(rawBody),
  });

  const order = stubs.store.orders[0];
  assert.equal(status, 200);
  assert.equal(order.paymentStatus, "paid");
  assert.equal(order.orderStatus, "confirmed");
  assert.equal(order.cashfreePaymentId, "pay_1");
  assert.ok(order.paidAt);
  assert.equal(stubs.store.payments.filter((p) => p.status === "paid").length, 1);
});

test("4. PAYMENT_SUCCESS_WEBHOOK received twice has no duplicate effects", async () => {
  const stubs = freshLoad();
  seedInventory(stubs);
  seedOrder(stubs, { cashfreeOrderId: "pos_ord_1" });

  const rawBody = JSON.stringify(successPayload("pos_ord_1", "pay_1"));
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

test("5. PAYMENT_FAILED_WEBHOOK marks the order failed", async () => {
  const stubs = freshLoad();
  seedOrder(stubs, { cashfreeOrderId: "pos_ord_1" });

  const rawBody = JSON.stringify(failedPayload("pos_ord_1", "pay_1"));
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

test("6. PAYMENT_FAILED_WEBHOOK received twice has no duplicate effects", async () => {
  const stubs = freshLoad();
  seedInventory(stubs);
  seedOrder(stubs, { cashfreeOrderId: "pos_ord_1" });

  const rawBody = JSON.stringify(failedPayload("pos_ord_1", "pay_1"));
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

test("6b. PAYMENT_FAILED_WEBHOOK never downgrades a paid order", async () => {
  const stubs = freshLoad();
  seedInventory(stubs);
  seedOrder(stubs, { cashfreeOrderId: "pos_ord_1" });

  const capturedBody = JSON.stringify(successPayload("pos_ord_1", "pay_1"));
  await postWebhook(stubs.buildApp(), {
    rawBody: capturedBody,
    signature: signWebhook(capturedBody),
  });

  const failedBody = JSON.stringify(failedPayload("pos_ord_1", "pay_1"));
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
  seedOrder(stubs, { cashfreeOrderId: "pos_ord_1" });
  stubs.store.capturedPayments.push({
    cf_payment_id: "pay_1",
    order_id: "pos_ord_1",
    order_amount: 500,
    payment_status: "SUCCESS",
    payment_amount: 500,
    payment_currency: "INR",
  });
};

test("7. webhook before browser verification keeps state consistent", async () => {
  const stubs = freshLoad();
  setupVerifiedFlow(stubs);
  const order = stubs.store.orders[0];

  // webhook first
  const rawBody = JSON.stringify(successPayload("pos_ord_1", "pay_1"));
  const first = await postWebhook(stubs.buildApp(), {
    rawBody,
    signature: signWebhook(rawBody),
  });
  assert.equal(first.status, 200);
  assert.equal(order.paymentStatus, "paid");

  // browser verification afterwards
  const res = makeRes();
  await stubs.paymentController.verifyCashfreePayment(
    makeReq({
      orderId: "ord_1",
      cashfreeOrderId: "pos_ord_1",
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

  // browser verification first
  const res = makeRes();
  await stubs.paymentController.verifyCashfreePayment(
    makeReq({
      orderId: "ord_1",
      cashfreeOrderId: "pos_ord_1",
    }),
    res
  );
  assert.equal(res._status, 200);
  assert.equal(order.paymentStatus, "paid");

  // webhook afterwards
  const rawBody = JSON.stringify(successPayload("pos_ord_1", "pay_1"));
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

  const req = makeReq({
    orderId: "ord_1",
    cashfreeOrderId: "pos_ord_1",
  });

  const first = makeRes();
  await stubs.paymentController.verifyCashfreePayment(req, first);
  assert.equal(first._status, 200);

  const second = makeRes();
  await stubs.paymentController.verifyCashfreePayment(req, second);
  assert.equal(second._status, 200);
  assert.equal(second._body.message, "Payment already verified");

  assert.equal(order.paymentStatus, "paid");
  assert.equal(stubs.store.deductions.length, 1, "inventory deducted exactly once");
  assert.equal(stubs.store.payments.filter((p) => p.status === "paid").length, 1);
});

test("10. verify rejects when the order has no Cashfree order created", async () => {
  const stubs = freshLoad();
  seedOrder(stubs, { cashfreeOrderId: null });

  const res = makeRes();
  await stubs.paymentController.verifyCashfreePayment(
    makeReq({ orderId: "ord_1", cashfreeOrderId: "pos_ord_1" }),
    res
  );

  assert.equal(res._status, 400);
  assert.equal(res._body.message, "No Cashfree order was created for this order");
});

test("11. verify rejects on a Cashfree order ID mismatch", async () => {
  const stubs = freshLoad();
  seedOrder(stubs, { cashfreeOrderId: "pos_ord_1" });

  const res = makeRes();
  await stubs.paymentController.verifyCashfreePayment(
    makeReq({ orderId: "ord_1", cashfreeOrderId: "pos_ord_OTHER" }),
    res
  );

  assert.equal(res._status, 400);
  assert.equal(res._body.message, "Cashfree order ID mismatch");
});

// ---------------------------------------------------------------------------
// Order creation idempotency + payload shape
// ---------------------------------------------------------------------------

test("12. retrying createCashfreeOrder reuses the existing Cashfree order", async () => {
  const stubs = freshLoad();
  seedOrder(stubs);

  const req = makeReq({ orderId: "ord_1", amount: 1 });
  const first = makeRes();
  await stubs.paymentController.createCashfreeOrder(req, first);

  const second = makeRes();
  await stubs.paymentController.createCashfreeOrder(req, second);

  assert.equal(first._status, 200);
  assert.equal(second._status, 200);
  assert.equal(first._body.success, true);
  assert.equal(second._body.success, true);
  assert.equal(first._body.cashfreeOrderId, second._body.cashfreeOrderId);
  assert.equal(stubs.cashfree._createdOrders.length, 1, "no duplicate Cashfree order");
  assert.equal(first._body.amount, 500, "amount is order total, client amount ignored");
});

test("12b. createCashfreeOrder builds a valid order payload", async () => {
  const stubs = freshLoad();
  seedOrder(stubs);

  const res = makeRes();
  await stubs.paymentController.createCashfreeOrder(makeReq({ orderId: "ord_1" }), res);

  const created = stubs.cashfree._createdOrders[0];
  assert.ok(created, "a Cashfree order was created");
  assert.equal(created.order_id, "pos_ord_1");
  assert.equal(created.order_amount, 500);
  assert.equal(created.order_currency, "INR");
  assert.equal(created.customer_details.customer_id, "cust_ord_1");
  assert.equal(created.customer_details.customer_phone, "9876543210");
  assert.deepEqual(created.order_meta.payment_methods, "upi,cc,dc,nb");
  assert.ok(res._body.paymentSessionId, "frontend receives the payment session id");
  assert.equal(res._body.environment, "sandbox");
  assert.equal(res._body.currency, "INR");
});

test("13. existing test-mode checkout flow still works end-to-end", async () => {
  const stubs = freshLoad();
  setupVerifiedFlow(stubs);
  const order = stubs.store.orders[0];

  // 1. create-order
  const createRes = makeRes();
  await stubs.paymentController.createCashfreeOrder(makeReq({ orderId: "ord_1" }), createRes);
  assert.equal(createRes._status, 200);
  assert.ok(createRes._body.cashfreeOrderId);
  const cashfreeOrderId = createRes._body.cashfreeOrderId;

  // 2. simulate the successful payment for that cashfree order
  stubs.store.capturedPayments.push({
    cf_payment_id: "pay_1",
    order_id: cashfreeOrderId,
    order_amount: 500,
    payment_status: "SUCCESS",
    payment_amount: 500,
    payment_currency: "INR",
  });

  // 3. browser verification
  const verifyRes = makeRes();
  await stubs.paymentController.verifyCashfreePayment(
    makeReq({
      orderId: "ord_1",
      cashfreeOrderId,
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

test("14. verify rejects when Cashfree reports the payment as not successful", async () => {
  const stubs = freshLoad();
  seedOrder(stubs, { cashfreeOrderId: "pos_ord_1" });
  stubs.store.capturedPayments.push({
    cf_payment_id: "pay_1",
    order_id: "pos_ord_1",
    order_amount: 500,
    payment_status: "FAILED",
    payment_amount: 500,
    payment_currency: "INR",
  });

  const res = makeRes();
  await stubs.paymentController.verifyCashfreePayment(
    makeReq({ orderId: "ord_1", cashfreeOrderId: "pos_ord_1" }),
    res
  );

  const order = stubs.store.orders[0];
  assert.equal(res._status, 400);
  assert.equal(res._body.message, "Payment is not successful");
  assert.equal(order.paymentStatus, "failed");
  assert.equal(stubs.store.payments.filter((p) => p.status === "failed").length, 1);
});

after(() => {
  for (const absPath of [ORDERS_MODEL, PAYMENT_MODEL, INVENTORY_MODEL, RECIPE_MODEL, STOCK_MODEL, CASHFREE_SERVICE, PAYMENT_CONTROLLER, WEBHOOK_CONTROLLER, PAYMENT_ROUTES]) {
    delete require.cache[absPath];
  }
});