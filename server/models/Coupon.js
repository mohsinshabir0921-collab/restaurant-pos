const mongoose = require("mongoose");

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      enum: ["percent", "flat", "buy_x_get_y"],
      required: true,
    },
    value: {
      type: Number,
      required: true,
      min: 0,
    },
    maxDiscount: {
      type: Number,
      min: 0,
    },
    minOrderAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    applicableOrderTypes: [{
      type: String,
      enum: ["dinein", "takeaway", "delivery"],
    }],
    applicableCategories: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
    }],
    applicableItems: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "MenuItem",
    }],
    excludedCategories: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
    }],
    excludedItems: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "MenuItem",
    }],
    usageLimit: {
      type: Number,
      default: null,
    },
    usageLimitPerCustomer: {
      type: Number,
      default: 1,
    },
    usageCount: {
      type: Number,
      default: 0,
    },
    validFrom: {
      type: Date,
      required: true,
    },
    validUntil: {
      type: Date,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    firstOrderOnly: {
      type: Boolean,
      default: false,
    },
    customerTags: [{
      type: String,
      trim: true,
    }],
    autoApply: {
      type: Boolean,
      default: false,
    },
    stackable: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

couponSchema.index({ isActive: 1, validFrom: 1, validUntil: 1 });
couponSchema.index({ autoApply: 1 });

couponSchema.methods.isValid = function (orderAmount = 0, orderType = "dinein", customer = null) {
  if (!this.isActive) return { valid: false, reason: "Coupon is inactive" };
  
  const now = new Date();
  if (now < this.validFrom) return { valid: false, reason: "Coupon not yet valid" };
  if (now > this.validUntil) return { valid: false, reason: "Coupon expired" };
  
  if (this.usageLimit && this.usageCount >= this.usageLimit) {
    return { valid: false, reason: "Coupon usage limit reached" };
  }
  
  if (orderAmount < this.minOrderAmount) {
    return { valid: false, reason: `Minimum order amount ${this.minOrderAmount} required` };
  }
  
  if (this.applicableOrderTypes.length && !this.applicableOrderTypes.includes(orderType)) {
    return { valid: false, reason: "Coupon not valid for this order type" };
  }
  
  if (this.firstOrderOnly && customer && customer.visitCount > 0) {
    return { valid: false, reason: "Coupon valid for first order only" };
  }
  
  return { valid: true };
};

couponSchema.methods.calculateDiscount = function (orderAmount, items = []) {
  let discount = 0;
  
  if (this.type === "percent") {
    discount = (orderAmount * this.value) / 100;
    if (this.maxDiscount && discount > this.maxDiscount) {
      discount = this.maxDiscount;
    }
  } else if (this.type === "flat") {
    discount = Math.min(this.value, orderAmount);
  }
  
  return Math.round(discount * 100) / 100;
};

couponSchema.methods.incrementUsage = async function () {
  this.usageCount += 1;
  return this.save();
};

couponSchema.statics.findValidForOrder = async function (code, orderAmount, orderType, customerId = null) {
  const coupon = await this.findOne({ code: code.toUpperCase() });
  if (!coupon) return null;
  
  const validation = coupon.isValid(orderAmount, orderType);
  if (!validation.valid) return null;
  
  if (customerId && coupon.usageLimitPerCustomer) {
    const Order = mongoose.model("Order");
    const customerUsage = await Order.countDocuments({
      customer: customerId,
      couponCode: code.toUpperCase(),
      orderStatus: { $nin: ["cancelled", "refunded"] },
    });
    if (customerUsage >= coupon.usageLimitPerCustomer) {
      return null;
    }
  }
  
  return coupon;
};

module.exports = mongoose.model("Coupon", couponSchema);