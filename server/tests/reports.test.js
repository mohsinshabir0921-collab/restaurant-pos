const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

// The Reports date-range controller reads orders via Order.find().lean() and
// reduces them in JS. We stub the Order model so the controller can be tested
// without a live database, proving the endpoint returns complete, correct data
// (the "Date Range stuck on Loading" bug is a frontend state-handling issue,
// not a backend failure).

const ORDER_MODEL = require.resolve("../models/Order");
const REPORT_CONTROLLER = require.resolve("../controllers/reportController");

const stubModule = (absPath, exports) => {
  require.cache[absPath] = {
    id: absPath,
    filename: absPath,
    loaded: true,
    exports,
  };
};

const makeOrder = (overrides = {}) => ({
  _id: "o1",
  orderNumber: "ORD-001",
  customerName: "Test Customer",
  orderType: "dinein",
  paymentMethod: "cash",
  paymentStatus: "paid",
  orderStatus: "completed",
  total: 100,
  subtotal: 80,
  tax: 10,
  cgst: 5,
  sgst: 5,
  igst: 0,
  serviceCharge: 5,
  discount: 0,
  deliveryFee: 0,
  createdAt: new Date("2026-08-10T10:00:00.000Z"),
  ...overrides,
});

const stubOrderModel = (orders) => ({
  find: (query) => {
    const range = query.createdAt;
    const filtered = orders.filter((o) => {
      if (!range) return true;
      const t = new Date(o.createdAt).getTime();
      if (range.$gte && t < new Date(range.$gte).getTime()) return false;
      if (range.$lte && t > new Date(range.$lte).getTime()) return false;
      return true;
    });
    return { lean: async () => filtered };
  },
});

const runController = async (fn, query) => {
  let statusCode = 200;
  let body = null;
  const req = { query };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };
  await fn(req, res);
  return { statusCode, body };
};

// Re-require the controller so it captures the current Order stub.
const loadController = () => {
  delete require.cache[REPORT_CONTROLLER];
  return require(REPORT_CONTROLLER);
};

test("getDateRangeReport returns 400 when dates are missing", async () => {
  stubModule(ORDER_MODEL, stubOrderModel([]));
  const reportController = loadController();
  const { statusCode, body } = await runController(
    reportController.getDateRangeReport,
    { startDate: "", endDate: "" }
  );
  assert.equal(statusCode, 400);
  assert.equal(body.success, false);
});

test("getDateRangeReport returns complete, accurate summary for a date range", async () => {
  const orders = [
    makeOrder({
      _id: "a1",
      orderNumber: "ORD-001",
      createdAt: new Date("2026-08-10T10:00:00.000Z"),
      total: 100,
      subtotal: 80,
      tax: 10,
      serviceCharge: 5,
      paymentMethod: "cash",
      orderType: "dinein",
    }),
    makeOrder({
      _id: "a2",
      orderNumber: "ORD-002",
      createdAt: new Date("2026-08-10T14:00:00.000Z"),
      total: 200,
      subtotal: 160,
      tax: 20,
      serviceCharge: 10,
      paymentMethod: "upi",
      orderType: "takeaway",
    }),
    makeOrder({
      _id: "a3",
      orderNumber: "ORD-003",
      createdAt: new Date("2026-08-11T09:00:00.000Z"),
      total: 50,
      subtotal: 40,
      tax: 5,
      serviceCharge: 2,
      paymentMethod: "cash",
      orderType: "delivery",
      orderStatus: "cancelled",
      paymentStatus: "pending",
    }),
  ];

  stubModule(ORDER_MODEL, stubOrderModel(orders));
  const reportController = loadController();
  const { statusCode, body } = await runController(
    reportController.getDateRangeReport,
    { startDate: "2026-08-10", endDate: "2026-08-11" }
  );

  assert.equal(statusCode, 200);
  assert.equal(body.success, true);
  // All 3 orders counted, only 2 are paid (cancelled excluded from paid).
  assert.equal(body.totalOrders, 3);
  assert.equal(body.paidOrders, 2);
  assert.equal(body.totalSales, 300);
  assert.equal(body.paidSales, 300);
  assert.equal(body.subtotal, 240);
  assert.equal(body.totalTax, 30);

  // Daily breakdown contains both days, keyed by %Y-%m-%d.
  assert.ok(Array.isArray(body.dailyBreakdown));
  assert.ok(body.dailyBreakdown.length >= 2);
  for (const day of body.dailyBreakdown) {
    assert.match(day.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(day.totalOrders > 0);
  }

  // Payment breakdown reflects the two methods used on unpaid-status orders.
  assert.equal(body.paymentBreakdown.cash.count, 2);
  assert.equal(body.paymentBreakdown.upi.count, 1);
  assert.equal(body.paymentBreakdown.cash.paidCount, 1);
  assert.equal(body.paymentBreakdown.upi.paidCount, 1);
});

after(() => mongoose.disconnect());
