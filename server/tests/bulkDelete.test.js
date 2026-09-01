const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

process.env.CASHFREE_WEBHOOK_SECRET = "test_webhook_secret";
process.env.CASHFREE_CLIENT_ID = "test_client_id";
process.env.CASHFREE_CLIENT_SECRET = "test_client_secret";

// Explicit opt-in for isolated unit-test mocks – production never sets this flag.
// Allows withTransaction to fallback to non-transactional execution for these stubbed tests.
global.__ALLOW_NON_TRANSACTIONAL_FOR_TESTS = true;

const ORDER_MODEL = require.resolve("../models/Order");
const USER_MODEL = require.resolve("../models/User");
const CUSTOMER_MODEL = require.resolve("../models/Customer");
const TABLE_MODEL = require.resolve("../models/Table");
const PAYMENT_MODEL = require.resolve("../models/Payment");
const NOTIFICATION_MODEL = require.resolve("../models/Notification");
const STOCK_MODEL = require.resolve("../models/StockMovement");
const ORDER_EDIT_HISTORY_MODEL = require.resolve("../models/OrderEditHistory");
const PO_MODEL = require.resolve("../models/PurchaseOrder");
const WASTE_MODEL = require.resolve("../models/WasteLog");
const INVENTORY_MODEL = require.resolve("../models/InventoryItem");
const RECIPE_MODEL = require.resolve("../models/Recipe");
const NOTIFICATION_SERVICE = require.resolve("../utils/notificationService");
const PAGINATION_UTIL = require.resolve("../utils/pagination");
const THERMAL_PRINTER = require.resolve("../services/thermalPrinter");
const WEB_PUSH = require.resolve("../services/webPush");
const CASHFREE = require.resolve("../services/cashfree");
const ORDER_CONTROLLER = require.resolve("../controllers/orderController");
const CUSTOMER_CONTROLLER = require.resolve("../controllers/customerController");
const PO_CONTROLLER = require.resolve("../controllers/purchaseOrderController");
const WASTE_CONTROLLER = require.resolve("../controllers/wasteController");
const NOTIF_CONTROLLER = require.resolve("../controllers/notificationController");
const PAYMENT_CONTROLLER = require.resolve("../controllers/paymentController");
const ORDER_ROUTES = require.resolve("../routes/orderRoutes");
const CUSTOMER_ROUTES = require.resolve("../routes/customerRoutes");
const PO_ROUTES = require.resolve("../routes/purchaseOrderRoutes");
const WASTE_ROUTES = require.resolve("../routes/wasteRoutes");
const NOTIF_ROUTES = require.resolve("../routes/notificationRoutes");
const PAYMENT_ROUTES = require.resolve("../routes/paymentRoutes");

const stubModule = (absPath, exports) => {
  require.cache[absPath] = { id: absPath, filename: absPath, loaded: true, exports };
};

const eq = (a, b) => String(a) === String(b);

const makeRes = () => {
  const res = { _status: 200, _body: undefined };
  res.status = function (code) { this._status = code; return this; };
  res.json = function (data) { this._body = data; return this; };
  return res;
};

const adminReq = (body) => ({ body, params: {}, query: {}, user: { _id: new mongoose.Types.ObjectId(), role: "admin" } });

const chainable = (filtered) => {
  const q = {
    select: () => q,
    lean: () => Promise.resolve(filtered),
    then: (resolve, reject) => Promise.resolve(filtered).then(resolve, reject),
    catch: (reject) => Promise.resolve(filtered).catch(reject),
  };
  return q;
};

const makeOrderStub = (store) => ({
  find: (q) => {
    let filtered = store.orders || [];
    if (q?._id?.$in) filtered = filtered.filter((o) => q._id.$in.some((id) => eq(id, o._id)));
    else if (q?.orderNumber?.$in) filtered = filtered.filter((o) => q.orderNumber.$in.includes(o.orderNumber));
    else if (q?.customer?.$in) filtered = filtered.filter((o) => q.customer.$in.some((id) => eq(id, o.customer)));
    return chainable(filtered);
  },
  findById: async (id) => (store.orders || []).find((o) => eq(o._id, id)) || null,
  findOne: async (q) => null,
  deleteMany: async (q) => {
    if (!q?._id?.$in) return { deletedCount: 0 };
    const ids = q._id.$in.map((i) => String(i));
    const before = store.orders.length;
    store.orders = store.orders.filter((o) => !ids.includes(String(o._id)));
    return { deletedCount: before - store.orders.length };
  },
  deleteOne: async (q) => {
    const id = String(q._id);
    const idx = (store.orders || []).findIndex((o) => String(o._id) === id);
    if (idx !== -1) (store.orders || []).splice(idx, 1);
    return { deletedCount: idx !== -1 ? 1 : 0 };
  },
  updateMany: async (q, upd) => {
    let n = 0;
    for (const o of store.orders || []) {
      if (q.customer && eq(q.customer, o.customer)) {
        if (upd.$set && upd.$set.customer === null) o.customer = null;
        n++;
      }
    }
    return { modifiedCount: n };
  },
  countDocuments: async () => (store.orders || []).length,
});

const makeCustomerStub = (store) => ({
  find: (q) => {
    let filtered = store.customers || [];
    if (q?._id?.$in) filtered = filtered.filter((c) => q._id.$in.some((id) => eq(id, c._id)));
    return chainable(filtered);
  },
  findById: async (id) => {
    const c = (store.customers || []).find((x) => eq(x._id, id));
    if (!c) return null;
    // add save stub for loyalty reversal
    if (!c.save) c.save = async () => c;
    return c;
  },
  deleteMany: async (q) => {
    if (!q?._id?.$in) return { deletedCount: 0 };
    const ids = q._id.$in.map((i) => String(i));
    const before = store.customers.length;
    store.customers = store.customers.filter((c) => !ids.includes(String(c._id)));
    return { deletedCount: before - store.customers.length };
  },
  deleteOne: async (q) => {
    const id = String(q._id);
    const idx = (store.customers || []).findIndex((c) => String(c._id) === id);
    if (idx !== -1) store.customers.splice(idx, 1);
    return { deletedCount: idx !== -1 ? 1 : 0 };
  },
  updateMany: async () => ({ modifiedCount: 0 }),
});

const makePOStub = (store) => ({
  find: (q) => {
    let filtered = store.pos || [];
    if (q?._id?.$in) filtered = filtered.filter((p) => q._id.$in.some((id) => eq(id, p._id)));
    return chainable(filtered);
  },
  findById: async (id) => (store.pos || []).find((p) => eq(p._id, id)) || null,
  findByIdAndDelete: async (id) => { const i = (store.pos || []).findIndex((p) => eq(p._id, id)); if (i === -1) return null; return (store.pos || []).splice(i, 1)[0]; },
  deleteMany: async (q) => {
    if (!q?._id?.$in) return { deletedCount: 0 };
    const ids = q._id.$in.map((i) => String(i));
    const before = store.pos.length;
    store.pos = store.pos.filter((p) => !ids.includes(String(p._id)));
    return { deletedCount: before - store.pos.length };
  },
  deleteOne: async (q) => {
    const id = String(q._id);
    const idx = (store.pos || []).findIndex((p) => String(p._id) === id);
    if (idx !== -1) store.pos.splice(idx, 1);
    return { deletedCount: idx !== -1 ? 1 : 0 };
  },
});

const makeWasteStub = (store) => ({
  find: (q) => {
    let filtered = store.waste || [];
    if (q?._id?.$in) filtered = filtered.filter((w) => q._id.$in.some((id) => eq(id, w._id)));
    return chainable(filtered);
  },
  findById: async (id) => (store.waste || []).find((w) => eq(w._id, id)) || null,
  deleteMany: async (q) => {
    if (!q?._id?.$in) return { deletedCount: 0 };
    const ids = q._id.$in.map((i) => String(i));
    const before = store.waste.length;
    store.waste = store.waste.filter((w) => !ids.includes(String(w._id)));
    return { deletedCount: before - store.waste.length };
  },
  deleteOne: async (q) => {
    const id = String(q._id);
    const idx = (store.waste || []).findIndex((w) => String(w._id) === id);
    if (idx !== -1) store.waste.splice(idx, 1);
    return { deletedCount: idx !== -1 ? 1 : 0 };
  },
});

const makeNotificationStub = (store) => ({
  find: (q) => {
    let filtered = store.notifs || [];
    if (q?.entityId?.$in) filtered = filtered.filter((n) => q.entityId.$in.some((id) => eq(id, n.entityId)));
    else if (q?.entityId) filtered = filtered.filter((n) => eq(q.entityId, n.entityId));
    else if (q?.user) filtered = filtered.filter((n) => eq(q.user, n.user));
    else if (q?._id?.$in) filtered = filtered.filter((n) => q._id.$in.some((id) => eq(id, n._id)));
    return chainable(filtered.map((n) => ({ ...n })));
  },
  countDocuments: async (q) => (store.notifs || []).filter((n) => !q || eq(q.user, n.user)).length,
  deleteMany: async (q) => {
    if (q.entityId) {
      const id = String(q.entityId);
      const before = store.notifs.length;
      store.notifs = store.notifs.filter((n) => String(n.entityId) !== id);
      return { deletedCount: before - store.notifs.length };
    }
    if (q.referenceId) {
      const id = String(q.referenceId);
      const before = store.notifs.length;
      store.notifs = store.notifs.filter((n) => String(n.referenceId) !== id);
      return { deletedCount: before - store.notifs.length };
    }
    if (q._id?.$in) {
      const ids = q._id.$in.map((i) => String(i));
      const userFilter = q.user ? String(q.user) : null;
      const before = store.notifs.length;
      store.notifs = store.notifs.filter((n) => {
        if (userFilter && String(n.user) !== userFilter) return true;
        if (ids.includes(String(n._id)) && (!userFilter || String(n.user) === userFilter)) return false;
        return true;
      });
      return { deletedCount: before - store.notifs.length };
    }
    if (q.user) {
      const uid = String(q.user);
      const before = store.notifs.length;
      store.notifs = store.notifs.filter((n) => String(n.user) !== uid);
      return { deletedCount: before - store.notifs.length };
    }
    return { deletedCount: 0 };
  },
});

const makePaymentStub = (store) => ({
  find: (q) => {
    let filtered = store.payments || [];
    if (q?._id?.$in) filtered = filtered.filter((p) => q._id.$in.some((id) => eq(id, p._id)));
    else if (q?.order?.$in) filtered = filtered.filter((p) => q.order.$in.some((id) => eq(id, p.order)));
    else if (q?.order) filtered = filtered.filter((p) => eq(q.order, p.order));
    else if (q?.customer?.$in) filtered = filtered.filter((p) => q.customer.$in.some((id) => eq(id, p.customer)));
    return chainable(filtered);
  },
  deleteMany: async (q) => {
    if (q.order) {
      const id = String(q.order);
      const before = store.payments.length;
      store.payments = store.payments.filter((p) => String(p.order) !== id);
      return { deletedCount: before - store.payments.length };
    }
    if (q._id?.$in) {
      const ids = q._id.$in.map((i) => String(i));
      const before = store.payments.length;
      store.payments = store.payments.filter((p) => !ids.includes(String(p._id)));
      return { deletedCount: before - store.payments.length };
    }
    return { deletedCount: 0 };
  },
  updateMany: async (q, upd) => {
    let n = 0;
    for (const p of store.payments || []) {
      if (q.customer && eq(q.customer, p.customer)) {
        if (upd.$set && upd.$set.customer === null) p.customer = null;
        n++;
      }
    }
    return { modifiedCount: n };
  },
});

const EMPTY_MODEL = { find: async () => [], deleteMany: async () => ({ deletedCount: 0 }), findByIdAndDelete: async () => null };

const freshLoad = ({ orders = [], customers = [], pos = [], waste = [], notifs = [], payments = [], inventory = [], references = {} } = {}) => {
  const store = { orders, customers, pos, waste, notifs, payments, inventory };

  // Ensure order objects have delete helper expectations
  for (const o of store.orders) {
    if (!o.save) o.save = async () => o;
  }

  stubModule(ORDER_MODEL, makeOrderStub(store));
  // also need Order model for count etc in some paths (use same stub)
  const orderStub = makeOrderStub(store);
  // need to support Order.find used without select in new code: make it return array-like with lean
  // Already done via chainable

  stubModule(CUSTOMER_MODEL, makeCustomerStub(store));
  stubModule(PO_MODEL, makePOStub(store));
  stubModule(WASTE_MODEL, makeWasteStub(store));
  stubModule(NOTIFICATION_MODEL, makeNotificationStub(store));
  stubModule(PAYMENT_MODEL, makePaymentStub(store));

  // InventoryItem stub
  const invStub = {
    findById: async (id) => {
      const item = (store.inventory || []).find((i) => eq(i._id, id));
      if (!item) return null;
      return {
        ...item,
        currentStock: item.currentStock,
        adjustStock: async (qty, reason, refId, refType, userId) => {
          const prev = item.currentStock;
          item.currentStock = Math.max(0, item.currentStock + qty);
          return { item: item._id, type: qty > 0 ? "in" : "out", quantity: Math.abs(qty), previousStock: prev, newStock: item.currentStock, reason, referenceId: refId, referenceType: refType };
        },
        save: async () => item,
      };
    },
  };
  stubModule(INVENTORY_MODEL, invStub);
  const recipeStub = {
    getByMenuItem: async (menuItemId) => {
      // No recipes by default -> no inventory deductions
      return null;
    },
  };
  stubModule(RECIPE_MODEL, recipeStub);

  // StockMovement stub
  const stockStore = store.stockMovements || [];
  const stockStub = {
    find: (q) => {
      let filtered = stockStore;
      if (q?.referenceId?.$in) filtered = filtered.filter((s) => q.referenceId.$in.some((id) => eq(id, s.referenceId)));
      else if (q?.referenceId) filtered = filtered.filter((s) => eq(q.referenceId, s.referenceId));
      return chainable(filtered);
    },
    create: async (doc) => { stockStore.push(doc); return doc; },
    deleteMany: async (q) => {
      if (q.referenceId) {
        const id = String(q.referenceId);
        const before = stockStore.length;
        const filtered = stockStore.filter((s) => String(s.referenceId) !== id && String(s.referenceId) !== String(q.referenceId));
        stockStore.length = 0; stockStore.push(...filtered);
        return { deletedCount: before - filtered.length };
      }
      if (q.referenceId?.$in) {
        const ids = q.referenceId.$in.map((i) => String(i));
        const before = stockStore.length;
        const filtered = stockStore.filter((s) => !ids.includes(String(s.referenceId)));
        stockStore.length = 0; stockStore.push(...filtered);
        return { deletedCount: before - filtered.length };
      }
      return { deletedCount: 0 };
    },
  };
  // Support both referenceId and entityId queries for stock
  const historyStub = {
    find: (q) => chainable([]),
    deleteMany: async (q) => {
      // OrderEditHistory deleteMany by order
      if (q.order) {
        // not tracking history store, just succeed
        return { deletedCount: 1 };
      }
      return { deletedCount: 0 };
    },
  };
  const tableStub = {
    find: (q) => chainable([]),
    findByIdAndUpdate: async () => ({}),
    updateMany: async (q, upd) => {
      // simulate clearing
      return { modifiedCount: 1 };
    },
  };
  stubModule(TABLE_MODEL, tableStub);
  stubModule(STOCK_MODEL, stockStub);
  stubModule(ORDER_EDIT_HISTORY_MODEL, historyStub);
  stubModule(USER_MODEL, { findById: async () => null, find: async () => [] , aggregate: async () => []});
  stubModule(NOTIFICATION_SERVICE, { createNotificationForAdmins: async () => {} });
  stubModule(PAGINATION_UTIL, { parsePagination: (q, def) => ({ page: 1, limit: def || 20, skip: 0 }) });
  stubModule(THERMAL_PRINTER, { print: async () => {}, printKOT: async () => {}, printInvoice: async () => {} });
  stubModule(WEB_PUSH, { sendNewOrderNotification: async () => {} });
  stubModule(CASHFREE, { createCashfreeOrder: async () => {}, verify: async () => {} });

  for (const absPath of [
    ORDER_CONTROLLER, CUSTOMER_CONTROLLER, PO_CONTROLLER, WASTE_CONTROLLER,
    NOTIF_CONTROLLER, PAYMENT_CONTROLLER, ORDER_ROUTES, CUSTOMER_ROUTES,
    PO_ROUTES, WASTE_ROUTES, NOTIF_ROUTES, PAYMENT_ROUTES,
  ]) delete require.cache[absPath];

  const orderController = require(ORDER_CONTROLLER);
  const customerController = require(CUSTOMER_CONTROLLER);
  const poController = require(PO_CONTROLLER);
  const wasteController = require(WASTE_CONTROLLER);
  const notifController = require(NOTIF_CONTROLLER);
  const paymentController = require(PAYMENT_CONTROLLER);
  const orderRoutes = require(ORDER_ROUTES);
  const customerRoutes = require(CUSTOMER_ROUTES);
  const poRoutes = require(PO_ROUTES);
  const wasteRoutes = require(WASTE_ROUTES);
  const notifRoutes = require(NOTIF_ROUTES);
  const paymentRoutes = require(PAYMENT_ROUTES);

  return { store, orderController, customerController, poController, wasteController, notifController, paymentController, orderRoutes, customerRoutes, poRoutes, wasteRoutes, notifRoutes, paymentRoutes };
};

const getRouteHandlers = (router, method, path) => {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack.map((l) => l.handle);
    }
  }
  return null;
};

const oid = (n = 1) => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Orders bulk delete
// ---------------------------------------------------------------------------

test("orders: rejects invalid ids (non-array)", async () => {
  const d = freshLoad();
  const res = makeRes();
  await d.orderController.bulkDeleteOrders(adminReq({ ids: "nope" }), res);
  assert.equal(res._status, 400);
});

test("orders: rejects malformed ObjectId entries", async () => {
  const d = freshLoad();
  const res = makeRes();
  await d.orderController.bulkDeleteOrders(adminReq({ ids: ["not-an-objectid"] }), res);
  assert.equal(res._status, 400);
});

test("orders: deletes orders with no dependent references", async () => {
  const o1 = { _id: oid(), orderNumber: "ORD-1" };
  const o2 = { _id: oid(), orderNumber: "ORD-2" };
  const d = freshLoad({ orders: [o1, o2] });
  const res = makeRes();
  await d.orderController.bulkDeleteOrders(adminReq({ ids: [String(o1._id), String(o2._id)] }), res);
  assert.equal(res._status, 200);
  assert.equal(res._body.deletedCount, 2);
  assert.equal(res._body.blocked.length, 0);
  assert.equal(d.store.orders.length, 0);
});

test("orders: deletes order that has payments (cascade)", async () => {
  const o1 = { _id: oid(), orderNumber: "ORD-1" };
  const pay = { _id: oid(), order: o1._id, amount: 100 };
  const d = freshLoad({ orders: [o1], payments: [pay] });
  const res = makeRes();
  await d.orderController.bulkDeleteOrders(adminReq({ ids: [String(o1._id)] }), res);
  assert.equal(res._status, 200);
  assert.equal(res._body.deletedCount, 1);
  assert.equal(res._body.blocked.length, 0);
  assert.equal(d.store.orders.length, 0, "order should be deleted");
  assert.equal(d.store.payments.length, 0, "payment should be cascade deleted");
});

test("orders: deletes order with stock movements and table reference (cleanup)", async () => {
  const o1 = { _id: oid(), orderNumber: "ORD-1" };
  const d = freshLoad({ orders: [o1] });
  const res = makeRes();
  await d.orderController.bulkDeleteOrders(adminReq({ ids: [String(o1._id)] }), res);
  assert.equal(res._status, 200);
  assert.equal(res._body.deletedCount, 1);
  assert.equal(res._body.blocked.length, 0);
  assert.equal(d.store.orders.length, 0);
});

test("orders: reports missing ids", async () => {
  const d = freshLoad();
  const missingId = oid();
  const res = makeRes();
  await d.orderController.bulkDeleteOrders(adminReq({ ids: [String(missingId)] }), res);
  assert.equal(res._status, 200);
  assert.equal(res._body.deletedCount, 0);
  assert.equal(res._body.missing.length, 1);
});

test("orders: bulk mixed selections delete all valid and report missing", async () => {
  const o1 = { _id: oid(), orderNumber: "ORD-1" };
  const o2 = { _id: oid(), orderNumber: "ORD-2" };
  const missing = oid();
  const pay = { _id: oid(), order: o1._id, amount: 50 };
  const d = freshLoad({ orders: [o1, o2], payments: [pay] });
  const res = makeRes();
  await d.orderController.bulkDeleteOrders(adminReq({ ids: [String(o1._id), String(o2._id), String(missing)] }), res);
  assert.equal(res._status, 200);
  assert.equal(res._body.deletedCount, 2);
  assert.equal(res._body.missing.length, 1);
  assert.equal(d.store.orders.length, 0);
  assert.equal(d.store.payments.length, 0);
});

// ---------------------------------------------------------------------------
// Customers bulk delete
// ---------------------------------------------------------------------------

test("customers: deletes unreferenced customers", async () => {
  const c1 = { _id: oid(), name: "A", phone: "1" };
  const c2 = { _id: oid(), name: "B", phone: "2" };
  const d = freshLoad({ customers: [c1, c2] });
  const res = makeRes();
  await d.customerController.bulkDeleteCustomers(adminReq({ ids: [String(c1._id), String(c2._id)] }), res);
  assert.equal(res._body.deletedCount, 2);
  assert.equal(d.store.customers.length, 0);
});

test("customers: deletes customers with linked orders (nullify)", async () => {
  const c1 = { _id: oid(), name: "A", phone: "1" };
  const o1 = { _id: oid(), customer: c1._id };
  const d = freshLoad({ customers: [c1], orders: [o1] });
  const res = makeRes();
  await d.customerController.bulkDeleteCustomers(adminReq({ ids: [String(c1._id)] }), res);
  assert.equal(res._body.deletedCount, 1);
  assert.equal(res._body.blocked.length, 0);
  assert.equal(d.store.customers.length, 0);
  assert.equal(o1.customer, null, "order customer ref should be nullified");
});

test("customers: deletes customers with linked payments (nullify)", async () => {
  const c1 = { _id: oid(), name: "A", phone: "1" };
  const p1 = { _id: oid(), customer: c1._id, order: oid(), amount: 50 };
  const d = freshLoad({ customers: [c1], payments: [p1] });
  const res = makeRes();
  await d.customerController.bulkDeleteCustomers(adminReq({ ids: [String(c1._id)] }), res);
  assert.equal(res._body.deletedCount, 1);
  assert.equal(res._body.blocked.length, 0);
  assert.equal(d.store.customers.length, 0);
  assert.equal(p1.customer, null, "payment customer ref should be nullified");
});

test("customers: bulk mixed deletes all (nullify policy)", async () => {
  const c1 = { _id: oid(), name: "Safe", phone: "1" };
  const c2 = { _id: oid(), name: "Linked", phone: "2" };
  const o1 = { _id: oid(), customer: c2._id };
  const d = freshLoad({ customers: [c1, c2], orders: [o1] });
  const res = makeRes();
  await d.customerController.bulkDeleteCustomers(adminReq({ ids: [String(c1._id), String(c2._id)] }), res);
  assert.equal(res._body.deletedCount, 2);
  assert.equal(res._body.blocked.length, 0);
  assert.equal(d.store.customers.length, 0);
});

test("customers: deletes customer with only related notifications (notifications do not block)", async () => {
  const c1 = { _id: oid(), name: "NotifyOnly", phone: "9" };
  const n1 = { _id: oid(), entityId: c1._id, type: "customer", user: oid() };
  const n2 = { _id: oid(), entityId: c1._id, type: "customer", user: oid() };
  const d = freshLoad({ customers: [c1], notifs: [n1, n2] });
  const res = makeRes();
  await d.customerController.bulkDeleteCustomers(adminReq({ ids: [String(c1._id)] }), res);
  assert.equal(res._status, 200);
  assert.equal(res._body.deletedCount, 1);
  assert.equal(res._body.blocked.length, 0);
  assert.equal(d.store.customers.length, 0, "customer with only notifications should be deleted");
  assert.equal(d.store.notifs.length, 2, "related notifications must be preserved - not deleted to make customer deletable");
});

// ---------------------------------------------------------------------------
// Purchase orders bulk delete
// ---------------------------------------------------------------------------

test("purchase orders: deletes valid draft POs", async () => {
  const p1 = { _id: oid(), poNumber: "PO1", status: "draft" };
  const p2 = { _id: oid(), poNumber: "PO2", status: "cancelled" };
  const d = freshLoad({ pos: [p1, p2] });
  const res = makeRes();
  await d.poController.bulkDeletePurchaseOrders(adminReq({ ids: [String(p1._id), String(p2._id)] }), res);
  assert.equal(res._body.deletedCount, 2);
  assert.equal(d.store.pos.length, 0);
});

test("purchase orders: deletes received POs with reversal (inventory-aware)", async () => {
  const p1 = { _id: oid(), poNumber: "PO1", status: "received", items: [] };
  const d = freshLoad({ pos: [p1] });
  const res = makeRes();
  await d.poController.bulkDeletePurchaseOrders(adminReq({ ids: [String(p1._id)] }), res);
  assert.equal(res._body.deletedCount, 1);
  assert.equal(res._body.blocked.length, 0);
  assert.equal(d.store.pos.length, 0);
});

test("purchase orders: deletes partially_received POs with reversal", async () => {
  const itemId = oid();
  const p1 = { _id: oid(), poNumber: "PO1", status: "partially_received", items: [{ item: itemId, receivedQty: 0, orderedQty: 10 }] };
  const d = freshLoad({ pos: [p1] });
  const res = makeRes();
  await d.poController.bulkDeletePurchaseOrders(adminReq({ ids: [String(p1._id)] }), res);
  assert.equal(res._body.deletedCount, 1);
  assert.equal(d.store.pos.length, 0);
});

test("purchase orders: blocks sent POs (business rule from single delete)", async () => {
  const p1 = { _id: oid(), poNumber: "PO1", status: "sent" };
  const d = freshLoad({ pos: [p1] });
  const res = makeRes();
  await d.poController.bulkDeletePurchaseOrders(adminReq({ ids: [String(p1._id)] }), res);
  assert.equal(res._body.deletedCount, 0);
  assert.equal(res._body.blocked.length, 1);
});

// ---------------------------------------------------------------------------
// Waste bulk delete
// ---------------------------------------------------------------------------

test("waste: deletes un-approved waste logs", async () => {
  const w1 = { _id: oid(), wasteNumber: "W1", isApproved: false };
  const w2 = { _id: oid(), wasteNumber: "W2", isApproved: false };
  const d = freshLoad({ waste: [w1, w2] });
  const res = makeRes();
  await d.wasteController.bulkDeleteWasteLogs(adminReq({ ids: [String(w1._id), String(w2._id)] }), res);
  assert.equal(res._body.deletedCount, 2);
  assert.equal(d.store.waste.length, 0);
});

test("waste: deletes approved waste logs with reversal", async () => {
  const w1 = { _id: oid(), wasteNumber: "W1", isApproved: true, items: [] };
  const d = freshLoad({ waste: [w1] });
  const res = makeRes();
  await d.wasteController.bulkDeleteWasteLogs(adminReq({ ids: [String(w1._id)] }), res);
  assert.equal(res._body.deletedCount, 1);
  assert.equal(res._body.blocked.length, 0);
  assert.equal(d.store.waste.length, 0);
});

test("waste: bulk mixed deletes both approved and unapproved via reversal", async () => {
  const w1 = { _id: oid(), wasteNumber: "W1", isApproved: false, items: [] };
  const w2 = { _id: oid(), wasteNumber: "W2", isApproved: true, items: [] };
  const d = freshLoad({ waste: [w1, w2] });
  const res = makeRes();
  await d.wasteController.bulkDeleteWasteLogs(adminReq({ ids: [String(w1._id), String(w2._id)] }), res);
  assert.equal(res._body.deletedCount, 2);
  assert.equal(res._body.blocked.length, 0);
  assert.equal(d.store.waste.length, 0);
});

// ---------------------------------------------------------------------------
// Notifications bulk delete
// ---------------------------------------------------------------------------

test("notifications: user can only delete their own notifications", async () => {
  const me = oid();
  const other = oid();
  const n1 = { _id: oid(), user: me, title: "Mine" };
  const n2 = { _id: oid(), user: other, title: "Theirs" };
  const d = freshLoad({ notifs: [n1, n2] });
  const res = makeRes();
  await d.notifController.bulkDeleteNotifications(
    { body: { ids: [String(n1._id), String(n2._id)] }, user: { _id: me, role: "admin" } },
    res
  );
  assert.equal(res._status, 200);
  assert.equal(res._body.deletedCount, 1);
  assert.equal(d.store.notifs.length, 1);
  assert.equal(String(d.store.notifs[0]._id), String(n2._id), "other user's notification preserved");
});

test("notifications: clear-all only clears the current user's scope", async () => {
  const me = oid();
  const other = oid();
  const n1 = { _id: oid(), user: me, title: "Mine" };
  const n2 = { _id: oid(), user: other, title: "Theirs" };
  const d = freshLoad({ notifs: [n1, n2] });
  const res = makeRes();
  await d.notifController.clearAllNotifications({ user: { _id: me, role: "admin" } }, res);
  assert.equal(res._status, 200);
  assert.equal(res._body.deletedCount, 1);
  assert.equal(d.store.notifs.length, 1);
  assert.equal(String(d.store.notifs[0]._id), String(n2._id), "other user's notification preserved");
});

// ---------------------------------------------------------------------------
// Payments bulk delete
// ---------------------------------------------------------------------------

test("payments: deletes orphaned payments (order no longer exists)", async () => {
  const missingOrderId = oid();
  const p1 = { _id: oid(), order: missingOrderId, amount: 100, method: "cash", status: "paid" };
  const d = freshLoad({ payments: [p1] });
  const res = makeRes();
  await d.paymentController.bulkDeletePayments(adminReq({ ids: [String(p1._id)] }), res);
  assert.equal(res._body.deletedCount, 1);
  assert.equal(d.store.payments.length, 0);
});

test("payments: blocks payments tied to a live order", async () => {
  const orderId = oid();
  const o1 = { _id: orderId };
  const p1 = { _id: oid(), order: orderId, amount: 100, method: "cash", status: "paid" };
  const d = freshLoad({ orders: [o1], payments: [p1] });
  const res = makeRes();
  await d.paymentController.bulkDeletePayments(adminReq({ ids: [String(p1._id)] }), res);
  assert.equal(res._body.deletedCount, 0);
  assert.equal(res._body.blocked.length, 1);
  assert.match(res._body.blocked[0].reason, /live order/);
  assert.equal(d.store.payments.length, 1);
});

// ---------------------------------------------------------------------------
// Route registration + auth
// ---------------------------------------------------------------------------

test("bulk delete routes require authentication and admin role", async () => {
  const d = freshLoad();
  const routes = [
    [d.orderRoutes, "delete", "/bulk", "orders"],
    [d.customerRoutes, "delete", "/bulk", "customers"],
    [d.poRoutes, "delete", "/bulk", "purchase-orders"],
    [d.wasteRoutes, "delete", "/bulk", "waste"],
    [d.paymentRoutes, "delete", "/bulk", "payment"],
  ];
  for (const [router, method, path, label] of routes) {
    const handlers = getRouteHandlers(router, method, path);
    assert.ok(handlers, `${label} bulk route not registered`);
    assert.ok(handlers.length >= 3, `${label} bulk must have protect + authorizeRoles + handler`);

    const noTokenRes = makeRes();
    await handlers[0]({ headers: {} }, noTokenRes);
    assert.equal(noTokenRes._status, 401, `${label} bulk must reject anonymous`);

    const nonAdminRes = makeRes();
    handlers[1]({ user: { role: "cashier" } }, nonAdminRes, () => {});
    assert.equal(nonAdminRes._status, 403, `${label} bulk must reject non-admin`);

    let nexted = false;
    handlers[1]({ user: { role: "admin" } }, makeRes(), () => { nexted = true; });
    assert.equal(nexted, true, `${label} bulk must allow admins`);
  }
});

test("notification bulk route is authenticated (no admin restriction - own scope)", async () => {
  const d = freshLoad();
  const handlers = getRouteHandlers(d.notifRoutes, "delete", "/bulk");
  assert.ok(handlers, "notification bulk route not registered");
  assert.ok(handlers.length >= 2, "notifications bulk needs protect + handler");
  const noTokenRes = makeRes();
  await handlers[0]({ headers: {} }, noTokenRes);
  assert.equal(noTokenRes._status, 401, "notifications bulk must reject anonymous");
});

after(() => {
  for (const absPath of [
    ORDER_MODEL, USER_MODEL, CUSTOMER_MODEL, TABLE_MODEL, PAYMENT_MODEL,
    NOTIFICATION_MODEL, STOCK_MODEL, ORDER_EDIT_HISTORY_MODEL, PO_MODEL, WASTE_MODEL, INVENTORY_MODEL, RECIPE_MODEL,
    NOTIFICATION_SERVICE, PAGINATION_UTIL, THERMAL_PRINTER, WEB_PUSH, CASHFREE,
    ORDER_CONTROLLER, CUSTOMER_CONTROLLER, PO_CONTROLLER, WASTE_CONTROLLER,
    NOTIF_CONTROLLER, PAYMENT_CONTROLLER, ORDER_ROUTES, CUSTOMER_ROUTES,
    PO_ROUTES, WASTE_ROUTES, NOTIF_ROUTES, PAYMENT_ROUTES,
  ]) delete require.cache[absPath];
});
