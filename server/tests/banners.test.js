const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret";
process.env.RAZORPAY_KEY_ID = "rzp_test_test_key_id";
process.env.RAZORPAY_KEY_SECRET = "test_key_secret";

const BANNER_MODEL = require.resolve("../models/Banner");
const BANNER_CONTROLLER = require.resolve("../controllers/bannerController");
const BANNER_ROUTES = require.resolve("../routes/bannerRoutes");
const PUBLIC_ROUTES = require.resolve("../routes/publicRoutes");

// The real model (no DB connection needed for validateSync / isActiveAt).
const BannerModel = require("../models/Banner");
const { isActiveAt } = BannerModel;

const stubModule = (absPath, exports) => {
  require.cache[absPath] = {
    id: absPath,
    filename: absPath,
    loaded: true,
    exports,
  };
};

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

const makeBanner = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  title: "20% Off Today",
  description: "Sitewide discount",
  couponCode: "SAVE20",
  ctaText: "Order Now",
  ctaLink: "",
  startDate: new Date(NOW - DAY),
  endDate: new Date(NOW + DAY),
  isActive: true,
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  __v: 0,
  ...overrides,
});

const createStubs = () => {
  const store = { banners: [] };

  const Banner = {
    // Mirrors Banner.findActive: only live banners, ordered by sortOrder.
    findActive: async () =>
      store.banners
        .filter((b) => isActiveAt(b, new Date()))
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .map((b) => ({ ...b })),
    find: () => ({
      sort: () => ({
        lean: async () => store.banners.map((b) => ({ ...b })),
      }),
    }),
    create: async (data) => {
      const doc = {
        _id: new mongoose.Types.ObjectId(),
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.banners.push(doc);
      return doc;
    },
    findById: async (id) =>
      store.banners.find((b) => String(b._id) === String(id)) || null,
    findByIdAndUpdate: async (id, update, opts) => {
      const banner = store.banners.find((b) => String(b._id) === String(id));
      if (!banner) return null;
      Object.assign(banner, update);
      return banner;
    },
    findByIdAndDelete: async (id) => {
      const index = store.banners.findIndex((b) => String(b._id) === String(id));
      if (index === -1) return null;
      return store.banners.splice(index, 1)[0];
    },
  };

  stubModule(BANNER_MODEL, Banner);
  return { store, Banner };
};

const freshLoad = () => {
  const stubs = createStubs();

  for (const absPath of [BANNER_CONTROLLER, BANNER_ROUTES, PUBLIC_ROUTES]) {
    delete require.cache[absPath];
  }

  const bannerController = require(BANNER_CONTROLLER);
  const bannerRoutes = require(BANNER_ROUTES);
  const publicRoutes = require(PUBLIC_ROUTES);

  return { ...stubs, bannerController, bannerRoutes, publicRoutes };
};

const getRouteHandlers = (router, method, path) => {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack.map((l) => l.handle);
    }
  }
  throw new Error(`Route ${method} ${path} not found`);
};

const makeReq = (body = {}, params = {}, query = {}) => ({ body, params, query });

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
// Model validation
// ---------------------------------------------------------------------------

test("banner model accepts a valid document", () => {
  const doc = new BannerModel({
    title: "Weekend Special",
    startDate: new Date(NOW - DAY),
    endDate: new Date(NOW + DAY),
  });
  assert.equal(doc.validateSync(), undefined);
});

test("banner model rejects a missing title", () => {
  const doc = new BannerModel({
    startDate: new Date(NOW - DAY),
    endDate: new Date(NOW + DAY),
  });
  const err = doc.validateSync();
  assert.ok(err && err.errors && err.errors.title, "title must be required");
});

test("banner model rejects endDate on or before startDate", () => {
  const doc = new BannerModel({
    title: "Bad Range",
    startDate: new Date(NOW + DAY),
    endDate: new Date(NOW - DAY),
  });
  const err = doc.validateSync();
  assert.ok(err && err.errors && err.errors.endDate, "endDate must be after startDate");
});

test("banner model rejects an endDate equal to startDate", () => {
  const doc = new BannerModel({
    title: "Same Instant",
    startDate: new Date(NOW),
    endDate: new Date(NOW),
  });
  const err = doc.validateSync();
  assert.ok(err && err.errors && err.errors.endDate);
});

// ---------------------------------------------------------------------------
// isActiveAt: server-side date window decides what is live
// ---------------------------------------------------------------------------

test("isActiveAt excludes an expired banner", () => {
  const banner = makeBanner({ endDate: new Date(NOW - DAY) });
  assert.equal(isActiveAt(banner), false);
});

test("isActiveAt excludes an inactive banner", () => {
  const banner = makeBanner({ isActive: false });
  assert.equal(isActiveAt(banner), false);
});

test("isActiveAt excludes a future banner", () => {
  const banner = makeBanner({ startDate: new Date(NOW + DAY) });
  assert.equal(isActiveAt(banner), false);
});

test("isActiveAt includes an active in-window banner", () => {
  const banner = makeBanner();
  assert.equal(isActiveAt(banner), true);
});

// ---------------------------------------------------------------------------
// Controller: create / validation
// ---------------------------------------------------------------------------

test("create returns 201 and stores a valid banner", async () => {
  const d = freshLoad();
  const req = makeReq({
    title: "20% Off Today",
    description: "Sitewide discount",
    couponCode: "save20",
    ctaText: "Order Now",
    startDate: new Date(NOW - DAY),
    endDate: new Date(NOW + DAY),
    isActive: true,
    sortOrder: 2,
  });
  const res = makeRes();
  await d.bannerController.create(req, res);

  assert.equal(res._status, 201);
  assert.equal(res._body.success, true);
  assert.equal(d.store.banners.length, 1);
  assert.equal(d.store.banners[0].title, "20% Off Today");
  assert.equal(d.store.banners[0].couponCode, "SAVE20", "coupon codes are uppercased");
  assert.equal(d.store.banners[0].sortOrder, 2);
});

test("create rejects a missing title", async () => {
  const d = freshLoad();
  const req = makeReq({
    startDate: new Date(NOW - DAY),
    endDate: new Date(NOW + DAY),
  });
  const res = makeRes();
  await d.bannerController.create(req, res);

  assert.equal(res._status, 400);
  assert.match(res._body.message, /title/i);
  assert.equal(d.store.banners.length, 0);
});

test("create rejects an invalid date range", async () => {
  const d = freshLoad();
  const req = makeReq({
    title: "Bad Range",
    startDate: new Date(NOW + DAY),
    endDate: new Date(NOW - DAY),
  });
  const res = makeRes();
  await d.bannerController.create(req, res);

  assert.equal(res._status, 400);
  assert.match(res._body.message, /after start date/);
  assert.equal(d.store.banners.length, 0);
});

test("create rejects malformed dates", async () => {
  const d = freshLoad();
  const req = makeReq({ title: "Broken", startDate: "nope", endDate: "also-nope" });
  const res = makeRes();
  await d.bannerController.create(req, res);

  assert.equal(res._status, 400);
  assert.match(res._body.message, /valid start and end dates/i);
});

// ---------------------------------------------------------------------------
// Public active endpoint: exclusions, ordering, safe fields
// ---------------------------------------------------------------------------

test("getPublicActive returns only live banners", async () => {
  const d = freshLoad();
  d.store.banners = [
    makeBanner({ title: "Expired", endDate: new Date(NOW - DAY), sortOrder: 0 }),
    makeBanner({ title: "Inactive", isActive: false, sortOrder: 1 }),
    makeBanner({ title: "Future", startDate: new Date(NOW + DAY), sortOrder: 2 }),
    makeBanner({ title: "Live", sortOrder: 3 }),
  ];

  const req = makeReq();
  const res = makeRes();
  await d.bannerController.getPublicActive(req, res);

  assert.equal(res._status, 200);
  assert.equal(res._body.success, true);
  assert.equal(res._body.banners.length, 1);
  assert.equal(res._body.banners[0].title, "Live");
});

test("getPublicActive orders live banners by sortOrder", async () => {
  const d = freshLoad();
  d.store.banners = [
    makeBanner({ title: "B", sortOrder: 2 }),
    makeBanner({ title: "A", sortOrder: 0 }),
    makeBanner({ title: "C", sortOrder: 1 }),
  ];

  const req = makeReq();
  const res = makeRes();
  await d.bannerController.getPublicActive(req, res);

  assert.deepEqual(
    res._body.banners.map((b) => b.title),
    ["A", "C", "B"]
  );
});

test("public response exposes only display-safe fields", async () => {
  const d = freshLoad();
  const req = makeReq();
  const res = makeRes();
  d.store.banners = [makeBanner({ couponCode: "SAVE20", ctaLink: "/menu" })];

  await d.bannerController.getPublicActive(req, res);

  const banner = res._body.banners[0];
  assert.deepEqual(
    Object.keys(banner).sort(),
    ["_id", "couponCode", "ctaText", "ctaLink", "description", "sortOrder", "title"].sort()
  );
  assert.equal(banner.isActive, undefined, "isActive must not leak");
  assert.equal(banner.startDate, undefined, "startDate must not leak");
  assert.equal(banner.endDate, undefined, "endDate must not leak");
  assert.equal(banner.createdAt, undefined, "createdAt must not leak");
  assert.equal(banner.__v, undefined, "__v must not leak");
});

test("toPublicBanner strips internal fields", () => {
  const d = freshLoad();
  const banner = makeBanner({
    couponCode: "SAVE20",
    ctaLink: "/menu",
    sortOrder: 5,
  });
  const pub = d.bannerController.toPublicBanner(banner);
  assert.equal(pub.title, "20% Off Today");
  assert.equal(pub.couponCode, "SAVE20");
  assert.equal(pub.ctaLink, "/menu");
  assert.equal(pub.sortOrder, 5);
  assert.equal(pub.isActive, undefined);
  assert.equal(pub.endDate, undefined);
});

// ---------------------------------------------------------------------------
// Admin-only mutation routes
// ---------------------------------------------------------------------------

const ADMIN_MUTATION_ROUTES = [
  ["get", "/"],
  ["post", "/"],
  ["put", "/:id"],
  ["patch", "/:id/toggle"],
  ["delete", "/:id"],
];

test("admin mutation routes require authentication and admin role", async () => {
  const d = freshLoad();

  for (const [method, path] of ADMIN_MUTATION_ROUTES) {
    const handlers = getRouteHandlers(d.bannerRoutes, method, path);
    assert.ok(handlers.length >= 3, `${method.toUpperCase()} ${path} must have protect + authorizeRoles + handler`);

    const noTokenRes = makeRes();
    await handlers[0](makeReq(), noTokenRes);
    assert.equal(noTokenRes._status, 401, `${method.toUpperCase()} ${path} must reject anonymous requests`);

    const nonAdminRes = makeRes();
    handlers[1]({ user: { role: "cashier" } }, nonAdminRes, () => {});
    assert.equal(nonAdminRes._status, 403, `${method.toUpperCase()} ${path} must reject non-admin roles`);

    let nexted = false;
    handlers[1]({ user: { role: "admin" } }, makeRes(), () => { nexted = true; });
    assert.equal(nexted, true, `${method.toUpperCase()} ${path} must allow admins`);
  }
});

test("public banners route has no auth middleware", async () => {
  const d = freshLoad();
  const handlers = getRouteHandlers(d.publicRoutes, "get", "/banners");
  assert.equal(handlers.length, 1, "public /banners must be a single unprotected handler");
  assert.equal(handlers[0].name, "getPublicActive");
});

after(() => {
  for (const absPath of [BANNER_MODEL, BANNER_CONTROLLER, BANNER_ROUTES, PUBLIC_ROUTES]) {
    delete require.cache[absPath];
  }
});