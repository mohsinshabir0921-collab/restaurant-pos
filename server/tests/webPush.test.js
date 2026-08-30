const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.VAPID_PUBLIC_KEY = "test_public_key";
process.env.VAPID_PRIVATE_KEY = "test_private_key";

const WEB_PUSH_LIB = require.resolve("web-push");
const PUSH_MODEL = require.resolve("../models/PushSubscription");
const WEB_PUSH = require.resolve("../services/webPush");

// Stub the node module cache so the webPush service uses our fakes instead of
// the real web-push library and the real (DB-backed) Mongoose model.
const stubModule = (absPath, exports) => {
  require.cache[absPath] = {
    id: absPath,
    filename: absPath,
    loaded: true,
    exports,
  };
};

// Fake web-push library.
const makeWebPushStub = () => {
  const calls = [];
  return {
    setVapidDetails: () => {},
    async sendNotification(sub, payload) {
      const call = {
        endpoint: sub.endpoint,
        keys: sub.keys,
        payload,
        rejectWith: null,
        resolve: null,
      };
      calls.push(call);
      if (call.rejectWith) {
        const err = new Error("push failed");
        err.statusCode = call.rejectWith;
        throw err;
      }
      return {};
    },
    calls,
    // Configure how the NEXT send should behave.
    __next: (overrides = {}) => {
      Object.assign(calls[calls.length - 1], overrides);
    },
  };
};

// Fake PushSubscription model. find() returns a thenable query that resolves to
// the current active list; populate() returns the same thenable. findOneAndUpdate
// records deactivation calls.
const makeModelStub = () => {
  const state = {
    active: [],
    deactivated: [],
    updated: [],
  };
  // Mimic a Mongoose Query: thenable AND has .populate() that returns itself.
  const queryThenable = (list) => {
    const q = Promise.resolve(list);
    q.populate = () => q;
    return q;
  };
  return {
    state,
    find(cond) {
      const list = cond && cond.isActive === true ? state.active : [];
      return queryThenable(list);
    },
    async findOneAndUpdate(cond, update) {
      state.updated.push({ cond, update });
      if (update && update.isActive === false) {
        state.deactivated.push(cond && cond.endpoint);
        return Promise.resolve({ ...cond, ...update });
      }
      return Promise.resolve({ ...cond, ...update });
    },
  };
};

const freshWebPush = () => {
  delete require.cache[WEB_PUSH];
  const webpush = makeWebPushStub();
  const model = makeModelStub();
  stubModule(WEB_PUSH_LIB, webpush);
  stubModule(PUSH_MODEL, model);
  const WebPushService = require(WEB_PUSH);
  return { WebPushService, webpush, model };
};

const sub = (seed) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${seed}`,
  keys: { p256dh: "p256dh-key", auth: "auth-key" },
});

test("sendNewOrderNotification targets every active subscription", async () => {
  const { WebPushService, model } = freshWebPush();
  const a = sub("seedA");
  const b = sub("seedB");
  model.state.active = [{ endpoint: a.endpoint, keys: a.keys }, { endpoint: b.endpoint, keys: b.keys }];

  // VAPID keys are required; force them to be "present" so the send proceeds.
  // (The service captured them at load time in process.env above.)
  const webpush = require(WEB_PUSH_LIB);
  await WebPushService.sendNewOrderNotification({ orderNumber: "ORD-1", total: 100, _id: "x" });

  assert.equal(webpush.calls.length, 2, "one send per active subscription");
  const payloadA = JSON.parse(webpush.calls[0].payload);
  assert.equal(payloadA.title, "New Order");
  assert.equal(payloadA.body, "ORD-1 · ₹100");
  assert.equal(model.state.deactivated.length, 0, "no permanent failures -> nothing deactivated");
});

test("permanent FCM error (410) deactivates only that subscription and others stay active", async () => {
  const { WebPushService, webpush, model } = freshWebPush();
  const good = sub("seedGood");
  const bad = sub("seedBad");
  model.state.active = [
    { endpoint: good.endpoint, keys: good.keys },
    { endpoint: bad.endpoint, keys: bad.keys },
  ];

  // Populate active list again for the second read-through: use a fresh call
  // list from the test by capturing before.
  const before = webpush.calls.length;
  // First two sends occur in Promise.all; we want the SECOND (bad) to fail with 410.
  // Configure: patch sendNotification to reject for the 'bad' endpoint on the fly.
  const originalSend = webpush.sendNotification.bind(webpush);
  let badCount = 0;
  webpush.sendNotification = async (sub, payload) => {
    if (sub.endpoint === bad.endpoint) {
      badCount++;
      const err = new Error("gone");
      err.statusCode = 410;
      throw err;
    }
    return originalSend(sub, payload);
  };

  await WebPushService.sendNewOrderNotification({ orderNumber: "ORD-2", total: 200, _id: "y" });

  assert.ok(badCount >= 1, "bad endpoint attempted");
  assert.equal(model.state.deactivated.length, 1, "exactly one subscription deactivated");
  assert.equal(model.state.deactivated[0], bad.endpoint, "the bad subscription was deactivated");
  void before;
});

test("transient FCM error (500) does NOT deactivate the subscription", async () => {
  const { WebPushService, model } = freshWebPush();
  const s = sub("seedTransient");
  model.state.active = [{ endpoint: s.endpoint, keys: s.keys }];

  const webpush = require(WEB_PUSH_LIB);
  webpush.sendNotification = async () => {
    const err = new Error("upstream unavailable");
    err.statusCode = 500;
    throw err;
  };

  await WebPushService.sendNewOrderNotification({ orderNumber: "ORD-3", total: 300, _id: "z" });

  assert.equal(model.state.deactivated.length, 0, "transient failures must not deactivate");
});

test("masked per-delivery log does not expose full endpoint or keys", async () => {
  const { WebPushService, webpush, model } = freshWebPush();

  const lines = [];
  const origLog = console.log;
  console.log = (...args) => lines.push(args.join(" "));

  let endpoint = "";
  let p256dh = "";
  let auth = "";
  try {
    const ok = sub("abcDEF123456");
    endpoint = ok.endpoint;
    p256dh = ok.keys.p256dh;
    auth = ok.keys.auth;
    model.state.active = [{ endpoint, keys: ok.keys }];
    // Force a permanent failure so the error path also logs.
    webpush.sendNotification = async () => {
      const err = new Error("gone");
      err.statusCode = 410;
      throw err;
    };
    await WebPushService.sendNewOrderNotification({ orderNumber: "ORD-4", total: 400, _id: "w" });
  } finally {
    console.log = origLog;
  }

  const all = lines.join(" ");
  assert.ok(all.includes("[push]"), "push logging present");
  assert.ok(!all.includes(endpoint), "full endpoint must never be logged");
  assert.ok(!all.includes(p256dh), "p256dh key must never be logged");
  assert.ok(!all.includes(auth), "auth key must never be logged");
});

// Keep node --test from treating this file weirdly under Windows by ensuring
// an explicit success marker.
test("webPush tests complete", () => {
  assert.ok(true);
});
