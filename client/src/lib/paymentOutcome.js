// Decides how the checkout UI should treat the outcome of a Cashfree payment
// attempt.
//
// The Cashfree modal callback status is NOT authoritative: for UPI payments the
// popup often reports CANCELLED / NOT_ATTEMPTED even when the money was
// captured, because the payment redirects to a UPI app and the popup loses the
// return context. The server's verifyCashfreePayment response is the only
// source of truth for whether a payment actually succeeded.
//
// verifyRes is the axios-style response from verifyCashfreePayment, i.e.
// { status, data: { success, message, order } }.
//
// Returns one of OUTCOME:
// - PAID   -> the server confirmed the payment; proceed with the success flow.
// - FAILED -> the server definitively confirmed the payment did NOT succeed;
//             the order may be cancelled and the table released.
// - PENDING-> the payment could not be confirmed one way or the other (e.g. a
//             transient error or a guard rejection); do NOT cancel - let the
//             webhook reconcile the order.

export const OUTCOME = {
  PAID: "paid",
  FAILED: "failed",
  PENDING: "pending",
};

const DEFINITIVE_FAILURES = [
  "Payment is not successful",
  "Payment amount does not match",
  "Payment currency mismatch",
];

export const decidePaymentOutcome = (verifyRes) => {
  if (!verifyRes) return OUTCOME.PENDING;

  if (verifyRes.data?.success === true) return OUTCOME.PAID;

  const message = verifyRes.data?.message || "";

  // The order is already marked paid on the server even though this response
  // is an error - never cancel or treat a settled order as failed.
  if (message.includes("already paid")) return OUTCOME.PAID;

  // Only when the server actually inspected a payment and found it not
  // successful do we consider the payment definitively failed.
  if (DEFINITIVE_FAILURES.some((reason) => message.includes(reason))) {
    return OUTCOME.FAILED;
  }

  // Everything else (could not confirm, order/verification guards, transport
  // errors, network failures) is ambiguous - do not cancel, let the webhook
  // settle the order.
  return OUTCOME.PENDING;
};