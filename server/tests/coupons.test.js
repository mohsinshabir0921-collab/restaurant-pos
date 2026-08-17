const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret";
process.env.RAZORPAY_KEY_ID = "rzp_test_test_key_id";
process.env.RAZORPAY_KEY_SECRET = "test_key_secret";

const COUPON_MODEL = require.resolve("../models/Coupon");
const PUBLIC_ROUTES = require.resolve("../routes/publicRoutes");

const stubModule = (absPath, exports) => {
  require.cache[absPath] = {
    id: absPath,
    filename: absPath,
    loaded: true,
    exports,
  };
};

// The real validation engine. No DB connection is needed: isValid and
// calculateDiscount are pure, and findValidForOrder's only DB call is
// findOne, which we route to the in-memory store.
const CouponModel = require("../models/Coupon");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

// Mirrors exactly what the POS admin panel creates for TEST20: an active,
// unrestricted 20% percentage coupon valid now +7 days.
const makeCouponDoc = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  code: "TEST20",
  name: "Test 20",
  description: "",
  type: "percent",
  value: 20,
  maxDiscount: null,
  minOrderAmount: 0,
  applicableOrderTypes: ["dinein", "takeaway", "delivery"],
  applicableCategories: [],
  applicableItems: [],
  excludedCategories: [],
  excludedItems: [],
  usageLimit: null,
  usageCount: 0,
  usageLimitPerCustomer: 1,
  validFrom: new Date(NOW - DAY),
  validUntil: new Date(NOW + 7 * DAY),
  isActive: true,
  firstOrderOnly: false,
  customerTags: [],
  autoApply: false,
  stackable: false,
  ...overrides,
});

const createDeps = () => {
  const store = { coupons: [] };

  const Coupon = {
    findOne: async ({ code }) => {
      const doc = store.coupons.find((c) => c.code === code);
      return doc ? new CouponModel(doc) : null;
    },
    findById: async (id) => store.coupons.find((c) => String(c._id) === String(id)) || null,
  };
  // The real findValidForOrder static, backed by the in-memory findOne.
  Coupon.findValidForOrder = CouponModel.findValidForOrder.bind(Coupon);

  stubModule(COUPON_MODEL, Coupon);

  delete require.cache[PUBLIC_ROUTES];
  const publicRoutes = require(PUBLIC_ROUTES);

  return { store, Coupon, publicRoutes };
};

const getRouteHandlers = (router, method, path) => {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack.map((l) => l.handle);
    }
  }
  throw new Error(`Route ${method} ${path} not found`);
};

const makeReq = (query) => ({ query });
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

const deps = createDeps();
const [validateCoupon] = getRouteHandlers(deps.publicRoutes, "get", "/coupons/validate");

// ---------------------------------------------------------------------------
// Public validation of a POS-created coupon (the POS -> public checkout flow)
// ---------------------------------------------------------------------------

test("public /coupons/validate accepts a POS-created active percent coupon (TEST20) with 20% discount", async () => {
  deps.store.coupons = [makeCouponDoc()];
  const req = makeReq({ code: "TEST20", orderAmount: 500, orderType: "takeaway" });
  const res = makeRes();
  await validateCoupon(req, res);

  assert.equal(res._status, 200);
  assert.equal(res._body.success, true);
  assert.equal(res._body.coupon.code, "TEST20");
  assert.equal(res._body.coupon.type, "percent");
  assert.equal(res._body.coupon.value, 20);
  assert.equal(res._body.coupon.discount, 100);
});

test("TEST20 applies 20% discount matching the checkout subtotal (e.g. 650 -> 130)", async () => {
  deps.store.coupons = [makeCouponDoc()];
  const req = makeReq({ code: "TEST20", orderAmount: 650, orderType: "takeaway" });
  const res = makeRes();
  await validateCoupon(req, res);

  assert.equal(res._status, 200);
  assert.equal(res._body.coupon.discount, 130);
});

test("a valid unrestricted coupon is accepted for every supported order type", async () => {
  deps.store.coupons = [makeCouponDoc()];
  for (const orderType of ["takeaway", "delivery", "dinein"]) {
    const req = makeReq({ code: "TEST20", orderAmount: 500, orderType });
    const res = makeRes();
    await validateCoupon(req, res);
    assert.equal(res._status, 200, `orderType ${orderType} should validate`);
    assert.equal(res._body.coupon.discount, 100, `orderType ${orderType} discount`);
  }
});

test("an expired coupon is rejected", async () => {
  deps.store.coupons = [makeCouponDoc({ validUntil: new Date(NOW - DAY) })];
  const req = makeReq({ code: "TEST20", orderAmount: 500, orderType: "takeaway" });
  const res = makeRes();
  await validateCoupon(req, res);

  assert.equal(res._status, 404);
  assert.equal(res._body.message, "Invalid or expired coupon");
});

test("a not-yet-valid coupon is rejected", async () => {
  deps.store.coupons = [makeCouponDoc({ validFrom: new Date(NOW + DAY) })];
  const req = makeReq({ code: "TEST20", orderAmount: 500, orderType: "takeaway" });
  const res = makeRes();
  await validateCoupon(req, res);

  assert.equal(res._status, 404);
  assert.equal(res._body.message, "Invalid or expired coupon");
});

test("an inactive coupon is rejected", async () => {
  deps.store.coupons = [makeCouponDoc({ isActive: false })];
  const req = makeReq({ code: "TEST20", orderAmount: 500, orderType: "takeaway" });
  const res = makeRes();
  await validateCoupon(req, res);

  assert.equal(res._status, 404);
  assert.equal(res._body.message, "Invalid or expired coupon");
});

test("an unknown coupon code is rejected", async () => {
  deps.store.coupons = [makeCouponDoc()];
  const req = makeReq({ code: "NOPE", orderAmount: 500, orderType: "takeaway" });
  const res = makeRes();
  await validateCoupon(req, res);

  assert.equal(res._status, 404);
  assert.equal(res._body.message, "Invalid or expired coupon");
});

test("a corrupt code (the [object Object] regression) is rejected server-side", async () => {
  deps.store.coupons = [makeCouponDoc()];
  const req = makeReq({ code: "[object Object]", orderAmount: 200, orderType: "takeaway" });
  const res = makeRes();
  await validateCoupon(req, res);

  assert.equal(res._status, 404);
  assert.equal(res._body.message, "Invalid or expired coupon");
});

// ---------------------------------------------------------------------------
// Coupon model validation engine
// ---------------------------------------------------------------------------

test("isValid accepts an active in-window coupon and rejects the failure modes", () => {
  const ok = new CouponModel(makeCouponDoc());
  assert.deepEqual(ok.isValid(500, "takeaway"), { valid: true });

  assert.equal(new CouponModel(makeCouponDoc({ isActive: false })).isValid(500, "takeaway").valid, false);
  assert.equal(new CouponModel(makeCouponDoc({ validUntil: new Date(NOW - DAY) })).isValid(500, "takeaway").valid, false);
  assert.equal(new CouponModel(makeCouponDoc({ validFrom: new Date(NOW + DAY) })).isValid(500, "takeaway").valid, false);
  assert.equal(new CouponModel(makeCouponDoc({ usageLimit: 1, usageCount: 1 })).isValid(500, "takeaway").valid, false);
});

test("isValid enforces minimum order amount and order type restrictions", () => {
  const withMin = new CouponModel(makeCouponDoc({ minOrderAmount: 300 }));
  assert.equal(withMin.isValid(200, "takeaway").valid, false);
  assert.equal(withMin.isValid(500, "takeaway").valid, true);

  const dineinOnly = new CouponModel(makeCouponDoc({ applicableOrderTypes: ["dinein"] }));
  assert.equal(dineinOnly.isValid(500, "takeaway").valid, false);
  assert.equal(dineinOnly.isValid(500, "dinein").valid, true);
});

test("calculateDiscount returns the correct 20% percent discount", () => {
  const coupon = new CouponModel(makeCouponDoc());
  assert.equal(coupon.calculateDiscount(500), 100);
  assert.equal(coupon.calculateDiscount(650), 130);
  assert.equal(coupon.calculateDiscount(0), 0);
});

test("calculateDiscount caps percent discounts at maxDiscount", () => {
  const coupon = new CouponModel(makeCouponDoc({ maxDiscount: 50 }));
  assert.equal(coupon.calculateDiscount(500), 50);
  assert.equal(coupon.calculateDiscount(100), 20);
});

test("calculateDiscount applies flat coupons up to the order amount", () => {
  const coupon = new CouponModel(makeCouponDoc({ type: "flat", value: 100 }));
  assert.equal(coupon.calculateDiscount(500), 100);
  assert.equal(coupon.calculateDiscount(50), 50);
});

after(() => {
  delete require.cache[COUPON_MODEL];
  delete require.cache[PUBLIC_ROUTES];
});