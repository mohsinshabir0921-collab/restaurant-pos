const mongoose = require("mongoose");

const inventoryItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, unique: true, sparse: true, trim: true },
    unit: { type: String, required: true, enum: ["kg", "g", "l", "ml", "pcs", "pack", "box", "dozen"], default: "kg" },
    category: { type: String, required: true, trim: true, enum: ["vegetables", "meat", "dairy", "spices", "beverages", "dry_goods", "frozen", "bakery", "other"] },
    currentStock: { type: Number, default: 0, min: 0 },
    minStock: { type: Number, default: 10, min: 0 },
    maxStock: { type: Number, default: 1000, min: 0 },
    reorderLevel: { type: Number, default: 20, min: 0 },
    costPerUnit: { type: Number, default: 0, min: 0 },
    sellingPrice: { type: Number, default: 0, min: 0 },
    supplier: { name: { type: String, trim: true }, contact: { type: String, trim: true }, email: { type: String, trim: true }, leadTimeDays: { type: Number, default: 2 } },
    storageLocation: { type: String, trim: true },
    expiryTracking: { type: Boolean, default: false },
    batchTracking: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

inventoryItemSchema.index({ category: 1, name: 1 });
inventoryItemSchema.index({ currentStock: 1 });
inventoryItemSchema.index({ isActive: 1 });

inventoryItemSchema.virtual("isLowStock").get(function () { return this.currentStock <= this.reorderLevel; });
inventoryItemSchema.virtual("isOutOfStock").get(function () { return this.currentStock <= 0; });
inventoryItemSchema.virtual("stockValue").get(function () { return this.currentStock * this.costPerUnit; });
inventoryItemSchema.set("toJSON", { virtuals: true });
inventoryItemSchema.set("toObject", { virtuals: true });

inventoryItemSchema.statics.getLowStockItems = async function () {
  return this.find({ isActive: true, $expr: { $lte: ["$currentStock", "$reorderLevel"] } }).sort({ currentStock: 1 });
};

inventoryItemSchema.statics.getOutOfStockItems = async function () {
  return this.find({ isActive: true, currentStock: { $lte: 0 } });
};

inventoryItemSchema.methods.adjustStock = async function (quantity, reason, referenceId = null, referenceType = "manual", userId = null) {
  const previousStock = this.currentStock;
  const wasLow = this.currentStock <= this.reorderLevel;
  this.currentStock = Math.max(0, this.currentStock + quantity);
  const movement = { item: this._id, type: quantity > 0 ? "in" : "out", quantity: Math.abs(quantity), previousStock, newStock: this.currentStock, reason, referenceId, referenceType, createdBy: userId };
  await this.save();

  if (!wasLow && this.currentStock <= this.reorderLevel) {
    try {
      const { createNotificationForAdmins } = require("../utils/notificationService");
      const outOfStock = this.currentStock <= 0;
      await createNotificationForAdmins({
        type: "inventory",
        title: outOfStock ? "Out of Stock" : "Low Stock",
        message: `${this.name} (${this.currentStock} ${this.unit})${outOfStock ? " is out of stock" : " is running low"}`,
        link: "/inventory",
        entityId: this._id,
      });
    } catch (error) {
      console.error("LOW STOCK NOTIFICATION ERROR:", error.message);
    }
  }

  return movement;
};

module.exports = mongoose.model("InventoryItem", inventoryItemSchema);