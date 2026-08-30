const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.VAPID_PUBLIC_KEY = "test_public_key";
process.env.VAPID_PRIVATE_KEY = "test_private_key";

const PUSH_MODEL = require.resolve("../models/PushSubscription");
const WEB_PUSH = require.resolve("../services/webPush");
const PUSH_CONTROLLER = require.resolve("../controllers/pushController");

const stubModule = (absPath, exports) => {
  require.cache[absPath] = {
    id: absPath,
    filename: absPath,
    loaded: true,
    exports,
  };
};

// Fake PushSubscription model: records every findOneAndUpdate call and returns
// the "upserted" doc with the values the controller wrote.
const makeModelStub = () => {
  const upserts = [];
  return {
    upserts,
    async findOneAndUpdate(filter, update, opts) {
      upserts.push({ filter, update, opts });
      return {
        ...filter,
        ...(update.user ? { user: update.user } : {}),
        endpoint: update.endpoint,
        keys: update.keys,
        isActive: update.isActive,
        userAgent: update.userAgent,
        lastUsedAt: update.lastUsedAt,
      };
    },
  };
};

const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    res.body = obj;
    return res;
  };
  return res;
};

test("subscribePush persists a new subscription as active for the authenticated user", async () => {
  delete require.cache[PUSH_CONTROLLER];
  const model = makeModelStub();
  stubModule(PUSH_MODEL, model);
  stubModule(WEB_PUSH, { getPublicKey: () => "test_public_key" });
  const controller = require(PUSH_CONTROLLER);

  const req = {
    user: { _id: "6a78f6c497beefb294d7c200" },
    body: {
      endpoint: "https://fcm.googleapis.com/fcm/send/android-token-123",
      keys: { p256dh: "p256dh", auth: "auth" },
    },
    get: () => "Mozilla/5.0 (Linux; Android) Chrome Mobile",
  };
  const res = mockRes();

  await controller.subscribePush(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(model.upserts.length, 1);

  const { filter, update } = model.upserts[0];
  // New subscription is associated with the authenticated POS user...
  assert.equal(String(filter.user), "6a78f6c497beefb294d7c200");
  // ...and is upserted as ACTIVE so it is immediately targeted for pushes.
  assert.equal(update.isActive, true, "newly created subscription must be active");
  assert.equal(update.endpoint, req.body.endpoint);
  assert.ok(update.lastUsedAt, "lastUsedAt set on subscribe");
  // Device metadata captured (used to identify Android vs laptop in logs/DB).
  assert.match(update.userAgent, /Android/);
});

test("subscribePush rejects an invalid subscription payload", async () => {
  delete require.cache[PUSH_CONTROLLER];
  const model = makeModelStub();
  stubModule(PUSH_MODEL, model);
  stubModule(WEB_PUSH, { getPublicKey: () => "test_public_key" });
  const controller = require(PUSH_CONTROLLER);

  const req = {
    user: { _id: "6a78f6c497beefb294d7c200" },
    body: { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: {} },
    get: () => "ua",
  };
  const res = mockRes();

  await controller.subscribePush(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(model.upserts.length, 0, "invalid payload must not be persisted");
});
