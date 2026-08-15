const mongoose = require("mongoose");
const Counter = require("./Counter");

const wasteLogSchema = new mongoose.Schema(
  {
    wasteNumber: { type: String, unique: true, sparse: true },
    items: [{
      item: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true },
      quantity: { type: Number, required: true, min: 0 },
      unit: { type: String, required: true },
      unitCost: { type: Number, default: 0 },
      totalCost: { type: Number, default: 0 },
      batchNumber: { type: String, trim: true },
      expiryDate: { type: Date },
    }],
    reason: {
      type: String,
      enum: ["expired", "spoiled", "damaged", "overcooked", "wrong_order", "customer_return", "quality", "theft", "other"],
      required: true,
    },
    reasonDetail: { type: String, trim: true },
    totalCost: { type: Number, default: 0, min: 0 },
    totalQuantity: { type: Number, default: 0 },
    location: { type: String, trim: true },
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isApproved: { type: Boolean, default: true },
    approvedAt: { type: Date },
    wasteDate: { type: Date, default: Date.now, index: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

wasteLogSchema.index({ wasteNumber: 1 });
wasteLogSchema.index({ wasteDate: -1 });
wasteLogSchema.index({ "items.item": 1 });
wasteLogSchema.index({ reportedBy: 1 });

wasteLogSchema.statics.generateWasteNumber = async function () {
  const date = new Date();
  const prefix = `WST${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, "0")}`;
  const sequence = await Counter.getNextSequence(`waste_${prefix}`);
  return `${prefix}${sequence.toString().padStart(4, "0")}`;
};

wasteLogSchema.pre("save", async function () {
  if (this.isNew && !this.wasteNumber) {
    this.wasteNumber = await this.constructor.generateWasteNumber();
  }
  this.totalQuantity = this.items.reduce((sum, item) => sum + item.quantity, 0);
  this.totalCost = this.items.reduce((sum, item) => sum + item.totalCost, 0);
});

wasteLogSchema.methods.approve = async function (userId) {
  if (this.isApproved) throw new Error("Already approved");
  this.isApproved = true;
  this.approvedBy = userId;
  this.approvedAt = new Date();
  await this.save();
  return this;
};

wasteLogSchema.methods.processWaste = async function (userId) {
  const InventoryItem = mongoose.model("InventoryItem");
  const StockMovement = mongoose.model("StockMovement");

  for (const wasteItem of this.items) {
    const inventoryItem = await InventoryItem.findById(wasteItem.item);
    if (!inventoryItem) continue;

    await inventoryItem.adjustStock(-wasteItem.quantity, `Waste: ${this.wasteNumber} - ${this.reason}`, this._id, "waste_log", userId);
    await StockMovement.create({
      item: inventoryItem._id,
      type: "waste",
      quantity: wasteItem.quantity,
      previousStock: inventoryItem.currentStock + wasteItem.quantity,
      newStock: inventoryItem.currentStock,
      unitCost: wasteItem.unitCost,
      totalCost: wasteItem.totalCost,
      reason: `Waste: ${this.wasteNumber} - ${this.reason}`,
      referenceId: this._id,
      referenceType: "waste_log",
      batchNumber: wasteItem.batchNumber,
      expiryDate: wasteItem.expiryDate,
      createdBy: userId,
    });
  }

  this.isApproved = true;
  this.approvedBy = userId;
  this.approvedAt = new Date();
  await this.save();
  return this;
};

module.exports = mongoose.model("WasteLog", wasteLogSchema);