const crypto = require("crypto");
const Order = require("../models/Order");
const Payment = require("../models/Payment");
const {
  markPaymentFailed,
  deductInventoryForOrder,
} = require("./paymentController");

const SUPPORTED_EVENTS = new Set(["payment.captured", "payment.failed"]);

// Verifies the Razorpay webhook signature: HMAC-SHA256 of the raw request body
// using RAZORPAY_WEBHOOK_SECRET, compared in constant time. The raw Buffer body
// is required - the signature is invalid against a JSON-parsed body.
const verifyWebhookSignature = (rawBody, signature, secret) => {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) return false;
  if (typeof signature !== "string" || signature.length === 0) return false;
  if (!secret) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");

  if (expectedBuffer.length !== signatureBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
};

// Idempotent ledger sync for a captured Razorpay payment. ensurePaid never
// creates a duplicate "paid" record, so repeated webhooks/verifies are safe.
const settleLedger = async (order, razorpayOrderId, razorpayPaymentId) => {
  try {
    await Payment.ensurePaid({
      order: order._id,
      customer: order.customer || null,
      amount: order.total,
      method: "upi",
      gateway: "razorpay",
      collectedBy: order.createdBy,
      gatewayData: {
        gatewayOrderId: razorpayOrderId,
        gatewayPaymentId: razorpayPaymentId,
      },
    });
  } catch (paymentError) {
    console.error("RAZORPAY WEBHOOK PAYMENT RECORD SYNC FAILED:", paymentError.message);
  }
};

const handlePaymentCaptured = async (eventPayload) => {
  const paymentEntity = eventPayload?.payload?.payment?.entity;
  if (!paymentEntity?.id || !paymentEntity.order_id) {
    console.error("RAZORPAY WEBHOOK: payment entity missing for payment.captured");
    return;
  }

  const razorpayPaymentId = paymentEntity.id;
  const razorpayOrderId = paymentEntity.order_id;

  const order = await Order.findOne({ razorpayOrderId });
  if (!order) {
    console.error("RAZORPAY WEBHOOK: no order found for razorpay order", razorpayOrderId);
    return;
  }

  // Cancelled or refunded orders can never be marked paid again.
  if (["cancelled", "refunded"].includes(order.orderStatus)) {
    return;
  }

  // Idempotent re-delivery of a settled payment: only re-assert the ledger,
  // never re-apply the transition or inventory deduction.
  if (order.paymentStatus === "paid" && order.razorpayPaymentId === razorpayPaymentId) {
    await settleLedger(order, razorpayOrderId, razorpayPaymentId);
    return;
  }

  // Never downgrade or override an already-paid order with a different payment.
  if (order.paymentStatus === "paid") {
    return;
  }

  // Validate the payment/order relationship and amount/currency where the data
  // allows it, mirroring the browser-verify checks.
  const expectedAmount = Math.round(Number(order.total) * 100);
  if (Number(paymentEntity.amount) !== expectedAmount) {
    console.error("RAZORPAY WEBHOOK: amount mismatch for order", order.orderNumber);
    return;
  }
  if (paymentEntity.currency !== "INR") {
    console.error("RAZORPAY WEBHOOK: currency mismatch for order", order.orderNumber);
    return;
  }
  if (paymentEntity.status !== "captured") {
    console.error("RAZORPAY WEBHOOK: payment not captured for order", order.orderNumber);
    return;
  }

  // Respect the order state machine: pending -> confirmed is the only valid
  // route into a paid Razorpay order.
  if (!order.canTransitionTo("confirmed")) {
    console.error(
      "RAZORPAY WEBHOOK: cannot confirm order",
      order.orderNumber,
      "in status",
      order.orderStatus
    );
    return;
  }

  await order.transitionTo("confirmed", order.createdBy);

  order.paymentMethod = "upi";
  order.paymentGateway = "razorpay";
  order.paymentStatus = "paid";
  order.razorpayOrderId = razorpayOrderId;
  order.razorpayPaymentId = razorpayPaymentId;
  order.razorpaySignature = "";
  order.paidAt = new Date();

  await order.save();

  await settleLedger(order, razorpayOrderId, razorpayPaymentId);

  try {
    await deductInventoryForOrder(order, order.createdBy);
  } catch (inventoryError) {
    console.error("RAZORPAY WEBHOOK INVENTORY DEDUCTION FAILED:", inventoryError.message);
  }
};

const handlePaymentFailed = async (eventPayload) => {
  const paymentEntity = eventPayload?.payload?.payment?.entity;
  if (!paymentEntity?.order_id) {
    console.error("RAZORPAY WEBHOOK: payment entity missing for payment.failed");
    return;
  }

  const order = await Order.findOne({ razorpayOrderId: paymentEntity.order_id });
  if (!order) {
    console.error("RAZORPAY WEBHOOK: no order found for razorpay order", paymentEntity.order_id);
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
  order.paymentGateway = "razorpay";
  order.paymentStatus = "failed";
  await order.save();

  try {
    await markPaymentFailed(order, "Payment failed via Razorpay webhook");
  } catch (paymentError) {
    console.error("RAZORPAY WEBHOOK PAYMENT FAILURE RECORD SYNC FAILED:", paymentError.message);
  }
};

// POST /api/payment/webhook - entry point for Razorpay webhooks. Requires the
// raw request body (mounted with express.raw) so the HMAC can be recomputed
// over the exact bytes Razorpay signed.
const handleRazorpayWebhook = async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      console.error("RAZORPAY WEBHOOK ERROR: RAZORPAY_WEBHOOK_SECRET is not configured");
      return res.status(500).json({
        success: false,
        message: "Webhook secret is not configured",
      });
    }

    const signature = req.get("x-razorpay-signature");
    if (!signature) {
      return res.status(400).json({
        success: false,
        message: "Missing X-Razorpay-Signature header",
      });
    }

    if (!verifyWebhookSignature(req.body, signature, secret)) {
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

    const event = eventPayload?.event;

    if (event === "payment.captured") {
      await handlePaymentCaptured(eventPayload);
    } else if (event === "payment.failed") {
      await handlePaymentFailed(eventPayload);
    }
    // Unsupported events are acknowledged (HTTP 200) so Razorpay does not
    // retry them; only events that affect the restaurant order are processed.

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("RAZORPAY WEBHOOK ERROR:", error.message);
    return res.status(500).json({
      success: false,
      message: "Webhook processing failed",
    });
  }
};

module.exports = {
  handleRazorpayWebhook,
  handlePaymentCaptured,
  handlePaymentFailed,
  verifyWebhookSignature,
};