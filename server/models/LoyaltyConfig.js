const mongoose = require("mongoose");

const loyaltyTierSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, enum: ["bronze", "silver", "gold", "platinum"] },
  minSpend: { type: Number, required: true, min: 0 },
  minVisits: { type: Number, default: 0, min: 0 },
  pointsMultiplier: { type: Number, default: 1, min: 0.1 },
  benefits: [{ type: String, trim: true }],
  color: { type: String, default: "#6b7280" },
}, { _id: false });

const loyaltyConfigSchema = new mongoose.Schema({
  isEnabled: { type: Boolean, default: true },
  pointsPerRupee: { type: Number, default: 1, min: 0 },
  rupeePerPoint: { type: Number, default: 1, min: 0.01 },
  minPointsToRedeem: { type: Number, default: 100, min: 1 },
  maxPointsPerOrder: { type: Number, default: 1000, min: 0 },
  pointsExpiryDays: { type: Number, default: 365, min: 0 },
  birthdayBonusPoints: { type: Number, default: 500, min: 0 },
  referralBonusPoints: { type: Number, default: 200, min: 0 },
  firstOrderBonusPoints: { type: Number, default: 100, min: 0 },
  tiers: [loyaltyTierSchema],
  earnRules: [{
    name: { type: String, required: true },
    condition: { type: String, enum: ["every_order", "min_amount", "specific_days", "specific_items", "payment_method"], required: true },
    value: { type: Number, required: true },
    bonusPoints: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  }],
  redeemRules: [{
    name: { type: String, required: true },
    minPoints: { type: Number, required: true },
    maxPoints: { type: Number },
    discountType: { type: String, enum: ["percent", "flat"], required: true },
    discountValue: { type: Number, required: true },
    maxDiscount: { type: Number },
    applicableOrderTypes: [{ type: String, enum: ["dinein", "takeaway", "delivery"] }],
    isActive: { type: Boolean, default: true },
  }],
}, { timestamps: true });

loyaltyConfigSchema.statics.getConfig = async function () {
  let config = await this.findOne().lean();
  if (!config) {
    config = await this.create({
      tiers: [
        { name: "bronze", minSpend: 0, minVisits: 0, pointsMultiplier: 1, benefits: ["Earn points on every order"], color: "#cd7f32" },
        { name: "silver", minSpend: 10000, minVisits: 10, pointsMultiplier: 1.2, benefits: ["20% bonus points", "Priority support"], color: "#c0c0c0" },
        { name: "gold", minSpend: 50000, minVisits: 30, pointsMultiplier: 1.5, benefits: ["50% bonus points", "Free delivery", "Birthday gift"], color: "#ffd700" },
        { name: "platinum", minSpend: 100000, minVisits: 50, pointsMultiplier: 2, benefits: ["100% bonus points", "Free delivery", "VIP support", "Exclusive offers"], color: "#e5e4e2" },
      ],
      earnRules: [
        { name: "Every Order", condition: "every_order", value: 1, bonusPoints: 0, isActive: true },
        { name: "Orders above 500", condition: "min_amount", value: 500, bonusPoints: 50, isActive: true },
      ],
      redeemRules: [
        { name: "100 Points = ₹1", minPoints: 100, discountType: "flat", discountValue: 1, isActive: true },
        { name: "500 Points = 10% off", minPoints: 500, discountType: "percent", discountValue: 10, maxDiscount: 200, isActive: true },
      ],
    });
  }
  return config;
};

module.exports = mongoose.model("LoyaltyConfig", loyaltyConfigSchema);