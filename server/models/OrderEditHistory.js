const mongoose = require("mongoose");

// Audit trail for "Edit Order" operations. Every accepted edit is recorded so
// the original payment/order information is never destroyed: we snapshot the
// previous items/totals and store the delta alongside any additional payment or
// refund/credit requirement created by the edit.
const orderItemSnapshotSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    price: { type: Number, default: 0 },
    qty: { type: Number, default: 1 },
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: "MenuItem", default: null },
    size: { type: String, trim: true, default: "" },
    modifiers: [{ name: String, option: String, price: Number }],
    notes: { type: String, trim: true },
  },
  { _id: false }
);

const orderEditHistorySchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    orderNumber: {
      type: String,
      trim: true,
    },
    editedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    previousItems: {
      type: [orderItemSnapshotSchema],
      default: [],
    },
    newItems: {
      type: [orderItemSnapshotSchema],
      default: [],
    },
    previousTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    newTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    difference: {
      type: Number,
      default: 0,
    },
    previousSubtotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    newSubtotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    paymentRequirement: {
      type: Number,
      default: 0,
      min: 0,
    },
    refundRequirement: {
      type: Number,
      default: 0,
      min: 0,
    },
    reason: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

orderEditHistorySchema.index({ order: 1, createdAt: -1 });
orderEditHistorySchema.index({ editedBy: 1, createdAt: -1 });

module.exports = mongoose.model("OrderEditHistory", orderEditHistorySchema);