const mongoose = require("mongoose");

const stockMovementSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true, index: true },
    type: { type: String, enum: ["in", "out", "adjustment", "waste", "transfer", "recipe_deduction"], required: true, index: true },
    quantity: { type: Number, required: true },
    previousStock: { type: Number, required: true },
    newStock: { type: Number, required: true },
    unitCost: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
    reason: { type: String, required: true, trim: true },
    referenceId: { type: mongoose.Schema.Types.ObjectId, index: true },
    referenceType: { type: String, enum: ["purchase_order", "order", "waste_log", "manual_adjustment", "recipe", "stock_transfer", "opening_stock"], index: true },
    batchNumber: { type: String, trim: true },
    expiryDate: { type: Date },
    location: { type: String, trim: true },
    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isApproved: { type: Boolean, default: true },
  },
  { timestamps: true }
);

stockMovementSchema.index({ item: 1, createdAt: -1 });
stockMovementSchema.index({ referenceId: 1, referenceType: 1 });
stockMovementSchema.index({ createdAt: -1 });
stockMovementSchema.index({ type: 1, createdAt: -1 });

stockMovementSchema.statics.getByItem = async function (itemId, limit = 50) {
  return this.find({ item: itemId }).populate("createdBy", "name").populate("approvedBy", "name").sort({ createdAt: -1 }).limit(limit);
};

stockMovementSchema.statics.getByDateRange = async function (startDate, endDate, type = null) {
  const query = { createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) } };
  if (type) query.type = type;
  return this.find(query).populate("item", "name unit").populate("createdBy", "name").sort({ createdAt: -1 });
};

stockMovementSchema.statics.getDailySummary = async function (date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  return this.aggregate([
    { $match: { createdAt: { $gte: start, $lte: end } } },
    { $group: { _id: "$type", count: { $sum: 1 }, totalQty: { $sum: "$quantity" }, totalCost: { $sum: "$totalCost" } } },
    { $sort: { _id: 1 } },
  ]);
};

module.exports = mongoose.model("StockMovement", stockMovementSchema);