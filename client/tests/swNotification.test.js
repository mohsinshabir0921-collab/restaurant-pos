import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SW_PATH = fileURLToPath(new URL("../public/pos/sw.js", import.meta.url));
const swSource = readFileSync(SW_PATH, "utf8");

// Execute the real sw.js source in the HOST realm (via new Function) with a
// mocked `self`, so promise microtasks resolve normally with `await`. Captures
// the installed listeners so we can dispatch push events and assert on the
// notification behavior.
function loadSw({ clientList }) {
  const listeners = {};
  const shown = [];
  const posted = [];

  const self = {
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    skipWaiting() {},
    claimIfAny() {},
    registration: {
      showNotification(title, options) {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
    clients: {
      matchAll: () => Promise.resolve(clientList()),
      claim() {},
    },
  };

  // self.addEventListener is invoked at the top of sw.js.
  new Function("self", swSource)(self);
  Object.defineProperty(self, "claimIfAny", { value: self.clients.claim, enumerable: false });

  return {
    dispatchPush: async (payload) => {
      const event = {
        data: payload ? { json: () => payload } : null,
        waitUntil(p) {
          event._promise = p;
        },
      };
      listeners.push(event);
      if (event._promise) await event._promise;
      return shown;
    },
    shown,
    posted,
    get installedListeners() {
      return Object.keys(listeners);
    },
  };
}

const posClient = (pathname, { focused, visibilityState } = {}, onMessage) => ({
  url: `https://khyennchyenn.co.in${pathname}`,
  focused,
  visibilityState,
  postMessage: (m) => onMessage && onMessage(m),
});

const basePayload = {
  title: "New Order",
  body: "ORD-1 · ₹500",
  data: { url: "/pos/orders", orderId: "111", orderNumber: "ORD-1", orderType: "delivery", amount: 500 },
};

test("push shows an OS notification when POS is backgrounded/minimized (not focused, not visible)", async () => {
  const { dispatchPush } = loadSw({
    clientList: () => [
      posClient("/pos/orders", { focused: false, visibilityState: "hidden" }),
    ],
  });

  const notifications = await dispatchPush(basePayload);

  assert.equal(notifications.length, 1, "OS notification must be shown even when POS is minimized");
  assert.equal(notifications[0].title, "New Order");
  // Not focused -> not silent -> browser/custom sound plays.
  assert.equal(notifications[0].options.silent, false, "background notification should not be silent");
  assert.equal(notifications[0].options.sound, "/new-order-alert.mp3", "custom sound preserved");
});

test("push shows an OS notification when no POS window is open", async () => {
  const { dispatchPush } = loadSw({ clientList: () => [] });

  const notifications = await dispatchPush(basePayload);
  assert.equal(notifications.length, 1, "must show OS notification when no POS window is open");
  assert.equal(notifications[0].options.silent, false);
});

test("push shows the OS notification in foreground too (never suppressed) and notifies the focused page for sound", async () => {
  const posted = [];
  const { dispatchPush } = loadSw({
    clientList: () => [
      posClient("/pos/orders", { focused: true, visibilityState: "visible" }, (m) => posted.push(m)),
    ],
  });

  const notifications = await dispatchPush(basePayload);

  // The OS notification must still appear even when a focused POS window exists.
  assert.equal(notifications.length, 1, "OS notification must always be shown (not suppressed in foreground)");
  // Focused page will play the custom mp3 -> keep the OS notification silent to avoid double sound.
  assert.equal(notifications[0].options.silent, true, "foreground notification should be silent (page plays sound)");
  assert.deepEqual(posted, [{ type: "POS_NEW_ORDER" }], "focused POS window told to play custom sound");
});

test("malformed push payload falls back to a sensible notification", async () => {
  const { dispatchPush } = loadSw({ clientList: () => [] });

  const notifications = await dispatchPush(null);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].title, "New Order");
});

test("service worker registers install/activate/push/notification handlers", async () => {
  const { installedListeners } = loadSw({ clientList: () => [] });
  for (const evt of ["install", "activate", "push", "notificationclick", "notificationclose"]) {
    assert.ok(installedListeners.includes(evt), `expected ${evt} listener installed`);
  }
});
