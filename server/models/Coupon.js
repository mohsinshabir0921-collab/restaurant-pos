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
    buyCount: {
      type: Number,
      default: 1,
      min: 1,
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
    return { valid: false, reason: `Minimum order amount of ₹${this.minOrderAmount} required` };
  }

  if (this.applicableOrderTypes.length && !this.applicableOrderTypes.includes(orderType)) {
    return { valid: false, reason: "Coupon not valid for this order type" };
  }

  if (this.firstOrderOnly) {
    const visitCount = customer && typeof customer.visitCount === "number" ? customer.visitCount : null;
    if (visitCount !== null && visitCount > 0) {
      return { valid: false, reason: "Coupon valid for first order only" };
    }
  }

  if (this.customerTags.length > 0) {
    const customerTags = customer && Array.isArray(customer.tags) ? customer.tags : [];
    const hasMatchingTag = this.customerTags.some((t) => customerTags.includes(t));
    if (!hasMatchingTag) {
      return { valid: false, reason: "Coupon is not available for your account" };
    }
  }

  return { valid: true };
};

couponSchema.methods._eligibleItems = function (items = []) {
  if (!items.length) return [];
  const hasApplicable = this.applicableCategories.length || this.applicableItems.length;
  const hasExcluded = this.excludedCategories.length || this.excludedItems.length;

  return items.filter((item) => {
    if (hasExcluded) {
      const itemId = String(item.menuItemId || item._id || "");
      const catId = String(item.categoryId || item.category?._id || item.category || "");
      if (this.excludedItems.some((e) => String(e) === itemId)) return false;
      if (this.excludedCategories.some((e) => String(e) === catId)) return false;
    }
    if (hasApplicable) {
      const itemId = String(item.menuItemId || item._id || "");
      const catId = String(item.categoryId || item.category?._id || item.category || "");
      const inItems = this.applicableItems.some((a) => String(a) === itemId);
      const inCats = this.applicableCategories.some((a) => String(a) === catId);
      return inItems || inCats;
    }
    return true;
  });
};

couponSchema.methods.calculateDiscount = function (orderAmount, items = []) {
  if (this.type === "percent") {
    let discount = (orderAmount * this.value) / 100;
    if (this.maxDiscount && discount > this.maxDiscount) {
      discount = this.maxDiscount;
    }
    return Math.round(discount * 100) / 100;
  }

  if (this.type === "flat") {
    return Math.round(Math.min(this.value, orderAmount) * 100) / 100;
  }

  if (this.type === "buy_x_get_y") {
    const eligible = this._eligibleItems(items);
    if (!eligible.length) return 0;

    const buyCount = this.buyCount || 1;
    const getCount = this.value || 1;
    const totalQty = eligible.reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
    if (totalQty < buyCount + getCount) return 0;

    const sets = Math.floor(totalQty / (buyCount + getCount));
    if (sets < 1) return 0;

    const sorted = [...eligible]
      .flatMap((item) => Array.from({ length: Number(item.qty) || 0 }, () => Number(item.price) || 0))
      .sort((a, b) => a - b);

    const freeCount = sets * getCount;
    let discount = 0;
    for (let i = 0; i < freeCount && i < sorted.length; i++) {
      discount += sorted[i];
    }

    if (this.maxDiscount && discount > this.maxDiscount) {
      discount = this.maxDiscount;
    }
    return Math.round(discount * 100) / 100;
  }

  return 0;
};

couponSchema.methods.incrementUsage = async function () {
  await mongoose.model("Coupon").updateOne(
    { _id: this._id },
    { $inc: { usageCount: 1 } }
  );
  this.usageCount += 1;
};

couponSchema.statics.findValidForOrder = async function (
  code,
  orderAmount,
  orderType,
  customerId = null,
  context = "pos"
) {
  const coupon = await this.findOne({ code: code.toUpperCase() });
  if (!coupon) return { coupon: null, reason: "Invalid or expired coupon" };

  let customer = null;
  if (customerId) {
    const Customer = mongoose.model("Customer");
    customer = await Customer.findById(customerId).lean();
  }

  const validation = coupon.isValid(orderAmount, orderType, customer);
  if (!validation.valid) return { coupon: null, reason: validation.reason };

  if (customerId && coupon.usageLimitPerCustomer) {
    const Order = mongoose.model("Order");
    const customerUsage = await Order.countDocuments({
      customer: customerId,
      couponCode: code.toUpperCase(),
      orderStatus: { $nin: ["cancelled", "refunded"] },
    });
    if (customerUsage >= coupon.usageLimitPerCustomer) {
      return { coupon: null, reason: "You have already used this coupon" };
    }
  }

  return { coupon, reason: null };
};

module.exports = mongoose.model("Coupon", couponSchema);
