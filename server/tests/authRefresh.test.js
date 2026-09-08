const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

process.env.JWT_SECRET = "test_jwt_secret_for_refresh_audit";
process.env.CASHFREE_WEBHOOK_SECRET = "test";
process.env.CASHFREE_CLIENT_ID = "test";
process.env.CASHFREE_CLIENT_SECRET = "test";

const USER_MODEL = require.resolve("../models/User");
const AUTH_CONTROLLER = require.resolve("../controllers/authController");
const AUTH_MIDDLEWARE = require.resolve("../middleware/authMiddleware");

const stubModule = (absPath, exports) => {
  require.cache[absPath] = { id: absPath, filename: absPath, loaded: true, exports };
};

// Helper to create a mock user with bcrypt-hashed refresh tokens
const bcrypt = require("bcryptjs");

test("valid session + browser refresh does not require refresh", async () => {
  const userId = new mongoose.Types.ObjectId();
  const payload = { id: userId, name: "Test", email: "test@test.com", role: "admin" };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });
  const fakeUser = { _id: userId, name: "Test", email: "test@test.com", role: "admin", isActive: true };
  stubModule(USER_MODEL, {
    findById: (id) => ({
      select: () => Promise.resolve(String(id) === String(userId) ? fakeUser : null),
    }),
  });
  delete require.cache[AUTH_MIDDLEWARE];
  const { protect } = require(AUTH_MIDDLEWARE);
  const req = { headers: { authorization: `Bearer ${token}` } };
  let nextCalled = false;
  const res = {
    status: (code) => { throw new Error(`Should not be 401, got ${code}`); },
    json: () => { throw new Error("Should not json"); }
  };
  await protect(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true, "valid token should pass protect without refresh");
  assert.equal(String(req.user._id), String(userId));
  delete require.cache[USER_MODEL];
  delete require.cache[AUTH_MIDDLEWARE];
});

test("expired access token + successful refresh rotates token", async () => {
  const userId = new mongoose.Types.ObjectId();
  const expiredToken = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "-10s" });
  const freshRefreshToken = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "30d" });
  const hashed = await bcrypt.hash(freshRefreshToken, 10);
  const fakeUser = {
    _id: userId,
    name: "Test",
    email: "test@test.com",
    role: "admin",
    isActive: true,
    refreshTokens: [hashed],
    isValidRefreshToken: async function (t) { return bcrypt.compare(t, this.refreshTokens[0]); },
    removeRefreshToken: async function (t) { this.refreshTokens = []; },
    addRefreshToken: async function (t) { this.refreshTokens.push(await bcrypt.hash(t, 10)); },
    save: async function () {}
  };
  stubModule(USER_MODEL, {
    findById: async (id) => String(id) === String(userId) ? fakeUser : null,
  });
  delete require.cache[AUTH_CONTROLLER];
  const { refreshToken } = require(AUTH_CONTROLLER);
  const req = { body: { refreshToken: freshRefreshToken } };
  let statusCode = null;
  let body = null;
  const res = {
    status: (c) => { statusCode = c; return res; },
    json: (d) => { body = d; return res; }
  };
  await refreshToken(req, res);
  assert.equal(statusCode, 200, "refresh should succeed");
  assert.ok(body.accessToken, "new accessToken returned");
  assert.ok(body.refreshToken, "new refreshToken returned");
  assert.notEqual(body.refreshToken, freshRefreshToken, "refresh token rotated");
  // Verify new access token is valid
  const decoded = jwt.verify(body.accessToken, process.env.JWT_SECRET);
  assert.equal(String(decoded.id), String(userId));
  delete require.cache[USER_MODEL];
  delete require.cache[AUTH_CONTROLLER];
});

test("failed/expired refresh token returns 401 and does not rotate", async () => {
  const userId = new mongoose.Types.ObjectId();
  const expiredRefresh = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "-10s" });
  stubModule(USER_MODEL, {
    findById: async () => ({ _id: userId, isActive: true, refreshTokens: [] }),
  });
  delete require.cache[AUTH_CONTROLLER];
  const { refreshToken } = require(AUTH_CONTROLLER);
  const req = { body: { refreshToken: expiredRefresh } };
  let statusCode = null;
  let body = null;
  const res = {
    status: (c) => { statusCode = c; return res; },
    json: (d) => { body = d; return res; }
  };
  await refreshToken(req, res);
  assert.equal(statusCode, 401);
  assert.match(body.message, /Invalid or expired/i);
  delete require.cache[USER_MODEL];
  delete require.cache[AUTH_CONTROLLER];
});

test("concurrent refresh handling - only one refresh should be attempted", async () => {
  const userId = new mongoose.Types.ObjectId();
  const refreshToken1 = jwt.sign({ id: userId, jti: "test-jti-1" }, process.env.JWT_SECRET, { expiresIn: "30d" });
  // Use plain storage for deterministic test (avoid bcrypt timing issues)
  const fakeUser = {
    _id: userId,
    isActive: true,
    refreshTokens: [refreshToken1],
    isValidRefreshToken: async function (t) { return this.refreshTokens.includes(t); },
    removeRefreshToken: async function (t) { this.refreshTokens = this.refreshTokens.filter((x) => x !== t); },
    addRefreshToken: async function (t) { this.refreshTokens.push(t); },
  };
  stubModule(USER_MODEL, {
    findById: async () => fakeUser,
  });
  delete require.cache[AUTH_CONTROLLER];
  const { refreshToken } = require(AUTH_CONTROLLER);
  let res1 = { status: (c) => { res1._s = c; return res1; }, json: (d) => { res1._b = d; return res1; } };
  await refreshToken({ body: { refreshToken: refreshToken1 } }, res1);
  assert.equal(res1._s, 200);
  const newToken = res1._b.refreshToken;
  assert.notEqual(newToken, refreshToken1, "rotated token must be different (jti)");
  let res2 = { status: (c) => { res2._s = c; return res2; }, json: (d) => { res2._b = d; return res2; } };
  await refreshToken({ body: { refreshToken: refreshToken1 } }, res2);
  assert.equal(res2._s, 401, "reused refresh token should be rejected");
  let res3 = { status: (c) => { res3._s = c; return res3; }, json: (d) => { res3._b = d; return res3; } };
  await refreshToken({ body: { refreshToken: newToken } }, res3);
  assert.equal(res3._s, 200);
  delete require.cache[USER_MODEL];
  delete require.cache[AUTH_CONTROLLER];
});

test("direct /pos/* refresh preserves session when token valid", async () => {
  const userId = new mongoose.Types.ObjectId();
  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
  const fakeUser = { _id: userId, isActive: true, name: "Test", email: "test@test.com", role: "admin" };
  stubModule(USER_MODEL, {
    findById: (id) => ({
      select: () => Promise.resolve(String(id) === String(userId) ? fakeUser : null),
    }),
  });
  delete require.cache[AUTH_MIDDLEWARE];
  const { protect } = require(AUTH_MIDDLEWARE);
  const req = { headers: { authorization: `Bearer ${token}` } };
  let next = false;
  const res = { status: () => { throw new Error("should not 401"); }, json: () => {} };
  await protect(req, res, () => { next = true; });
  assert.equal(next, true);
  delete require.cache[USER_MODEL];
  delete require.cache[AUTH_MIDDLEWARE];
});

after(() => {
  [USER_MODEL, AUTH_CONTROLLER, AUTH_MIDDLEWARE].forEach(p => { try { delete require.cache[p]; } catch {} });
});
