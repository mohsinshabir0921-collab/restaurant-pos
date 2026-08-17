const mongoose = require("mongoose");
const Counter = require("./Counter");

const orderItemSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    qty: {
      type: Number,
      required: true,
      min: 1,
    },
    menuItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MenuItem",
      default: null,
    },
    category: {
      type: String,
      trim: true,
    },
    isVeg: {
      type: Boolean,
      default: true,
    },
    taxRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    modifiers: [{
      name: { type: String, required: true, trim: true },
      option: { type: String, required: true, trim: true },
      price: { type: Number, default: 0 },
    }],
    notes: {
      type: String,
      trim: true,
    },
    kitchenStatus: {
      type: String,
      enum: ["pending", "preparing", "ready", "served"],
      default: "pending",
    },
    kitchenStation: {
      type: String,
      trim: true,
    },
    servedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      unique: true,
      sparse: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
    },
    customerName: {
      type: String,
      required: true,
      trim: true,
    },
    customerPhone: {
      type: String,
      trim: true,
    },
    customerEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    table: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Table",
      default: null,
    },
    tableNo: {
      type: Number,
      default: null,
    },
    orderType: {
      type: String,
      enum: ["dinein", "takeaway", "delivery"],
      default: "dinein",
      index: true,
    },
    items: {
      type: [orderItemSchema],
      required: true,
      validate: {
        validator: function (value) {
          return Array.isArray(value) && value.length > 0;
        },
        message: "At least one item is required",
      },
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    tax: {
      type: Number,
      min: 0,
      default: 0,
    },
    cgst: {
      type: Number,
      min: 0,
      default: 0,
    },
    sgst: {
      type: Number,
      min: 0,
      default: 0,
    },
    igst: {
      type: Number,
      min: 0,
      default: 0,
    },
    serviceCharge: {
      type: Number,
      min: 0,
      default: 0,
    },
    discount: {
      type: Number,
      min: 0,
      default: 0,
    },
    discountType: {
      type: String,
      enum: ["percent", "flat", "coupon", "none"],
      default: "none",
    },
    discountReason: {
      type: String,
      trim: true,
    },
    couponCode: {
      type: String,
      trim: true,
    },
    loyaltyPointsUsed: {
      type: Number,
      default: 0,
      min: 0,
    },
    loyaltyPointsEarned: {
      type: Number,
      default: 0,
      min: 0,
    },
    total: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    roundingAdjustment: {
      type: Number,
      default: 0,
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "card", "upi", "wallet", "cod", "split"],
      default: "cash",
    },
    paymentGateway: {
      type: String,
      enum: ["razorpay"],
      required: false,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "partial", "refunded"],
      default: "pending",
      index: true,
    },
    orderStatus: {
      type: String,
      enum: ["pending", "confirmed", "preparing", "ready", "out_for_delivery", "delivered", "served", "paid", "completed", "cancelled", "refunded"],
      default: "pending",
      index: true,
    },
    razorpayOrderId: {
      type: String,
      default: null,
    },
    razorpayPaymentId: {
      type: String,
      default: null,
    },
    razorpaySignature: {
      type: String,
      default: null,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancellationReason: {
      type: String,
      trim: true,
    },
    deliveryAddress: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    deliveryFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    deliveryPartner: {
      type: String,
      trim: true,
    },
    deliveryDriver: {
      type: String,
      trim: true,
    },
    deliveryTrackingUrl: {
      type: String,
      trim: true,
    },
    estimatedDeliveryTime: {
      type: Date,
    },
    actualDeliveryTime: {
      type: Date,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    pickupAt: {
      type: Date,
      default: null,
    },
    isPickupConfirmed: {
      type: Boolean,
      default: false,
    },
    kotPrinted: {
      type: Boolean,
      default: false,
    },
    kotPrintedAt: {
      type: Date,
      default: null,
    },
    invoicePrinted: {
      type: Boolean,
      default: false,
    },
    invoicePrintedAt: {
      type: Date,
      default: null,
    },
    inventoryDeducted: {
      type: Boolean,
      default: false,
    },
    inventoryRestored: {
      type: Boolean,
      default: false,
    },
    invoiceNumber: {
      type: String,
      unique: true,
      sparse: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    internalNotes: {
      type: String,
      trim: true,
    },
    source: {
      type: String,
      enum: ["pos", "online", "phone", "walkin"],
      default: "pos",
    },
    servedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

orderSchema.index({ createdAt: -1 });
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ invoiceNumber: 1 });
orderSchema.index({ customerPhone: 1, createdAt: -1 });
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ table: 1, orderStatus: 1 });
orderSchema.index({ orderType: 1, orderStatus: 1 });
orderSchema.index({ paymentStatus: 1, orderStatus: 1 });
orderSchema.index({ "items.menuItemId": 1 });
orderSchema.index({ assignedTo: 1, orderStatus: 1 });

const ALLOWED_TRANSITIONS = {
  pending: ["confirmed", "preparing", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready", "served", "cancelled"],
  ready: ["served", "out_for_delivery", "cancelled"],
  out_for_delivery: ["delivered"],
  delivered: ["paid", "completed"],
  served: ["paid", "completed", "cancelled"],
  paid: ["completed", "cancelled"],
  completed: ["refunded"],
  cancelled: [],
  refunded: [],
};

orderSchema.methods.canTransitionTo = function (newStatus) {
  const current = this.orderStatus;
  return ALLOWED_TRANSITIONS[current]?.includes(newStatus) ?? false;
};

orderSchema.methods.transitionTo = async function (newStatus, userId = null) {
  if (!this.canTransitionTo(newStatus)) {
    throw new Error(`Cannot transition from ${this.orderStatus} to ${newStatus}`);
  }
  
  const updateData = { orderStatus: newStatus };
  
  if (newStatus === "paid" || newStatus === "completed") {
    updateData.paymentStatus = "paid";
    updateData.paidAt = this.paidAt || new Date();
  }
  if (newStatus === "completed") {
    updateData.completedAt = new Date();
  }
  if (newStatus === "cancelled") {
    updateData.cancelledAt = new Date();
    updateData.paymentStatus = this.paymentStatus === "paid" ? "paid" : "failed";
  }
  if (newStatus === "refunded") {
    updateData.paymentStatus = "refunded";
  }
  if (userId) {
    updateData.updatedBy = userId;
  }
  
  Object.assign(this, updateData);
  return this.save();
};

orderSchema.statics.generateOrderNumber = async function () {
  const date = new Date();
  const prefix = `ORD${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, "0")}${date.getDate().toString().padStart(2, "0")}`;
  const sequence = await Counter.getNextSequence(`order_${prefix}`);
  return `${prefix}${sequence.toString().padStart(4, "0")}`;
};

orderSchema.statics.generateInvoiceNumber = async function () {
  const date = new Date();
  const prefix = `INV${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, "0")}`;
  const sequence = await Counter.getNextSequence(`invoice_${prefix}`);
  return `${prefix}${sequence.toString().padStart(5, "0")}`;
};

orderSchema.statics.getKitchenOrders = async function () {
  return this.find({
    orderStatus: { $in: ["pending", "confirmed", "preparing", "ready"] },
  })
    .populate("table", "number zone")
    .populate("customer", "name phone")
    .sort({ createdAt: 1 })
    .lean();
};

orderSchema.statics.getActiveByTable = async function (tableId) {
  return this.findOne({
    table: tableId,
    orderStatus: { $in: ["pending", "confirmed", "preparing", "ready", "served"] },
  }).populate("items.menuItemId", "name isVeg prepTime");
};

orderSchema.pre("save", async function () {
  if (this.isNew && !this.orderNumber) {
    this.orderNumber = await this.constructor.generateOrderNumber();
  }
  if (this.isModified("orderStatus") && this.orderStatus === "completed" && !this.invoiceNumber) {
    this.invoiceNumber = await this.constructor.generateInvoiceNumber();
  }
});

module.exports = mongoose.model("Order", orderSchema);