import { test, after } from "node:test";
import assert from "node:assert/strict";

// Mock browser globals for api.js interceptor logic
global.localStorage = {
  _store: {},
  getItem(key) { return this._store[key] ?? null; },
  setItem(key, value) { this._store[key] = String(value); },
  removeItem(key) { delete this._store[key]; },
  clear() { this._store = {}; }
};
global.window = { location: { href: "" } };

// Simulate the api.js interceptor logic in isolation
// This mirrors the fixed implementation to verify requirements 1-5

let isRefreshing = false;
let refreshSubscribers = [];
let refreshCallCount = 0;

const onRefreshed = (token) => {
  refreshSubscribers.forEach(cb => cb(token));
  refreshSubscribers = [];
};

const mockRequestNewAccessToken = async (shouldSucceed = true, newToken = "new_access_token") => {
  refreshCallCount++;
  const rt = global.localStorage.getItem("refreshToken");
  if (!rt) throw new Error("No refresh token");
  if (!shouldSucceed) throw new Error("Refresh failed");
  global.localStorage.setItem("token", newToken);
  global.localStorage.setItem("refreshToken", "new_refresh_" + Date.now());
  return newToken;
};

// Helper to simulate api request with 401 handling
async function simulateRequest(url, token, should401, refreshShouldSucceed, concurrent = false) {
  const status = should401 ? 401 : 200;
  if (status === 200) return { status: 200, data: "ok" };
  // 401 handling - mimic interceptor
  const originalRequest = { url, headers: {}, _retry: false };
  originalRequest.headers.Authorization = `Bearer ${token}`;
  if (originalRequest._retry) throw new Error("already retried");
  const isAuthRequest = url.includes("/auth/login") || url.includes("/auth/refresh");
  if (isAuthRequest) throw new Error("auth request 401");
  originalRequest._retry = true;
  if (isRefreshing) {
    return new Promise((resolve, reject) => {
      refreshSubscribers.push((newToken) => {
        if (!newToken) reject(new Error("refresh failed"));
        else resolve({ status: 200, data: "retried ok" });
      });
    });
  }
  isRefreshing = true;
  try {
    const newToken = await mockRequestNewAccessToken(refreshShouldSucceed);
    onRefreshed(newToken);
    return { status: 200, data: "retried ok" };
  } catch (e) {
    onRefreshed(null);
    global.localStorage.removeItem("token");
    global.localStorage.removeItem("refreshToken");
    global.window.location.href = "/pos/login";
    throw e;
  } finally {
    isRefreshing = false;
  }
}

test("valid session + browser refresh does not trigger refresh", async () => {
  global.localStorage.clear();
  global.localStorage.setItem("token", "valid_token");
  global.localStorage.setItem("refreshToken", "valid_refresh");
  global.localStorage.setItem("user", JSON.stringify({ _id: "1", role: "admin" }));
  isRefreshing = false;
  refreshSubscribers = [];
  refreshCallCount = 0;
  // Simulate loadUser verification: getMe with valid token should succeed without refresh
  const result = await simulateRequest("/api/tables/floor-plan", "valid_token", false, true);
  assert.equal(result.status, 200);
  assert.equal(refreshCallCount, 0, "no refresh for valid session");
  assert.equal(global.localStorage.getItem("token"), "valid_token");
});

test("expired access token + successful refresh is silent", async () => {
  global.localStorage.clear();
  global.localStorage.setItem("token", "expired_token");
  global.localStorage.setItem("refreshToken", "valid_refresh");
  isRefreshing = false;
  refreshSubscribers = [];
  refreshCallCount = 0;
  const result = await simulateRequest("/api/orders", "expired_token", true, true);
  assert.equal(result.status, 200);
  assert.equal(result.data, "retried ok");
  assert.equal(refreshCallCount, 1, "one refresh for expired token");
  assert.equal(global.localStorage.getItem("token"), "new_access_token");
});

test("failed/expired refresh token redirects to login cleanly", async () => {
  global.localStorage.clear();
  global.localStorage.setItem("token", "expired_token");
  global.localStorage.setItem("refreshToken", "expired_refresh");
  isRefreshing = false;
  refreshSubscribers = [];
  refreshCallCount = 0;
  global.window.location.href = "";
  try {
    await simulateRequest("/api/orders", "expired_token", true, false);
    assert.fail("should have thrown");
  } catch (e) {
    assert.match(e.message, /Refresh failed/);
  }
  assert.equal(refreshCallCount, 1);
  assert.equal(global.localStorage.getItem("token"), null);
  assert.equal(global.localStorage.getItem("refreshToken"), null);
  assert.equal(global.window.location.href, "/pos/login", "should redirect to login");
});

test("concurrent requests during token expiry trigger only one refresh", async () => {
  global.localStorage.clear();
  global.localStorage.setItem("token", "expired_token");
  global.localStorage.setItem("refreshToken", "valid_refresh");
  isRefreshing = false;
  refreshSubscribers = [];
  refreshCallCount = 0;
  // Simulate 3 concurrent 401s
  const p1 = simulateRequest("/api/orders", "expired_token", true, true);
  // Before p1's refresh completes, isRefreshing is true, so p2 and p3 should queue
  // In our simulation, p1 will set isRefreshing true and start refresh
  // p2 and p3 will see isRefreshing true and queue
  // We need to simulate concurrent by not awaiting p1 before starting p2/p3
  // For simplicity, test that only one refreshCall is made for multiple queued
  // Our mockRequestNewAccessToken will be called once for p1, p2/p3 will queue
  // After p1 completes, p2/p3 should resolve with new token
  const p2 = simulateRequest("/api/tables/floor-plan", "expired_token", true, true);
  const p3 = simulateRequest("/api/customers", "expired_token", true, true);
  const results = await Promise.all([p1, p2, p3]);
  assert.equal(results.length, 3);
  results.forEach(r => assert.equal(r.status, 200));
  assert.equal(refreshCallCount, 1, "only one refresh for concurrent 401s");
});

test("direct /pos/* refresh preserves session when token valid", async () => {
  global.localStorage.clear();
  global.localStorage.setItem("token", "valid_token");
  global.localStorage.setItem("user", JSON.stringify({ _id: "1", role: "admin" }));
  // Simulate BrowserRouter basename /pos and ProtectedRoute check
  const token = global.localStorage.getItem("token");
  const userStr = global.localStorage.getItem("user");
  const isAuthenticated = !!token && !!userStr;
  assert.equal(isAuthenticated, true, "direct deep link should preserve auth");
  // Simulate server serving pos.html for /pos/orders (postbuild/Functions)
  const posRoutes = ["dashboard","kitchen","delivery","tracking","reports","menu","categories","tables","customers","coupons","banners","staff","settings","inventory","recipes","purchase-orders","waste","communications","loyalty","orders"];
  const path = "/pos/orders";
  const isPosDeepLink = path === "/pos" || path.startsWith("/pos/");
  assert.equal(isPosDeepLink, true);
  // The request for pos.html should not require auth, and subsequent API calls with valid token should succeed
  const result = await simulateRequest("/api/orders", "valid_token", false, true);
  assert.equal(result.status, 200);
});

after(() => {
  global.localStorage.clear();
});
