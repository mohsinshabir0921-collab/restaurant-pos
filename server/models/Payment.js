const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    method: {
      type: String,
      enum: ["cash", "card", "upi", "wallet", "cod", "split"],
      required: true,
    },
    gateway: {
      type: String,
      enum: ["razorpay", "stripe", "cashfree", "manual"],
      default: "manual",
    },
    status: {
      type: String,
      enum: ["pending", "processing", "paid", "failed", "refunded", "partially_refunded", "cancelled"],
      default: "pending",
      index: true,
    },
    transactionId: {
      type: String,
      trim: true,
      sparse: true,
      index: true,
    },
    gatewayOrderId: {
      type: String,
      trim: true,
    },
    gatewayPaymentId: {
      type: String,
      trim: true,
    },
    gatewaySignature: {
      type: String,
      trim: true,
    },
    gatewayResponse: {
      type: mongoose.Schema.Types.Mixed,
    },
    refund: {
      amount: { type: Number, default: 0, min: 0 },
      reason: { type: String, trim: true },
      status: { type: String, enum: ["pending", "processed", "failed"], default: "pending" },
      gatewayRefundId: { type: String, trim: true },
      processedAt: { type: Date },
      processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    splitPayments: [{
      method: { type: String, enum: ["cash", "card", "upi", "wallet"], required: true },
      amount: { type: Number, required: true, min: 0 },
      reference: { type: String, trim: true },
    }],
    collectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    collectedAt: {
      type: Date,
    },
    notes: {
      type: String,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  { timestamps: true }
);

paymentSchema.index({ order: 1, status: 1 });
paymentSchema.index({ customer: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ gateway: 1, gatewayOrderId: 1 });

paymentSchema.statics.getByOrder = async function (orderId) {
  return this.find({ order: orderId }).sort({ createdAt: -1 });
};

// Idempotent single source for a paid ledger entry: creates exactly one
// "paid" Payment record per order, and only upgrades an existing record -
// it never creates duplicates or overwrites an already-paid record. Used by
// cash/card/wallet/split, Razorpay/UPI and COD flows alike so the payment
// ledger always matches order.paymentStatus === "paid".
paymentSchema.statics.ensurePaid = async function ({
  order,
  customer = null,
  amount,
  method,
  gateway = "manual",
  splitPayments,
  collectedBy = null,
  collectedAt = new Date(),
  gatewayData = {},
}) {
  const existing = await this.findOne({ order }).sort({ createdAt: -1 });

  if (existing) {
    const updates = {};
    if (existing.status !== "paid") {
      updates.status = "paid";
      updates.collectedAt = existing.collectedAt || collectedAt;
    } else if (!existing.collectedAt) {
      updates.collectedAt = collectedAt;
    }
    if (gatewayData.transactionId) updates.transactionId = gatewayData.transactionId;
    if (gatewayData.gatewayOrderId) updates.gatewayOrderId = gatewayData.gatewayOrderId;
    if (gatewayData.gatewayPaymentId) updates.gatewayPaymentId = gatewayData.gatewayPaymentId;
    if (gatewayData.gatewaySignature) updates.gatewaySignature = gatewayData.gatewaySignature;
    if (gatewayData.gatewayResponse) updates.gatewayResponse = gatewayData.gatewayResponse;
    if (Object.keys(updates).length === 0) return existing;
    return this.findByIdAndUpdate(existing._id, { $set: updates }, { new: true });
  }

  return this.create({
    order,
    customer,
    amount,
    method,
    gateway,
    status: "paid",
    ...(splitPayments ? { splitPayments } : {}),
    ...(gatewayData.transactionId ? { transactionId: gatewayData.transactionId } : {}),
    ...(gatewayData.gatewayOrderId ? { gatewayOrderId: gatewayData.gatewayOrderId } : {}),
    ...(gatewayData.gatewayPaymentId ? { gatewayPaymentId: gatewayData.gatewayPaymentId } : {}),
    ...(gatewayData.gatewaySignature ? { gatewaySignature: gatewayData.gatewaySignature } : {}),
    ...(gatewayData.gatewayResponse ? { gatewayResponse: gatewayData.gatewayResponse } : {}),
    collectedBy,
    collectedAt,
  });
};

paymentSchema.statics.getDailySummary = async function (date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  
  return this.aggregate([
    { $match: { createdAt: { $gte: start, $lte: end }, status: "paid" } },
    { $group: {
      _id: "$method",
      count: { $sum: 1 },
      total: { $sum: "$amount" },
    }},
    { $sort: { total: -1 } },
  ]);
};

paymentSchema.methods.markPaid = async function (gatewayData = {}) {
  this.status = "paid";
  this.collectedAt = new Date();
  if (gatewayData.transactionId) this.transactionId = gatewayData.transactionId;
  if (gatewayData.gatewayOrderId) this.gatewayOrderId = gatewayData.gatewayOrderId;
  if (gatewayData.gatewayPaymentId) this.gatewayPaymentId = gatewayData.gatewayPaymentId;
  if (gatewayData.gatewaySignature) this.gatewaySignature = gatewayData.gatewaySignature;
  if (gatewayData.gatewayResponse) this.gatewayResponse = gatewayData.gatewayResponse;
  return this.save();
};

paymentSchema.methods.markFailed = async function (reason = "") {
  this.status = "failed";
  this.notes = reason;
  return this.save();
};

paymentSchema.methods.initiateRefund = async function (amount, reason, userId) {
  if (this.status !== "paid") {
    throw new Error("Can only refund paid payments");
  }
  if (amount > this.amount) {
    throw new Error("Refund amount cannot exceed payment amount");
  }
  this.refund = {
    amount,
    reason,
    status: "pending",
    processedBy: userId,
  };
  this.status = "partially_refunded";
  if (amount === this.amount) this.status = "refunded";
  return this.save();
};

paymentSchema.methods.completeRefund = async function (gatewayRefundId) {
  this.refund.status = "processed";
  this.refund.gatewayRefundId = gatewayRefundId;
  this.refund.processedAt = new Date();
  return this.save();
};

module.exports = mongoose.model("Payment", paymentSchema);