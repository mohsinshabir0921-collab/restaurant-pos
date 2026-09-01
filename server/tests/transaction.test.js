const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

process.env.CASHFREE_WEBHOOK_SECRET = "test";
process.env.CASHFREE_CLIENT_ID = "test";
process.env.CASHFREE_CLIENT_SECRET = "test";

const ORDER_MODEL = require.resolve("../models/Order");
const PAYMENT_MODEL = require.resolve("../models/Payment");
const STOCK_MODEL = require.resolve("../models/StockMovement");
const TABLE_MODEL = require.resolve("../models/Table");
const NOTIF_MODEL = require.resolve("../models/Notification");
const HISTORY_MODEL = require.resolve("../models/OrderEditHistory");
const CUSTOMER_MODEL = require.resolve("../models/Customer");
const INVENTORY_MODEL = require.resolve("../models/InventoryItem");
const RECIPE_MODEL = require.resolve("../models/Recipe");
const PO_MODEL = require.resolve("../models/PurchaseOrder");
const WASTE_MODEL = require.resolve("../models/WasteLog");
const TRANSAC_UTIL = require.resolve("../utils/transaction");
const ORDER_CONTROLLER = require.resolve("../controllers/orderController");

const stub = (p, e) => { require.cache[p] = { id: p, filename: p, loaded: true, exports: e }; };
const eq = (a,b)=>String(a)===String(b);
const oid = ()=> new mongoose.Types.ObjectId();
const makeRes = ()=>{ const r={_status:200,_body:undefined}; r.status=function(c){this._status=c;return this;}; r.json=function(d){this._body=d;return this;}; return r; };
const adminReq = (body)=>({ body, params:{}, query:{}, user:{_id: oid(), role:"admin"} });

test("transaction utility commits on success and aborts on failure", async () => {
  const { withTransaction } = require(TRANSAC_UTIL);
  // Mock mongoose connection to support transactions
  const mockSession = {
    startTransaction: () => {},
    commitTransaction: async () => { mockSession.committed = true; },
    abortTransaction: async () => { mockSession.aborted = true; },
    endSession: () => {},
    committed: false,
    aborted: false,
  };
  const originalStartSession = mongoose.startSession;
  const originalReadyState = mongoose.connection.readyState;
  // force readyState to 1 and mock startSession
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, writable: true, configurable: true });
  mongoose.startSession = async () => mockSession;

  // success path should commit
  mockSession.committed = false; mockSession.aborted = false;
  await withTransaction(async (session) => {
    assert.equal(session, mockSession);
  });
  assert.equal(mockSession.committed, true);
  assert.equal(mockSession.aborted, false);

  // failure path should abort
  mockSession.committed = false; mockSession.aborted = false;
  let threw = false;
  try {
    await withTransaction(async () => { throw new Error("simulated failure"); });
  } catch (e) { threw = true; assert.match(e.message, /simulated failure/); }
  assert.equal(threw, true);
  assert.equal(mockSession.aborted, true);
  assert.equal(mockSession.committed, false);

  // restore
  mongoose.startSession = originalStartSession;
  Object.defineProperty(mongoose.connection, 'readyState', { value: originalReadyState, writable: true, configurable: true });
  delete require.cache[TRANSAC_UTIL];
});

test("order deletion is atomic: failure after inventory reversal rolls back all changes", async () => {
  // This test verifies the contract: if any required step fails, the entire deletion rolls back.
  // We use a mock session that snapshots in-memory store and restores on abort to emulate real transaction rollback.
  const orderId = oid();
  const invId = oid();
  const menuId = oid();
  const order = {
    _id: orderId,
    orderNumber: "ORD-TX-1",
    inventoryDeducted: true,
    inventoryRestored: false,
    customer: null,
    loyaltyPointsEarned: 0,
    loyaltyPointsUsed: 0,
    items: [{ menuItemId: menuId, name: "Pizza", qty: 1 }],
  };
  const inventory = { _id: invId, name: "Flour", currentStock: 10, save: async function(){ } };
  // pre-stub all models imported by orderController to avoid real mongoose compilation
  const MENU_MODEL = require.resolve("../models/MenuItem");
  const SETTINGS_MODEL = require.resolve("../models/Settings");
  const LOYALTY_MODEL = require.resolve("../models/LoyaltyConfig");
  const COUPON_MODEL = require.resolve("../models/Coupon");
  const USER_MODEL = require.resolve("../models/User");
  stub(MENU_MODEL, { findById: async()=>null });
  stub(SETTINGS_MODEL, { getValue: async()=>null });
  stub(LOYALTY_MODEL, { getConfig: async()=>({}) });
  stub(COUPON_MODEL, { findValidForOrder: async()=>({coupon:null}) });
  stub(USER_MODEL, {});
  // store holds live objects
  const store = { orders: [order], payments: [{ _id: oid(), order: orderId }], inventory: [inventory], stockMovements: [] };

  // Snapshot for rollback
  const snapshot = {
    orders: JSON.parse(JSON.stringify(store.orders.map(o=> ({...o, _id: String(o._id)})))),
    payments: JSON.parse(JSON.stringify(store.payments.map(p=> ({...p, _id: String(p._id), order: String(p.order)})))),
    stock: inventory.currentStock,
  };

  // Mock session that restores snapshot on abort
  const mockSession = {
    startTransaction(){},
    commitTransaction: async () => { mockSession.committed = true; },
    abortTransaction: async () => {
      mockSession.aborted = true;
      // rollback: restore store to snapshot
      store.orders.length = 0; snapshot.orders.forEach(o=> store.orders.push({ ...o, _id: new mongoose.Types.ObjectId(o._id) }));
      store.payments.length = 0; snapshot.payments.forEach(p=> store.payments.push({ ...p, _id: new mongoose.Types.ObjectId(p._id), order: new mongoose.Types.ObjectId(p.order) }));
      inventory.currentStock = snapshot.stock;
      store.stockMovements.length = 0;
    },
    endSession(){},
    committed: false,
    aborted: false,
  };

  const originalStartSession = mongoose.startSession;
  const originalReadyState = mongoose.connection.readyState;
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, writable: true, configurable: true });
  mongoose.startSession = async () => mockSession;

  // Stub models to use store and session-aware behavior
  const recipeStub = { getByMenuItem: async (id)=> eq(id, menuId) ? { isActive:true, ingredients:[{ item:{ _id: invId }, quantity: 5 }] } : null };
  const invStub = {
    findById: (id) => {
      const q = {
        session: () => q,
        then: (res, rej) => Promise.resolve(store.inventory.find(i=> eq(i._id, id)) ).then(res, rej),
      };
      // also support direct await without .session
      q.session = () => q;
      return q;
    }
  };
  // Make findById return a Query-like thenable that resolves to inventory doc with save that respects session
  // For simplicity, our performOrderDeletionTx will do: const inventoryItem = await q(InventoryItem.findById(invId))
  // where InventoryItem.findById returns Query, we mock Query.
  // We'll create a more accurate mock: InventoryItem.findById returns Query with session and then
  const makeInvFindById = (id) => {
    const doc = store.inventory.find(i=> eq(i._id, id));
    if (!doc) return { session: () => ({ then: (r)=> r(null) }), then: (r)=> r(null) };
    // enhance doc to have save that can be called with {session}
    const originalSave = doc.save || (async () => doc);
    doc.save = async (opts) => { /* in real transaction, save is buffered until commit, but our abort will restore */ return doc; };
    const q = {
      session: () => q,
      then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject),
    };
    return q;
  };
  const orderStub = {
    find: (q) => {
      const filtered = store.orders.filter(o=> q._id.$in.some(id=> eq(id, o._id)));
      const qq = { session: ()=> qq, then: (res)=> Promise.resolve(filtered).then(res), lean: ()=> Promise.resolve(filtered) };
      qq.session = ()=> qq;
      return qq;
    },
    findById: (id) => {
      const doc = store.orders.find(o=> eq(o._id, id));
      const q = { session: ()=> q, then: (r)=> Promise.resolve(doc).then(r), lean: ()=> Promise.resolve(doc) };
      return q;
    },
    deleteOne: (filter) => {
      const q = {
        session: () => q,
        then: (resolve) => {
          // Simulate that delete is inside transaction: we will actually mutate store immediately,
          // but abort will restore snapshot (see mockSession.abortTransaction)
          const idx = store.orders.findIndex(o=> eq(o._id, filter._id));
          if (idx !== -1) store.orders.splice(idx,1);
          return Promise.resolve({deletedCount:1}).then(resolve);
        }
      };
      return q;
    },
  };
  const paymentStub = {
    deleteMany: (filter) => {
      const p = Promise.reject(new Error("simulated payment cleanup failure"));
      p.session = () => p;
      return p;
    },
    find: () => { const p = Promise.resolve([]); p.session = ()=> p; return p; }
  };
  const stockStub = {
    create: async (docs, opts) => { store.stockMovements.push(...(Array.isArray(docs)? docs : [docs])); return docs; },
    deleteMany: () => ({ session: ()=> ({ then: (r)=> r({deletedCount:0}) }), then: (r)=> r({deletedCount:0}) }),
    find: () => ({ session: ()=> ({ then: (r)=> r([]) }), then: (r)=> r([]) }),
  };
  const historyStub = { deleteMany: () => ({ session: ()=> ({ then: (r)=> r({}) }), then: (r)=> r({}) }) };
  const notifStub = { deleteMany: () => ({ session: ()=> ({ then: (r)=> r({}) }), then: (r)=> r({}) }) };
  const tableStub = { updateMany: () => ({ session: ()=> ({ then: (r)=> r({}) }), then: (r)=> r({}) }) };
  const customerStub = { findById: () => ({ session: ()=> ({ then: (r)=> r(null) }), then: (r)=> r(null) }) };

  stub(ORDER_MODEL, orderStub);
  stub(PAYMENT_MODEL, paymentStub);
  stub(STOCK_MODEL, stockStub);
  stub(HISTORY_MODEL, historyStub);
  stub(NOTIF_MODEL, notifStub);
  stub(TABLE_MODEL, tableStub);
  stub(CUSTOMER_MODEL, customerStub);
  stub(INVENTORY_MODEL, { findById: makeInvFindById });
  stub(RECIPE_MODEL, recipeStub);
  stub(require.resolve("../models/User"), { findById: async()=>null });
  stub(require.resolve("../utils/notificationService"), { createNotificationForAdmins: async()=>{} });
  stub(require.resolve("../utils/pagination"), { parsePagination: (q,d)=> ({page:1,limit:d||20,skip:0}) });
  stub(require.resolve("../services/thermalPrinter"), { print: async()=>{} });
  stub(require.resolve("../services/webPush"), { sendNewOrderNotification: async()=>{} });
  stub(require.resolve("../services/cashfree"), { createCashfreeOrder: async()=>{} });
  for (const p of [ORDER_CONTROLLER]) delete require.cache[p];
  const oc = require(ORDER_CONTROLLER);

  const res = makeRes();
  await oc.bulkDeleteOrders(adminReq({ ids:[String(orderId)] }), res);
  // Bulk should have caught the error and marked as blocked, not deleted
  assert.equal(res._body.deletedCount, 0);
  assert.equal(res._body.blocked.length, 1);
  assert.match(res._body.blocked[0].reason, /simulated payment cleanup failure/);
  // Verify no partial mutation: order still exists, inventory unchanged, payments still exist
  assert.equal(store.orders.length, 1, "order must not be deleted on failure");
  assert.equal(store.payments.length, 1, "payments must not be deleted on failure");
  assert.equal(inventory.currentStock, 10, "inventory must not be reversed on failure");
  assert.equal(store.stockMovements.length, 0, "no stock movements should persist");
  assert.equal(mockSession.aborted, true, "transaction should have been aborted");
  assert.equal(mockSession.committed, false, "transaction should not have committed");

  // cleanup
  mongoose.startSession = originalStartSession;
  Object.defineProperty(mongoose.connection, 'readyState', { value: originalReadyState, writable: true, configurable: true });
  for (const p of [ORDER_MODEL, PAYMENT_MODEL, STOCK_MODEL, TABLE_MODEL, NOTIF_MODEL, HISTORY_MODEL, CUSTOMER_MODEL, INVENTORY_MODEL, RECIPE_MODEL, ORDER_CONTROLLER, TRANSAC_UTIL]) delete require.cache[p];
});

test("bulk deletion is per-record safe: one failure does not roll back unrelated successes", async () => {
  const o1 = { _id: oid(), orderNumber:"ORD-OK", inventoryDeducted:false, items:[], customer:null };
  const o2 = { _id: oid(), orderNumber:"ORD-FAIL", inventoryDeducted:false, items:[], customer:null };
  const MENU_MODEL2 = require.resolve("../models/MenuItem");
  const SETTINGS_MODEL2 = require.resolve("../models/Settings");
  const LOYALTY_MODEL2 = require.resolve("../models/LoyaltyConfig");
  const COUPON_MODEL2 = require.resolve("../models/Coupon");
  const USER_MODEL2 = require.resolve("../models/User");
  stub(MENU_MODEL2, { findById: async()=>null });
  stub(SETTINGS_MODEL2, { getValue: async()=>null });
  stub(LOYALTY_MODEL2, { getConfig: async()=>({}) });
  stub(COUPON_MODEL2, { findValidForOrder: async()=>({coupon:null}) });
  stub(USER_MODEL2, {});
  const store = { orders: [o1,o2] };
  let callCount = 0;
  const mockSessionFactory = () => ({
    startTransaction(){},
    commitTransaction: async () => {},
    abortTransaction: async () => {},
    endSession(){},
  });
  const originalStartSession = mongoose.startSession;
  const originalReadyState = mongoose.connection.readyState;
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, writable: true, configurable: true });
  mongoose.startSession = async () => mockSessionFactory();

  const orderStub = {
    find: (q) => {
      const filtered = store.orders.filter(o=> q._id.$in.some(id=> eq(id,o._id)));
      const qq = { session: ()=> qq, then: (res)=> Promise.resolve(filtered).then(res), lean: ()=> Promise.resolve(filtered) };
      return qq;
    },
    findById: (id) => {
      const doc = store.orders.find(o=> eq(o._id,id));
      const q = { session: ()=> q, then: (r)=> Promise.resolve(doc).then(r) };
      return q;
    },
    deleteOne: (filter) => {
      const q = {
        session: ()=> q,
        then: (resolve, reject) => {
          callCount++;
          if (eq(filter._id, o2._id)) return Promise.reject(new Error("fail o2")).then(resolve, reject);
          const idx = store.orders.findIndex(o=> eq(o._id, filter._id));
          if (idx!==-1) store.orders.splice(idx,1);
          return Promise.resolve({deletedCount:1}).then(resolve);
        }
      };
      return q;
    }
  };
  stub(ORDER_MODEL, orderStub);
  stub(PAYMENT_MODEL, { deleteMany: ()=> ({ session: ()=> ({ then: (r)=> r({}) }), then: (r)=> r({}) }) });
  stub(STOCK_MODEL, { create: async()=>{}, deleteMany: ()=> ({ session: ()=> ({ then: (r)=> r({}) }), then: (r)=> r({}) }) });
  stub(HISTORY_MODEL, { deleteMany: ()=> ({ session: ()=> ({ then: (r)=> r({}) }), then: (r)=> r({}) }) });
  stub(NOTIF_MODEL, { deleteMany: ()=> ({ session: ()=> ({ then: (r)=> r({}) }), then: (r)=> r({}) }) });
  stub(TABLE_MODEL, { updateMany: ()=> ({ session: ()=> ({ then: (r)=> r({}) }), then: (r)=> r({}) }) });
  stub(CUSTOMER_MODEL, { findById: ()=> ({ session: ()=> ({ then: (r)=> r(null) }), then: (r)=> r(null) }) });
  stub(INVENTORY_MODEL, { findById: ()=> ({ session: ()=> ({ then: (r)=> r(null) }), then: (r)=> r(null) }) });
  stub(RECIPE_MODEL, { getByMenuItem: async()=>null });
  stub(require.resolve("../models/User"), { findById: async()=>null });
  stub(require.resolve("../utils/notificationService"), { createNotificationForAdmins: async()=>{} });
  stub(require.resolve("../utils/pagination"), { parsePagination: (q,d)=> ({page:1,limit:d||20,skip:0}) });
  stub(require.resolve("../services/thermalPrinter"), { print: async()=>{} });
  stub(require.resolve("../services/webPush"), { sendNewOrderNotification: async()=>{} });
  stub(require.resolve("../services/cashfree"), { createCashfreeOrder: async()=>{} });
  for (const p of [ORDER_CONTROLLER]) delete require.cache[p];
  const oc = require(ORDER_CONTROLLER);
  const res = makeRes();
  await oc.bulkDeleteOrders(adminReq({ ids:[String(o1._id), String(o2._id)] }), res);
  assert.equal(res._body.deletedCount, 1);
  assert.equal(res._body.blocked.length, 1);
  assert.equal(store.orders.length, 1);
  assert.equal(String(store.orders[0]._id), String(o2._id), "failed order should remain, successful should be deleted");
  assert.equal(res._body.missing.length, 0);

  mongoose.startSession = originalStartSession;
  Object.defineProperty(mongoose.connection, 'readyState', { value: originalReadyState, writable: true, configurable: true });
  for (const p of [ORDER_MODEL, PAYMENT_MODEL, STOCK_MODEL, TABLE_MODEL, NOTIF_MODEL, HISTORY_MODEL, CUSTOMER_MODEL, INVENTORY_MODEL, RECIPE_MODEL, ORDER_CONTROLLER, TRANSAC_UTIL]) delete require.cache[p];
});

test("transaction startup failure fails closed with zero destructive mutations", async () => {
  const { withTransaction, TRANSACTION_UNAVAILABLE_MESSAGE } = require(TRANSAC_UTIL);
  const orderId = oid();
  const order = { _id: orderId, orderNumber: "ORD-TX-FAIL-CLOSED", inventoryDeducted: false, items: [], customer: null };
  const store = { orders: [order], payments: [{ _id: oid(), order: orderId }] };
  // Force production-like fail-closed: disable test fallback
  const prevFlag = global.__ALLOW_NON_TRANSACTIONAL_FOR_TESTS;
  global.__ALLOW_NON_TRANSACTIONAL_FOR_TESTS = false;
  const originalReadyState = mongoose.connection.readyState;
  const originalStartSession = mongoose.startSession;
  Object.defineProperty(mongoose.connection, 'readyState', { value: 0, writable: true, configurable: true });
  mongoose.startSession = async () => { throw new Error("no transaction support"); };

  // 1) withTransaction must throw and never call fn
  let fnCalled = false;
  let threw = false;
  try {
    await withTransaction(async () => { fnCalled = true; });
  } catch (e) {
    threw = true;
    assert.equal(e.message, TRANSACTION_UNAVAILABLE_MESSAGE);
    assert.equal(e.statusCode, 500);
  }
  assert.equal(threw, true, "withTransaction should throw when transaction unavailable");
  assert.equal(fnCalled, false, "destructive callback must NOT be executed");

  // 2) bulkDeleteOrders must report blocked and leave store untouched
  const MENU_MODEL = require.resolve("../models/MenuItem");
  const SETTINGS_MODEL = require.resolve("../models/Settings");
  const LOYALTY_MODEL = require.resolve("../models/LoyaltyConfig");
  const COUPON_MODEL = require.resolve("../models/Coupon");
  const USER_MODEL = require.resolve("../models/User");
  stub(MENU_MODEL, { findById: async () => null });
  stub(SETTINGS_MODEL, { getValue: async () => null });
  stub(LOYALTY_MODEL, { getConfig: async () => ({}) });
  stub(COUPON_MODEL, { findValidForOrder: async () => ({ coupon: null }) });
  stub(USER_MODEL, {});

  const orderStub = {
    find: (q) => {
      const filtered = store.orders.filter((o) => q._id.$in.some((id) => eq(id, o._id)));
      const qq = { session: () => qq, then: (res) => Promise.resolve(filtered).then(res), lean: () => Promise.resolve(filtered) };
      return qq;
    },
    findById: (id) => store.orders.find((o) => eq(o._id, id)) || null,
    deleteOne: () => {
      assert.fail("Order.deleteOne must not be called when transaction is unavailable");
    },
  };
  const paymentStub = {
    deleteMany: () => {
      assert.fail("Payment.deleteMany must not be called when transaction is unavailable");
    },
  };
  stub(ORDER_MODEL, orderStub);
  stub(PAYMENT_MODEL, paymentStub);
  stub(STOCK_MODEL, { create: async () => {}, deleteMany: () => ({ session: () => ({ then: (r) => r({}) }), then: (r) => r({}) }) });
  stub(HISTORY_MODEL, { deleteMany: () => ({ session: () => ({ then: (r) => r({}) }), then: (r) => r({}) }) });
  stub(NOTIF_MODEL, { deleteMany: () => ({ session: () => ({ then: (r) => r({}) }), then: (r) => r({}) }) });
  stub(TABLE_MODEL, { updateMany: () => ({ session: () => ({ then: (r) => r({}) }), then: (r) => r({}) }) });
  stub(CUSTOMER_MODEL, { findById: () => ({ session: () => ({ then: (r) => r(null) }), then: (r) => r(null) }) });
  stub(INVENTORY_MODEL, { findById: () => ({ session: () => ({ then: (r) => r(null) }), then: (r) => r(null) }) });
  stub(RECIPE_MODEL, { getByMenuItem: async () => null });
  stub(require.resolve("../utils/notificationService"), { createNotificationForAdmins: async () => {} });
  stub(require.resolve("../utils/pagination"), { parsePagination: (q, d) => ({ page: 1, limit: d || 20, skip: 0 }) });
  stub(require.resolve("../services/thermalPrinter"), { print: async () => {} });
  stub(require.resolve("../services/webPush"), { sendNewOrderNotification: async () => {} });
  stub(require.resolve("../services/cashfree"), { createCashfreeOrder: async () => {} });
  for (const p of [ORDER_CONTROLLER]) delete require.cache[p];
  const oc = require(ORDER_CONTROLLER);
  const res = makeRes();
  await oc.bulkDeleteOrders(adminReq({ ids: [String(orderId)] }), res);
  assert.equal(res._body.deletedCount, 0, "nothing should be deleted");
  assert.equal(res._body.blocked.length, 1, "record should be reported as blocked");
  assert.match(res._body.blocked[0].reason, /transaction is unavailable/i);
  assert.equal(store.orders.length, 1, "order must still exist – zero mutations");
  assert.equal(store.payments.length, 1, "payments must still exist – zero mutations");

  // Also verify single delete returns 500
  const singleRes = makeRes();
  await oc.deleteOrder({ params: { id: String(orderId) }, user: { _id: oid(), role: "admin" } }, singleRes);
  assert.equal(singleRes._status, 500);
  assert.match(singleRes._body.message, /transaction is unavailable/i);

  // restore
  global.__ALLOW_NON_TRANSACTIONAL_FOR_TESTS = prevFlag;
  mongoose.startSession = originalStartSession;
  Object.defineProperty(mongoose.connection, 'readyState', { value: originalReadyState, writable: true, configurable: true });
  for (const p of [ORDER_MODEL, PAYMENT_MODEL, STOCK_MODEL, TABLE_MODEL, NOTIF_MODEL, HISTORY_MODEL, CUSTOMER_MODEL, INVENTORY_MODEL, RECIPE_MODEL, ORDER_CONTROLLER, TRANSAC_UTIL, MENU_MODEL, SETTINGS_MODEL, LOYALTY_MODEL, COUPON_MODEL, USER_MODEL]) delete require.cache[p];
});

after(()=> {
  for (const p of [ORDER_MODEL, PAYMENT_MODEL, STOCK_MODEL, TABLE_MODEL, NOTIF_MODEL, HISTORY_MODEL, CUSTOMER_MODEL, INVENTORY_MODEL, RECIPE_MODEL, PO_MODEL, WASTE_MODEL, TRANSAC_UTIL, ORDER_CONTROLLER]) try{ delete require.cache[p]; }catch{}
});
