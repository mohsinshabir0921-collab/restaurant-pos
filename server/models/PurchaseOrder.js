const mongoose = require("mongoose");
const Counter = require("./Counter");

const poItemSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true },
    orderedQty: { type: Number, required: true, min: 1 },
    receivedQty: { type: Number, default: 0, min: 0 },
    unit: { type: String, required: true },
    costPerUnit: { type: Number, required: true, min: 0 },
    totalCost: { type: Number, required: true, min: 0 },
    batchNumber: { type: String, trim: true },
    expiryDate: { type: Date },
    notes: { type: String, trim: true },
  },
  { _id: true }
);

const purchaseOrderSchema = new mongoose.Schema(
  {
    poNumber: { type: String, unique: true, sparse: true },
    supplier: {
      name: { type: String, required: true, trim: true },
      contact: { type: String, trim: true },
      email: { type: String, trim: true },
      phone: { type: String, trim: true },
      address: { type: String, trim: true },
    },
    items: [poItemSchema],
    status: {
      type: String,
      enum: ["draft", "sent", "partially_received", "received", "cancelled", "on_hold"],
      default: "draft",
      index: true,
    },
    orderDate: { type: Date, default: Date.now, index: true },
    expectedDate: { type: Date },
    receivedDate: { type: Date },
    subtotal: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    shipping: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 },
    paymentTerms: { type: String, enum: ["cod", "net_7", "net_15", "net_30", "prepaid"], default: "net_30" },
    paymentStatus: { type: String, enum: ["pending", "partial", "paid", "overdue"], default: "pending" },
    notes: { type: String, trim: true },
    internalNotes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

purchaseOrderSchema.index({ supplier: 1, status: 1 });
purchaseOrderSchema.index({ poNumber: 1 });
purchaseOrderSchema.index({ createdAt: -1 });

purchaseOrderSchema.statics.generatePONumber = async function () {
  const date = new Date();
  const prefix = `PO${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, "0")}`;
  const sequence = await Counter.getNextSequence(`po_${prefix}`);
  return `${prefix}${sequence.toString().padStart(4, "0")}`;
};

purchaseOrderSchema.pre("save", async function () {
  if (this.isNew && !this.poNumber) {
    this.poNumber = await this.constructor.generatePONumber();
  }
  this.subtotal = this.items.reduce((sum, item) => sum + item.totalCost, 0);
  this.total = this.subtotal + this.tax + this.shipping - this.discount;
});

purchaseOrderSchema.methods.canReceive = function () {
  return ["sent", "partially_received"].includes(this.status);
};

purchaseOrderSchema.methods.receiveItems = async function (receivedItems, userId) {
  if (!this.canReceive()) throw new Error("PO cannot be received in current status");

  const InventoryItem = mongoose.model("InventoryItem");
  const StockMovement = mongoose.model("StockMovement");

  for (const received of receivedItems) {
    const poItem = this.items.id(received.itemId);
    if (!poItem) continue;

    const receiveQty = received.qty || 0;
    if (receiveQty <= 0) continue;

    poItem.receivedQty += receiveQty;

    const inventoryItem = await InventoryItem.findById(poItem.item);
    if (inventoryItem) {
      await inventoryItem.adjustStock(receiveQty, `PO Receive: ${this.poNumber}`, this._id, "purchase_order", userId);
      await StockMovement.create({
        item: inventoryItem._id,
        type: "in",
        quantity: receiveQty,
        previousStock: inventoryItem.currentStock - receiveQty,
        newStock: inventoryItem.currentStock,
        unitCost: poItem.costPerUnit,
        totalCost: poItem.costPerUnit * receiveQty,
        reason: `PO Receive: ${this.poNumber}`,
        referenceId: this._id,
        referenceType: "purchase_order",
        batchNumber: received.batchNumber,
        expiryDate: received.expiryDate,
        createdBy: userId,
      });
    }
  }

  const allReceived = this.items.every(item => item.receivedQty >= item.orderedQty);
  const anyReceived = this.items.some(item => item.receivedQty > 0);

  this.status = allReceived ? "received" : "partially_received";
  if (allReceived) this.receivedDate = new Date();
  this.receivedBy = userId;

  await this.save();
  return this;
};

module.exports = mongoose.model("PurchaseOrder", purchaseOrderSchema);