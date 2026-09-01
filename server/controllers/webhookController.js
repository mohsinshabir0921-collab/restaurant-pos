const crypto = require("crypto");
const Order = require("../models/Order");
const Payment = require("../models/Payment");
const {
  markPaymentFailed,
  deductInventoryForOrder,
  settleAdditionalPayment,
} = require("./paymentController");

// Cashfree webhook events that affect the restaurant order.
const SUPPORTED_EVENTS = new Set([
  "PAYMENT_SUCCESS_WEBHOOK",
  "PAYMENT_FAILED_WEBHOOK",
]);

// Verifies the Cashfree webhook signature: base64(HMAC-SHA256) of the raw
// request body using the webhook secret, compared in constant time. Cashfree
// signs `x-webhook-timestamp + rawBody`; when the timestamp header is absent
// we fall back to the raw body alone for maximum compatibility with older
// dashboard configurations. The raw Buffer body is required.
const verifyWebhookSignature = (rawBody, signature, secret, timestamp = "") => {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) return false;
  if (typeof signature !== "string" || signature.length === 0) return false;
  if (!secret) return false;

  const raw = rawBody.toString("utf8");

  const candidates = timestamp
    ? [`${timestamp}${raw}`, raw]
    : [raw];

  for (const candidate of candidates) {
    const expected = crypto
      .createHmac("sha256", secret)
      .update(candidate)
      .digest("base64");

    const expectedBuffer = Buffer.from(expected, "base64");
    const signatureBuffer = Buffer.from(signature, "base64");

    if (
      expectedBuffer.length === signatureBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
    ) {
      return true;
    }
  }

  return false;
};

// Idempotent ledger sync for a successful Cashfree payment. ensurePaid never
// creates a duplicate "paid" record, so repeated webhooks/verifies are safe.
const settleLedger = async (order, cashfreeOrderId, cashfreePaymentId) => {
  try {
    await Payment.ensurePaid({
      order: order._id,
      customer: order.customer || null,
      amount: order.total,
      method: "upi",
      gateway: "cashfree",
      collectedBy: order.createdBy,
      gatewayData: {
        gatewayOrderId: cashfreeOrderId,
        gatewayPaymentId: cashfreePaymentId,
      },
    });
  } catch (paymentError) {
    console.error("CASHFREE WEBHOOK PAYMENT RECORD SYNC FAILED:", paymentError.message);
  }
};

// Resolves an order by an incoming Cashfree order_id. The id may belong to
// either the original full-order Cashfree order (cashfreeOrderId) or the
// separate additional-payment Cashfree order (cashfreeAdditionalOrderId).
// Returns { order, isAdditional } or null when no order matches either field.
// This lookup is deliberately scoped to exactly those two fields.
const resolveOrderByCashfreeId = async (cashfreeId) => {
  const order = await Order.findOne({
    $or: [{ cashfreeOrderId: cashfreeId }, { cashfreeAdditionalOrderId: cashfreeId }],
  });
  if (!order) return null;
  const isAdditional = !!(
    order.cashfreeAdditionalOrderId && order.cashfreeAdditionalOrderId === cashfreeId
  );
  return { order, isAdditional };
};

// Settles an additional-payment SUCCESS that arrived via webhook. Uses the SAME
// shared atomic settlement + ledger logic as the browser verify path, so a
// concurrent or already-settled additional payment can never be charged or
// ledgered twice.
const handleAdditionalPaymentSuccess = async (eventPayload) => {
  const paymentEntity = eventPayload?.data?.payment;
  if (!paymentEntity?.cf_payment_id || !paymentEntity.order_id) {
    console.error("CASHFREE ADDITIONAL WEBHOOK: payment entity missing");
    return false;
  }

  const cashfreeOrderId = paymentEntity.order_id;
  const order = await Order.findOne({ cashfreeAdditionalOrderId: cashfreeOrderId });
  if (!order) {
    console.error("CASHFREE ADDITIONAL WEBHOOK: no order found for", cashfreeOrderId);
    return false;
  }

  if (["cancelled", "refunded"].includes(order.orderStatus)) {
    return false;
  }

  // Already settled (or nothing due) - never re-settle a cleared delta.
  if (Number(order.additionalAmountDue || 0) <= 0) {
    return false;
  }

  // Validate against server-side additionalAmountDue - never trust the amount
  // carried in the webhook/browser as authority.
  const expectedAmount = Math.round((Number(order.additionalAmountDue) || 0) * 100) / 100;
  const reportedAmount =
    paymentEntity.order_amount ?? paymentEntity.payment_amount;
  if (Number(reportedAmount) !== expectedAmount) {
    console.error("CASHFREE ADDITIONAL WEBHOOK: amount mismatch for order", order.orderNumber);
    return false;
  }
  if (paymentEntity.payment_currency !== "INR") {
    console.error("CASHFREE ADDITIONAL WEBHOOK: currency mismatch for order", order.orderNumber);
    return false;
  }
  if (paymentEntity.payment_status !== "SUCCESS") {
    console.error("CASHFREE ADDITIONAL WEBHOOK: payment not successful for order", order.orderNumber);
    return false;
  }

  try {
    const result = await settleAdditionalPayment(order, paymentEntity, cashfreeOrderId);
    return result.status === "settled";
  } catch (error) {
    console.error("CASHFREE ADDITIONAL WEBHOOK SETTLEMENT ERROR:", error.message);
    return false;
  }
};

const handlePaymentSuccess = async (eventPayload) => {
  const paymentEntity = eventPayload?.data?.payment;
  const orderEntity = eventPayload?.data?.order || {};
  if (!paymentEntity?.cf_payment_id || !paymentEntity.order_id) {
    console.error("CASHFREE WEBHOOK: payment entity missing for PAYMENT_SUCCESS_WEBHOOK");
    return;
  }

  const cashfreePaymentId = String(paymentEntity.cf_payment_id);
  const cashfreeOrderId = paymentEntity.order_id;

  const resolved = await resolveOrderByCashfreeId(cashfreeOrderId);
  if (!resolved) {
    console.error("CASHFREE WEBHOOK: no order found for cashfree order", cashfreeOrderId);
    return;
  }
  const { order } = resolved;

  // The additional-payment Cashfree order is a separate, dedicated order and is
  // reconciled here so that a paid delta is settled even when the browser never
  // completes verifyAdditionalCashfreePayment. The original full-order webhook
  // path below is unchanged.
  if (resolved.isAdditional) {
    await handleAdditionalPaymentSuccess(eventPayload);
    return;
  }

  // Cancelled or refunded orders can never be marked paid again.
  if (["cancelled", "refunded"].includes(order.orderStatus)) {
    return;
  }

  // Idempotent re-delivery of a settled payment: only re-assert the ledger,
  // never re-apply the transition or inventory deduction.
  if (order.paymentStatus === "paid" && order.cashfreePaymentId === cashfreePaymentId) {
    await settleLedger(order, cashfreeOrderId, cashfreePaymentId);
    return;
  }

  // Never downgrade or override an already-paid order with a different payment.
  if (order.paymentStatus === "paid") {
    return;
  }

  // Validate the payment/order relationship and amount/currency where the data
  // allows it, mirroring the browser-verify checks. The webhook carries the
  // order amount on data.order and the charged amount on data.payment.
  const expectedAmount = Math.round(Number(order.total) * 100) / 100;
  const reportedAmount =
    paymentEntity.order_amount ?? orderEntity.order_amount ?? paymentEntity.payment_amount;
  if (Number(reportedAmount) !== expectedAmount) {
    console.error("CASHFREE WEBHOOK: amount mismatch for order", order.orderNumber);
    return;
  }
  if (paymentEntity.payment_currency !== "INR") {
    console.error("CASHFREE WEBHOOK: currency mismatch for order", order.orderNumber);
    return;
  }
  if (paymentEntity.payment_status !== "SUCCESS") {
    console.error("CASHFREE WEBHOOK: payment not successful for order", order.orderNumber);
    return;
  }

  // Respect the order state machine: pending -> confirmed is the only valid
  // route into a paid Cashfree order.
  if (!order.canTransitionTo("confirmed")) {
    console.error(
      "CASHFREE WEBHOOK: cannot confirm order",
      order.orderNumber,
      "in status",
      order.orderStatus
    );
    return;
  }

  await order.transitionTo("confirmed", order.createdBy);

  order.paymentMethod = "upi";
  order.paymentGateway = "cashfree";
  order.paymentStatus = "paid";
  order.cashfreeOrderId = cashfreeOrderId;
  order.cashfreePaymentId = cashfreePaymentId;
  order.cashfreePaymentStatus = paymentEntity.payment_status;
  order.paidAt = new Date();

  await order.save();

  await settleLedger(order, cashfreeOrderId, cashfreePaymentId);

  try {
    await deductInventoryForOrder(order, order.createdBy);
  } catch (inventoryError) {
    console.error("CASHFREE WEBHOOK INVENTORY DEDUCTION FAILED:", inventoryError.message);
  }
};

const handlePaymentFailed = async (eventPayload) => {
  const paymentEntity = eventPayload?.data?.payment;
  if (!paymentEntity?.order_id) {
    console.error("CASHFREE WEBHOOK: payment entity missing for PAYMENT_FAILED_WEBHOOK");
    return;
  }

  const resolved = await resolveOrderByCashfreeId(paymentEntity.order_id);
  if (!resolved) {
    console.error("CASHFREE WEBHOOK: no order found for cashfree order", paymentEntity.order_id);
    return;
  }
  const { order } = resolved;

  // A failed event for the additional-payment Cashfree order does NOT fail the
  // whole order: the original payment is still valid and the delta remains due,
  // so we leave the order state untouched.
  if (resolved.isAdditional) {
    return;
  }

  // Never downgrade a settled payment to failed, even if a failed event for a
  // different attempt arrives later.
  if (order.paymentStatus === "paid") {
    return;
  }

  // Idempotent: the order is already recorded as failed.
  if (order.paymentStatus === "failed") {
    return;
  }

  order.paymentMethod = "upi";
  order.paymentGateway = "cashfree";
  order.paymentStatus = "failed";
  await order.save();

  try {
    await markPaymentFailed(order, "Payment failed via Cashfree webhook");
  } catch (paymentError) {
    console.error("CASHFREE WEBHOOK PAYMENT FAILURE RECORD SYNC FAILED:", paymentError.message);
  }
};

// POST /api/payment/webhook - entry point for Cashfree webhooks. Requires the
// raw request body (mounted with express.raw) so the HMAC can be recomputed
// over the exact bytes Cashfree signed.
const handleCashfreeWebhook = async (req, res) => {
  try {
    const secret = process.env.CASHFREE_WEBHOOK_SECRET || process.env.CASHFREE_CLIENT_SECRET;
    if (!secret) {
      console.error("CASHFREE WEBHOOK ERROR: webhook secret is not configured");
      return res.status(500).json({
        success: false,
        message: "Webhook secret is not configured",
      });
    }

    const signature = req.get("x-webhook-signature");
    if (!signature) {
      return res.status(400).json({
        success: false,
        message: "Missing X-Webhook-Signature header",
      });
    }

    if (!verifyWebhookSignature(req.body, signature, secret, req.get("x-webhook-timestamp"))) {
      return res.status(400).json({
        success: false,
        message: "Invalid webhook signature",
      });
    }

    let eventPayload;
    try {
      eventPayload = JSON.parse(req.body.toString("utf8"));
    } catch (parseError) {
      return res.status(400).json({
        success: false,
        message: "Invalid webhook payload",
      });
    }

    const type = eventPayload?.type;

    if (type === "PAYMENT_SUCCESS_WEBHOOK") {
      await handlePaymentSuccess(eventPayload);
    } else if (type === "PAYMENT_FAILED_WEBHOOK") {
      await handlePaymentFailed(eventPayload);
    }
    // Unsupported events are acknowledged (HTTP 200) so Cashfree does not
    // retry them; only events that affect the restaurant order are processed.

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("CASHFREE WEBHOOK ERROR:", error.message);
    return res.status(500).json({
      success: false,
      message: "Webhook processing failed",
    });
  }
};

module.exports = {
  handleCashfreeWebhook,
  handlePaymentSuccess,
  handlePaymentFailed,
  verifyWebhookSignature,
};