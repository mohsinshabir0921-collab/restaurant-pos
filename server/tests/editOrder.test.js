const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

process.env.CASHFREE_WEBHOOK_SECRET = "test_webhook_secret";
process.env.CASHFREE_CLIENT_ID = "test_client_id";
process.env.CASHFREE_CLIENT_SECRET = "test_client_secret";

const ORDER_MODEL = require.resolve("../models/Order");
const USER_MODEL = require.resolve("../models/User");
const MENU_MODEL = require.resolve("../models/MenuItem");
const CUSTOMER_MODEL = require.resolve("../models/Customer");
const TABLE_MODEL = require.resolve("../models/Table");
const SETTINGS_MODEL = require.resolve("../models/Settings");
const LOYALTY_MODEL = require.resolve("../models/LoyaltyConfig");
const COUPON_MODEL = require.resolve("../models/Coupon");
const PAYMENT_MODEL = require.resolve("../models/Payment");
const INVENTORY_MODEL = require.resolve("../models/InventoryItem");
const RECIPE_MODEL = require.resolve("../models/Recipe");
const STOCK_MODEL = require.resolve("../models/StockMovement");
const ORDER_EDIT_HISTORY_MODEL = require.resolve("../models/OrderEditHistory");
const DELIVERY_LOCATION_MODEL = require.resolve("../models/DeliveryLocation");
const PROMO_UTIL = require.resolve("../utils/promo");
const NOTIFICATION_SERVICE = require.resolve("../utils/notificationService");
const PAGINATION_UTIL = require.resolve("../utils/pagination");
const THERMAL_PRINTER = require.resolve("../services/thermalPrinter");
const WEB_PUSH = require.resolve("../services/webPush");
const ORDER_CONTROLLER = require.resolve("../controllers/orderController");
const ORDER_ROUTES = require.resolve("../routes/orderRoutes");

const stubModule = (absPath, exports) => {
  require.cache[absPath] = {
    id: absPath,
    filename: absPath,
    loaded: true,
    exports,
  };
};

const matchFilter = (doc, filter) =>
  Object.entries(filter).every(([key, value]) => {
    if (value instanceof Date) {
      return new Date(doc[key]).getTime() === value.getTime();
    }
    if (value && typeof value === "object") {
      if (value.$gt !== undefined) return Number(doc[key]) > value.$gt;
      if (value.$ne !== undefined) return doc[key] !== value.$ne;
      return doc[key] === value;
    }
    return doc[key] === value;
  });

const createStubs = () => {
  const store = {
    settings: {},
    menuItems: [],
    orders: [],
    payments: [],
    inventory: [],
    recipes: [],
    stockMovements: [],
    editHistories: [],
    latestLocation: null,
  };

  const Settings = {
    getValue: async (key, defaultValue = null) =>
      store.settings[key] !== undefined ? store.settings[key] : defaultValue,
  };

  const MenuItem = {
    findById: async (id) =>
      store.menuItems.find((m) => String(m._id) === String(id)) || null,
  };

  const User = {};
  const Customer = {};
  const Table = {};
  const Coupon = {};
  const DeliveryLocation = {
    findOne: () => ({ sort: () => ({ lean: async () => store.latestLocation }) }),
    create: async (doc) => ({ _id: new mongoose.Types.ObjectId(), ...doc }),
  };

  const LoyaltyConfig = {
    getConfig: async () => ({ pointsPerRupee: 1, rupeePerPoint: 1, minPointsToRedeem: 100 }),
  };

  const Order = {
    findById: (id) => {
      const doc = store.orders.find((o) => String(o._id) === String(id)) || null;
      // A hydrated snapshot: findOneAndUpdate must never mutate the doc object
      // the controller already holds (it reads OLD values from it for history).
      const snapshot = doc ? { ...doc } : null;
      const query = {
        populate: () => query,
        lean: async () => snapshot,
        then: (resolve, reject) => Promise.resolve(snapshot).then(resolve, reject),
      };
      return query;
    },
    findOneAndUpdate: async (filter, update) => {
      const doc = store.orders.find((o) => String(o._id) === String(filter._id));
      if (!doc) return null;
      const f = { ...filter };
      if (f.updatedAt !== undefined) {
        const base = new Date(f.updatedAt).getTime();
        if (base !== new Date(doc.updatedAt).getTime()) return null;
        delete f.updatedAt;
      }
      if (!matchFilter(doc, f)) return null;
      // Updating the DB and returning the fresh document must not mutate the
      // original hydrated doc the controller still holds (it needs the OLD
      // values for the audit snapshot).
      const updatedDoc = { ...doc };
      Object.assign(updatedDoc, update.$set || {});
      Object.assign(doc, update.$set || {});
      return updatedDoc;
    },
    updateOne: async (filter, update) => {
      const doc = store.orders.find((o) => String(o._id) === String(filter._id));
      if (doc) Object.assign(doc, update.$set || {});
      return { modifiedCount: doc ? 1 : 0 };
    },
  };

  const Payment = {
    find: async (filter) =>
      store.payments.filter((p) =>
        Object.entries(filter).every(([key, value]) => p[key] === value)
      ),
    create: async (data) => {
      const rec = { _id: "pay_manual", ...data };
      store.payments.push(rec);
      return rec;
    },
  };

  const InventoryItem = {
    findById: async (id) => {
      const target = store.inventory.find((i) => String(i._id) === String(id));
      if (!target) return null;
      if (typeof target.adjustStock !== "function") {
        target.adjustStock = async (quantity, reason, referenceId, referenceType, createdBy) => {
          const previousStock = Number(target.currentStock) || 0;
          const newStock = Math.max(0, previousStock + quantity);
          target.currentStock = newStock;
          return {
            item: target._id,
            type: quantity > 0 ? "in" : "out",
            quantity: Math.abs(quantity),
            previousStock,
            newStock,
            reason,
            referenceId,
            referenceType,
            createdBy,
          };
        };
      }
      return target;
    },
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

  const OrderEditHistory = {
    create: async (data) => {
      store.editHistories.push(data);
      return data;
    },
    deleteOne: async () => ({}),
  };

  stubModule(ORDER_MODEL, Order);
  stubModule(USER_MODEL, User);
  stubModule(MENU_MODEL, MenuItem);
  stubModule(CUSTOMER_MODEL, Customer);
  stubModule(TABLE_MODEL, Table);
  stubModule(SETTINGS_MODEL, Settings);
  stubModule(LOYALTY_MODEL, LoyaltyConfig);
  stubModule(COUPON_MODEL, Coupon);
  stubModule(PAYMENT_MODEL, Payment);
  stubModule(INVENTORY_MODEL, InventoryItem);
  stubModule(RECIPE_MODEL, Recipe);
  stubModule(STOCK_MODEL, StockMovement);
  stubModule(ORDER_EDIT_HISTORY_MODEL, OrderEditHistory);
  stubModule(DELIVERY_LOCATION_MODEL, DeliveryLocation);
  stubModule(PROMO_UTIL, { isPromoEligible: () => true });
  stubModule(NOTIFICATION_SERVICE, { createNotificationForAdmins: async () => {} });
  stubModule(PAGINATION_UTIL, { parsePagination: () => ({ page: 1, limit: 10 }) });
  stubModule(THERMAL_PRINTER, {});
  stubModule(WEB_PUSH, class WebPushServiceStub {});

  return store;
};

// menuItemIds must be strings that pass mongoose.Types.ObjectId.isValid.
const MENU_A = "aaaaaaaaaaaaaaaaaaaaaaa1";
const MENU_B = "bbbbbbbbbbbbbbbbbbbbbbb2";
const MENU_UNKNOWN = "ccccccccccccccccccccccc3";

const freshLoad = () => {
  const store = createStubs();
  for (const absPath of [ORDER_CONTROLLER, ORDER_ROUTES]) {
    delete require.cache[absPath];
  }
  const orderController = require(ORDER_CONTROLLER);
  const orderRoutes = require(ORDER_ROUTES);
  return { store, orderController, orderRoutes };
};

const setupMenu = (store) => {
  store.settings = { restaurant_state: "Karnataka", delivery_fee: 0 };
  const a = { _id: MENU_A, name: "Pizza", price: 100, isAvailable: true, isVeg: true, taxRate: 0, category: null, modifiers: [] };
  const b = { _id: MENU_B, name: "Burger", price: 200, isAvailable: true, isVeg: false, taxRate: 0, category: null, modifiers: [
    {
      name: "Size",
      required: true,
      multiSelect: false,
      minSelections: 1,
      maxSelections: 1,
      options: [
        { name: "Regular", price: 0 },
        { name: "Large", price: 50 },
      ],
    },
  ] };
  store.menuItems = [a, b];
  return { a, b };
};

const setupRecipe = (store, menuId, ingredients) => {
  store.recipes.push({
    menuItemId: menuId,
    isActive: true,
    ingredients: ingredients.map(({ invId, qty }) => ({
      item: { _id: invId },
      quantity: qty,
    })),
  });
};

const makeOrderDoc = (overrides = {}) => {
  const doc = {
    _id: overrides._id || new mongoose.Types.ObjectId(),
    orderNumber: overrides.orderNumber || "ORD200000002",
    customer: overrides.customer ?? null,
    customerName: overrides.customerName || "Test Customer",
    customerPhone: overrides.customerPhone || "9876543210",
    table: overrides.table ?? null,
    orderType: overrides.orderType || "dinein",
    items: overrides.items || [
      { menuItemId: MENU_A, name: "Pizza", price: 100, qty: 2, size: "", modifiers: [], notes: "", category: null, isVeg: true, taxRate: 0, kitchenStatus: "pending", kitchenStation: "", servedAt: null },
    ],
    subtotal: overrides.subtotal !== undefined ? overrides.subtotal : 200,
    tax: overrides.tax ?? 0,
    cgst: overrides.cgst ?? 0,
    sgst: overrides.sgst ?? 0,
    igst: overrides.igst ?? 0,
    serviceCharge: overrides.serviceCharge ?? 0,
    discount: overrides.discount ?? 0,
    discountType: overrides.discountType || "flat",
    couponCode: overrides.couponCode ?? null,
    deliveryFee: overrides.deliveryFee ?? 0,
    loyaltyPointsUsed: overrides.loyaltyPointsUsed ?? 0,
    total: overrides.total !== undefined ? overrides.total : 200,
    paymentStatus: overrides.paymentStatus || "pending",
    paymentMethod: overrides.paymentMethod || "cash",
    paymentGateway: overrides.paymentGateway || null,
    orderStatus: overrides.orderStatus || "pending",
    deliveryAddress: overrides.deliveryAddress ?? null,
    inventoryDeducted: overrides.inventoryDeducted ?? false,
    additionalAmountDue: overrides.additionalAmountDue ?? 0,
    refundAmountDue: overrides.refundAmountDue ?? 0,
    additionalPaymentInProgress: overrides.additionalPaymentInProgress ?? false,
    createdBy: overrides.createdBy || "user_1",
    servedBy: overrides.servedBy ?? null,
    paidAt: overrides.paidAt ?? null,
    updatedAt: overrides.updatedAt || new Date("2026-08-17T10:00:00Z"),
  };
  doc.canTransitionTo = function (status) {
    const transitions = {
      pending: ["confirmed", "preparing", "cancelled"],
      confirmed: ["preparing", "cancelled"],
      preparing: ["ready", "served", "cancelled"],
      ready: ["served", "cancelled"],
      served: ["paid", "completed", "cancelled"],
      paid: ["completed", "cancelled"],
    };
    return (transitions[this.orderStatus] || []).includes(status);
  };
  doc.transitionTo = async function (status, userId) {
    this.orderStatus = status;
    if (userId) this.updatedBy = userId;
    return this;
  };
  doc.save = async function () {
    return this;
  };
  return doc;
};

const makeReq = (overrides = {}) => ({
  params: overrides.params || { id: "ord_default" },
  body: overrides.body || {},
  user: overrides.user || { _id: "user_1", name: "Admin", role: "admin" },
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

const getRouteHandlers = (router, method, path) => {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack.map((l) => l.handle);
    }
  }
  throw new Error(`Route ${method} ${path} not found`);
};

const editReq = (order, requestItems, extra = {}) =>
  makeReq({
    params: { id: order._id },
    body: {
      items: requestItems,
      reason: extra.reason,
      baseUpdatedAt: extra.baseUpdatedAt,
    },
    user: extra.user || { _id: "user_1", name: "Waitress", role: "admin" },
  });

const runEdit = async (d, order, requestItems, extra = {}) => {
  const res = makeRes();
  await d.orderController.editOrderItems(editReq(order, requestItems, extra), res);
  return res;
};

const item = (menuItemId, qty, extra = {}) => ({
  menuItemId,
  qty,
  modifiers: extra.modifiers || [],
  size: extra.size || "",
  notes: extra.notes || "",
});

// ---------------------------------------------------------------------------
// 1. Server-authoritative recalculation
// ---------------------------------------------------------------------------

test("valid edit recomputes totals server-side and ignores client-supplied financials", async () => {
  const d = freshLoad();
  setupMenu(d.store);
  const order = makeOrderDoc({ orderStatus: "pending", paymentStatus: "pending" });
  d.store.orders.push(order);

  // The client tries to tamper: sends a made-up price, name and modifier fee.
  const res = await runEdit(d, order, [
    { ...item(MENU_A, 1), price: 1, name: "Hacked Pizza" },
  ]);

  assert.equal(res._status, 200, JSON.stringify(res._body));
  assert.equal(res._body.order.subtotal, 100);
  assert.equal(res._body.order.total, 100);
  assert.equal(res._body.order.items[0].name, "Pizza");
  assert.equal(res._body.order.items[0].price, 100, "price must come from the menu");
  assert.equal(res._body.order.items[0].qty, 1);
  assert.equal(res._body.order.tax, 0);
  assert.equal(res._body.edit.difference, -100);
});

// ---------------------------------------------------------------------------
// 2. Status restrictions
// ---------------------------------------------------------------------------

test("edit rejects non-editable order statuses", async () => {
  const d = freshLoad();
  setupMenu(d.store);

  for (const status of Object.freeze(["ready", "served", "out_for_delivery", "delivered", "completed", "cancelled", "refunded"])) {
    const order = makeOrderDoc({ orderStatus: status });
    d.store.orders.push(order);
    const res = await runEdit(d, order, [item(MENU_A, 2)]);
    assert.equal(res._status, 400, `status ${status} must be rejected`);
    assert.match(res._body.message, new RegExp(status));
  }
});

// ---------------------------------------------------------------------------
// 3. Menu validation
// ---------------------------------------------------------------------------

test("edit rejects unavailable, unknown or malformed menu items", async () => {
  const d = freshLoad();
  setupMenu(d.store);

  const unavail = makeOrderDoc();
  d.store.menuItems[0].isAvailable = false;
  d.store.orders.push(unavail);
  const resUnavail = await runEdit(d, unavail, [item(MENU_A, 1)]);
  assert.equal(resUnavail._status, 400);
  assert.match(resUnavail._body.message, /not currently available/i);

  const unknown = makeOrderDoc({ _id: new mongoose.Types.ObjectId() });
  d.store.orders.push(unknown);
  const resUnknown = await runEdit(d, unknown, [item(MENU_UNKNOWN, 1)]);
  assert.equal(resUnknown._status, 400);
  assert.match(resUnknown._body.message, /not found/i);

  const malformed = makeOrderDoc({ _id: new mongoose.Types.ObjectId() });
  d.store.orders.push(malformed);
  const resMalformed = await runEdit(d, malformed, [item("not-an-object-id", 1)]);
  assert.equal(resMalformed._status, 400);
  assert.match(resMalformed._body.message, /valid menu item/i);
});

// ---------------------------------------------------------------------------
// 4. Quantity validation
// ---------------------------------------------------------------------------

test("edit rejects invalid quantities", async () => {
  const d = freshLoad();
  setupMenu(d.store);

  for (const qty of [0, -2, 1.5, "abc"]) {
    const order = makeOrderDoc({ _id: new mongoose.Types.ObjectId() });
    d.store.orders.push(order);
    const res = await runEdit(d, order, [item(MENU_A, qty)]);
    assert.equal(res._status, 400, `qty ${qty} must be rejected`);
    assert.match(res._body.message, /quantity/i);
  }
});

// ---------------------------------------------------------------------------
// 5. Modifier validation against the menu
// ---------------------------------------------------------------------------

test("edit validates modifiers (required group, options, multiplicity)", async () => {
  const d = freshLoad();
  setupMenu(d.store);

  // Missing the required "Size" group.
  const order = makeOrderDoc({ _id: new mongoose.Types.ObjectId() });
  d.store.orders.push(order);
  const resMissing = await runEdit(d, order, [item(MENU_B, 1)]);
  assert.equal(resMissing._status, 400);
  assert.match(resMissing._body.message, /required/i);

  // Unknown option inside a known group.
  const order2 = makeOrderDoc({ _id: new mongoose.Types.ObjectId() });
  d.store.orders.push(order2);
  const resOption = await runEdit(d, order2, [
    item(MENU_B, 1, { modifiers: [{ name: "Size", option: "Huge" }] }),
  ]);
  assert.equal(resOption._status, 400);
  assert.match(resOption._body.message, /invalid option/i);

  // Unknown modifier group.
  const order3 = makeOrderDoc({ _id: new mongoose.Types.ObjectId() });
  d.store.orders.push(order3);
  const resGroup = await runEdit(d, order3, [
    item(MENU_B, 1, { modifiers: [{ name: "Spice", option: "High" }] }),
  ]);
  assert.equal(resGroup._status, 400);
  assert.match(resGroup._body.message, /invalid modifier/i);

  // Too many selections for a single-select group.
  const order5 = makeOrderDoc({ _id: new mongoose.Types.ObjectId() });
  d.store.orders.push(order5);
  const resTooMany = await runEdit(d, order5, [
    item(MENU_B, 1, {
      modifiers: [
        { name: "Size", option: "Regular" },
        { name: "Size", option: "Large" },
      ],
    }),
  ]);
  assert.equal(resTooMany._status, 400);
  assert.match(resTooMany._body.message, /too many selections|only one option/i);

  // Valid selection: Large applies the +50 menu price server-side.
  const order4 = makeOrderDoc({ _id: new mongoose.Types.ObjectId() });
  d.store.orders.push(order4);
  const resOk = await runEdit(d, order4, [
    item(MENU_B, 2, { modifiers: [{ name: "Size", option: "Large" }] }),
  ]);
  assert.equal(resOk._status, 200, JSON.stringify(resOk._body));
  assert.equal(resOk._body.order.items[0].price, 250);
  assert.equal(resOk._body.order.items[0].size, "Large");
  assert.equal(resOk._body.order.total, 500);
});

// ---------------------------------------------------------------------------
// 6. Empty / missing items
// ---------------------------------------------------------------------------

test("edit rejects empty items arrays", async () => {
  const d = freshLoad();
  setupMenu(d.store);
  const order = makeOrderDoc();
  d.store.orders.push(order);

  const res = makeRes();
  await d.orderController.editOrderItems(
    makeReq({ params: { id: order._id }, body: { items: [] } }),
    res
  );
  assert.equal(res._status, 400);
  assert.match(res._body.message, /Items are required/);
});

// ---------------------------------------------------------------------------
// 7. Paid order increase -> partial + additionalAmountDue
// ---------------------------------------------------------------------------

test("increasing a paid order creates additional amount due and marks it partial", async () => {
  const d = freshLoad();
  setupMenu(d.store);
  const order = makeOrderDoc({ orderStatus: "paid", paymentStatus: "paid" });
  d.store.orders.push(order);

  const res = await runEdit(d, order, [item(MENU_A, 5)]);
  assert.equal(res._status, 200, JSON.stringify(res._body));
  assert.equal(res._body.order.total, 500);
  assert.equal(res._body.order.paymentStatus, "partial");
  assert.equal(res._body.order.additionalAmountDue, 300);
  assert.equal(res._body.order.refundAmountDue, 0);
  assert.equal(res._body.edit.additionalAmountDue, 300);
  assert.equal(res._body.edit.refundAmountDue, 0);
});

// ---------------------------------------------------------------------------
// 8. Paid order decrease -> refundAmountDue, no auto-refund
// ---------------------------------------------------------------------------

test("decreasing a paid order records refund amount due but never auto-refunds", async () => {
  const d = freshLoad();
  setupMenu(d.store);
  const order = makeOrderDoc({ orderStatus: "paid", paymentStatus: "paid" });
  d.store.orders.push(order);

  const res = await runEdit(d, order, [item(MENU_A, 1)]);
  assert.equal(res._status, 200, JSON.stringify(res._body));
  assert.equal(res._body.order.total, 100);
  assert.equal(res._body.order.paymentStatus, "paid");
  assert.equal(res._body.order.refundAmountDue, 100);
  assert.equal(res._body.order.additionalAmountDue, 0);
  assert.equal(d.store.payments.length, 0, "no refund ledger row or auto-refund created");
});

// ---------------------------------------------------------------------------
// 9. Unpaid orders
// ---------------------------------------------------------------------------

test("editing an unpaid order keeps it pending with no payment deltas", async () => {
  const d = freshLoad();
  setupMenu(d.store);
  const order = makeOrderDoc({ orderStatus: "pending", paymentStatus: "pending" });
  d.store.orders.push(order);

  const res = await runEdit(d, order, [item(MENU_A, 3)]);
  assert.equal(res._status, 200, JSON.stringify(res._body));
  assert.equal(res._body.order.paymentStatus, "pending");
  assert.equal(res._body.order.additionalAmountDue, 0);
  assert.equal(res._body.order.refundAmountDue, 0);
});

// ---------------------------------------------------------------------------
// 10. Discount preserved flat, coupon cleared
// ---------------------------------------------------------------------------

test("discount is preserved as a flat amount and the coupon code is cleared", async () => {
  const d = freshLoad();
  setupMenu(d.store);
  const order = makeOrderDoc({
    discount: 20,
    discountType: "percent",
    couponCode: "FLAT10",
    total: 180,
    subtotal: 200,
  });
  d.store.orders.push(order);

  const res = await runEdit(d, order, [item(MENU_A, 2)]);
  assert.equal(res._status, 200, JSON.stringify(res._body));
  assert.equal(res._body.order.discount, 20);
  assert.equal(res._body.order.discountType, "flat");
  assert.equal(res._body.order.couponCode, null);
  assert.equal(res._body.order.total, 180);
});

test("discount clamps to the new subtotal when the order shrinks", async () => {
  const d = freshLoad();
  setupMenu(d.store);
  const order = makeOrderDoc({
    discount: 150,
    discountType: "flat",
    total: 50,
    subtotal: 200,
  });
  d.store.orders.push(order);

  const res = await runEdit(d, order, [item(MENU_A, 1)]);
  assert.equal(res._status, 200, JSON.stringify(res._body));
  assert.equal(res._body.order.subtotal, 100);
  assert.equal(res._body.order.discount, 100, "discount can never exceed subtotal");
  assert.equal(res._body.order.total, 0);
});

// ---------------------------------------------------------------------------
// 11. Optimistic concurrency
// ---------------------------------------------------------------------------

test("stale baseUpdatedAt is rejected with 409 and the order is untouched", async () => {
  const d = freshLoad();
  setupMenu(d.store);
  const order = makeOrderDoc({
    items: [item(MENU_A, 2)],
    updatedAt: new Date("2026-08-17T10:00:00Z"),
  });
  d.store.orders.push(order);

  const res = await runEdit(d, order, [item(MENU_A, 4)], {
    baseUpdatedAt: new Date("2026-08-17T09:00:00Z"),
  });
  assert.equal(res._status, 409);
  assert.equal(order.items[0].qty, 2, "order must not be modified");
  assert.equal(d.store.editHistories.length, 0, "no audit entry on conflict");
});

test("matching baseUpdatedAt commits the edit", async () => {
  const d = freshLoad();
  setupMenu(d.store);
  const order = makeOrderDoc();
  d.store.orders.push(order);

  const res = await runEdit(d, order, [item(MENU_A, 4)], {
    baseUpdatedAt: order.updatedAt,
  });
  assert.equal(res._status, 200, JSON.stringify(res._body));
  assert.equal(order.items[0].qty, 4);
});

// ---------------------------------------------------------------------------
// 12. Inventory reconciliation by net delta
// ---------------------------------------------------------------------------

test("inventory reconciles the net delta for an increase on a deducted order", async () => {
  const d = freshLoad();
  setupMenu(d.store);
  setupRecipe(d.store, MENU_A, [{ invId: "inv_A", qty: 2 }]);
  const invA = { _id: "inv_A", name: "Dough", unit: "g", currentStock: 10, reorderLevel: 2 };
  d.store.inventory = [invA];

  const order = makeOrderDoc({
    orderStatus: "paid",
    paymentStatus: "paid",
    inventoryDeducted: true,
    items: [item(MENU_A, 2)],
    total: 200,
    subtotal: 200,
  });
  d.store.orders.push(order);

  const res = await runEdit(d, order, [item(MENU_A, 3)]);
  assert.equal(res._status, 200, JSON.stringify(res._body));
  assert.equal(invA.currentStock, 8, "+1 item x 2 units consumed");
  assert.equal(res._body.edit.inventoryReconciled, true);

  const movement = d.store.stockMovements.find((m) => m.referenceId === order._id);
  assert.ok(movement, "a stock movement must be recorded");
  assert.equal(movement.type, "out");
  assert.equal(movement.quantity, 2);
  assert.equal(movement.previousStock, 10);
  assert.equal(movement.newStock, 8);
  assert.equal(movement.referenceType, "order_edit");
});

test("inventory restores the net difference when items are removed", async () => {
  const d = freshLoad();
  setupMenu(d.store);
  setupRecipe(d.store, MENU_A, [{ invId: "inv_A", qty: 2 }]);
  const invA = { _id: "inv_A", name: "Dough", unit: "g", currentStock: 4, reorderLevel: 2 };
  d.store.inventory = [invA];

  const order = makeOrderDoc({
    orderStatus: "paid",
    paymentStatus: "paid",
    inventoryDeducted: true,
    items: [item(MENU_A, 3)],
    total: 300,
    subtotal: 300,
  });
  d.store.orders.push(order);

  const res = await runEdit(d, order, [item(MENU_A, 1)]);
  assert.equal(res._status, 200, JSON.stringify(res._body));
  assert.equal(invA.currentStock, 8, "-2 items x 2 units restored");
});

test("inventory shortage on an increase rejects the whole edit with zero writes", async () => {
  const d = freshLoad();
  setupMenu(d.store);
  setupRecipe(d.store, MENU_A, [{ invId: "inv_A", qty: 2 }]);
  const invA = { _id: "inv_A", name: "Dough", unit: "g", currentStock: 2, reorderLevel: 2 };
  d.store.inventory = [invA];

  const order = makeOrderDoc({
    orderStatus: "paid",
    paymentStatus: "paid",
    inventoryDeducted: true,
    items: [item(MENU_A, 1)],
    total: 100,
    subtotal: 100,
  });
  d.store.orders.push(order);

  const res = await runEdit(d, order, [item(MENU_A, 3)]);
  assert.equal(res._status, 400);
  assert.match(res._body.message, /Insufficient inventory/);
  assert.equal(order.items[0].qty, 1, "order must not be modified");
  assert.equal(invA.currentStock, 2, "stock must not move");
  assert.equal(d.store.stockMovements.length, 0, "no stock movements recorded");
  assert.equal(d.store.editHistories.length, 0, "no audit entry on rejection");
});

// ---------------------------------------------------------------------------
// 13. Kitchen lifecycle state carries only for unchanged items
// ---------------------------------------------------------------------------

test("unchanged items keep kitchen state; changed items reset to pending", async () => {
  const d = freshLoad();
  setupMenu(d.store);
  const servedAt = new Date("2026-08-17T11:00:00Z");
  const order = makeOrderDoc({
    items: [
      { ...item(MENU_A, 2), name: "Pizza", price: 100, kitchenStatus: "preparing", kitchenStation: "grill-1", servedAt: null },
      { ...item(MENU_B, 1, { modifiers: [{ name: "Size", option: "Regular" }] }), name: "Burger", price: 200, kitchenStatus: "ready", kitchenStation: "fry-2", servedAt },
    ],
    total: 400,
    subtotal: 400,
  });
  d.store.orders.push(order);

  // menu_A unchanged (same qty), menu_B quantity changed 1 -> 3.
  const res = await runEdit(d, order, [
    item(MENU_A, 2),
    item(MENU_B, 3, { modifiers: [{ name: "Size", option: "Regular" }] }),
  ]);
  assert.equal(res._status, 200, JSON.stringify(res._body));

  const [a, b] = res._body.order.items;
  assert.equal(a.kitchenStatus, "preparing", "unchanged item keeps kitchen status");
  assert.equal(a.kitchenStation, "grill-1");
  assert.equal(a.kitchenStatusUnchanged, true);
  assert.equal(b.kitchenStatus, "pending", "changed item resets to pending");
  assert.equal(b.kitchenStation, "");
  assert.equal(b.servedAt, null);
});

// ---------------------------------------------------------------------------
// 14. Audit trail
// ---------------------------------------------------------------------------

test("every successful edit writes an OrderEditHistory snapshot", async () => {
  const d = freshLoad();
  setupMenu(d.store);
  const order = makeOrderDoc({ orderStatus: "paid", paymentStatus: "paid" });
  d.store.orders.push(order);

  const res = await runEdit(d, order, [item(MENU_A, 5)], { reason: "customer added guests" });
  assert.equal(res._status, 200, JSON.stringify(res._body));

  assert.equal(d.store.editHistories.length, 1);
  const rec = d.store.editHistories[0];
  assert.equal(String(rec.order), String(order._id));
  assert.equal(rec.orderNumber, order.orderNumber);
  assert.equal(rec.editedBy, "user_1");
  assert.equal(rec.reason, "customer added guests");
  assert.equal(rec.previousTotal, 200);
  assert.equal(rec.newTotal, 500);
  assert.equal(rec.difference, 300);
  assert.deepEqual(rec.previousItems, [
    { name: "Pizza", price: 100, qty: 2, menuItemId: MENU_A, size: "", modifiers: [], notes: "" },
  ]);
  assert.equal(rec.paymentRequirement, 300);
  assert.equal(rec.refundRequirement, 0);
});

// ---------------------------------------------------------------------------
// 15. Manual additional payment collection
// ---------------------------------------------------------------------------

test("collect additional payment settles the delta and marks the order paid", async () => {
  const d = freshLoad();
  setupMenu(d.store);
  const order = makeOrderDoc({
    orderStatus: "paid",
    paymentStatus: "partial",
    items: [item(MENU_A, 5)],
    total: 500,
    subtotal: 500,
    additionalAmountDue: 300,
  });
  d.store.orders.push(order);

  const res = makeRes();
  await d.orderController.collectAdditionalPayment(
    makeReq({
      params: { id: order._id },
      body: { method: "cash", notes: "customer paid" },
    }),
    res
  );

  assert.equal(res._status, 200, JSON.stringify(res._body));
  assert.equal(res._body.order.paymentStatus, "paid");
  assert.equal(res._body.order.additionalAmountDue, 0);
  assert.equal(d.store.payments.length, 1);
  const rec = d.store.payments[0];
  assert.equal(rec.amount, 300);
  assert.equal(rec.gateway, "manual");
  assert.equal(rec.status, "paid");
  assert.equal(rec.collectedBy, "user_1");
  assert.deepEqual(rec.metadata, { additionalPayment: true, reason: "order_edit" });
});

test("collect additional payment is rejected when nothing is due", async () => {
  const d = freshLoad();
  setupMenu(d.store);
  const order = makeOrderDoc({ additionalAmountDue: 0 });
  d.store.orders.push(order);

  const res = makeRes();
  await d.orderController.collectAdditionalPayment(
    makeReq({ params: { id: order._id }, body: { method: "cash" } }),
    res
  );
  assert.equal(res._status, 400);
  assert.match(res._body.message, /No additional payment is due/);
});

test("collect additional payment rejects unsupported methods", async () => {
  const d = freshLoad();
  setupMenu(d.store);
  const order = makeOrderDoc({ additionalAmountDue: 100 });
  d.store.orders.push(order);

  const res = makeRes();
  await d.orderController.collectAdditionalPayment(
    makeReq({ params: { id: order._id }, body: { method: "bitcoin" } }),
    res
  );
  assert.equal(res._status, 400);
  assert.match(res._body.message, /method/);
});

// ---------------------------------------------------------------------------
// 16. Completed transition guard
// ---------------------------------------------------------------------------

test("completed transition is blocked while additional payment is due", async () => {
  const d = freshLoad();
  setupMenu(d.store);
  const order = makeOrderDoc({
    orderStatus: "paid",
    paymentStatus: "partial",
    additionalAmountDue: 60,
  });
  d.store.orders.push(order);

  const [, , updateOrderStatus] = getRouteHandlers(d.orderRoutes, "patch", "/:id/status");
  const res = makeRes();
  await updateOrderStatus(
    makeReq({
      params: { id: order._id },
      body: { orderStatus: "completed" },
    }),
    res,
    {}
  );

  assert.equal(res._status, 400);
  assert.match(res._body.message, /additional payment due/);
  assert.equal(order.orderStatus, "paid", "status must not change");
});

// ---------------------------------------------------------------------------
// 17. Order identity is preserved
// ---------------------------------------------------------------------------

test("edit preserves _id, orderNumber, customer, table and orderType", async () => {
  const d = freshLoad();
  setupMenu(d.store);
  const orderId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const tableId = new mongoose.Types.ObjectId();
  const order = makeOrderDoc({
    _id: orderId,
    orderNumber: "ORDSEQUENCE123",
    customer: customerId,
    table: tableId,
    orderType: "takeaway",
    items: [item(MENU_A, 1)],
    total: 100,
    subtotal: 100,
  });
  d.store.orders.push(order);

  const res = await runEdit(d, order, [item(MENU_A, 3)]);
  assert.equal(res._status, 200, JSON.stringify(res._body));
  assert.equal(String(res._body.order._id), String(orderId));
  assert.equal(res._body.order.orderNumber, "ORDSEQUENCE123");
  assert.equal(res._body.order.customer, customerId);
  assert.equal(res._body.order.table, tableId);
  assert.equal(res._body.order.orderType, "takeaway");
});

// ---------------------------------------------------------------------------
// 18. Route registration + role authorization
// ---------------------------------------------------------------------------

test("edit and collect-additional routes are restricted to admin/cashier", () => {
  const d = freshLoad();

  for (const [method, path] of [
    ["put", "/:id/edit"],
    ["post", "/:id/collect-additional"],
  ]) {
    const handlers = getRouteHandlers(d.orderRoutes, method, path);
    assert.ok(handlers.length >= 3, `${method.toUpperCase()} ${path} needs protect + authorize + handler`);

    const [, authorize] = handlers;

    for (const role of ["admin", "cashier"]) {
      const res = makeRes();
      const next = makeNext();
      authorize(makeReq({ user: { _id: "u", role } }), res, next);
      assert.equal(next.called(), true, `${role} should pass ${method.toUpperCase()} ${path}`);
    }

    for (const role of ["kitchen", "delivery"]) {
      const res = makeRes();
      const next = makeNext();
      authorize(makeReq({ user: { _id: "u", role } }), res, next);
      assert.equal(res._status, 403, `${role} should be denied ${method.toUpperCase()} ${path}`);
      assert.equal(next.called(), false);
    }
  }
});