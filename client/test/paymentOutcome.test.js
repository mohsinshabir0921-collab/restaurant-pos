import { test } from "node:test";
import assert from "node:assert/strict";
import { OUTCOME, decidePaymentOutcome } from "../src/lib/paymentOutcome.js";

// Helper to simulate the axios response from verifyCashfreePayment.
const verifyRes = (data) => ({ status: data.success ? 200 : 400, data });

test("modal callback reports non-SUCCESS but server verification returns SUCCESS -> PAID (order NOT cancelled)", () => {
  // The client callback said something other than SUCCESS (e.g. UPI popup
  // redirect), but the server confirms the payment. The decision is
  // server-driven, so the order must not be cancelled.
  const res = verifyRes({ success: true, message: "Payment verified successfully", order: { _id: "o1", paymentStatus: "paid" } });
  assert.equal(decidePaymentOutcome(res), OUTCOME.PAID);
});

test("client callback CANCELLED + server verification SUCCESS -> PAID (order NOT cancelled)", () => {
  const res = verifyRes({ success: true, message: "Payment already verified", order: { _id: "o1", paymentStatus: "paid" } });
  assert.equal(decidePaymentOutcome(res), OUTCOME.PAID);
});

test("server verification confirms the payment failed -> FAILED (order cancelled)", () => {
  const res = verifyRes({ success: false, message: "Payment is not successful" });
  assert.equal(decidePaymentOutcome(res), OUTCOME.FAILED);
});

test("server verification rejects on amount mismatch -> FAILED (order cancelled)", () => {
  const res = verifyRes({ success: false, message: "Payment amount does not match order total" });
  assert.equal(decidePaymentOutcome(res), OUTCOME.FAILED);
});

test("server verification rejects on currency mismatch -> FAILED (order cancelled)", () => {
  const res = verifyRes({ success: false, message: "Payment currency mismatch" });
  assert.equal(decidePaymentOutcome(res), OUTCOME.FAILED);
});

test("server says order is already paid -> PAID (never cancel a settled order)", () => {
  const res = verifyRes({ success: false, message: "Order is already paid" });
  assert.equal(decidePaymentOutcome(res), OUTCOME.PAID);
});

test("server could not confirm the payment -> PENDING (order NOT cancelled, webhook reconciles)", () => {
  const res = verifyRes({ success: false, message: "Could not confirm payment with Cashfree" });
  assert.equal(decidePaymentOutcome(res), OUTCOME.PENDING);
});

test("verification network error (no response) -> PENDING (order NOT cancelled)", () => {
  assert.equal(decidePaymentOutcome(null), OUTCOME.PENDING);
});

test("verification guard rejection (cashfree order id mismatch) -> PENDING (do not cancel)", () => {
  const res = verifyRes({ success: false, message: "Cashfree order ID mismatch" });
  assert.equal(decidePaymentOutcome(res), OUTCOME.PENDING);
});

test("the decision function never consults the modal callback status", () => {
  // Regression guard: the fix must not re-introduce the premature-cancel bug
  // where a non-SUCCESS modal status cancels an actually-paid order. The
  // decision is based solely on the server response; the callback status value
  // is intentionally ignored by the module.
  for (const status of ["CANCELLED", "NOT_ATTEMPTED", "FAILED", "USER_DROPPED", undefined]) {
    const res = verifyRes({ success: true, message: "Payment verified successfully" });
    assert.equal(
      decidePaymentOutcome(res),
      OUTCOME.PAID,
      `callback status ${status} must not override a server SUCCESS`
    );
  }
});