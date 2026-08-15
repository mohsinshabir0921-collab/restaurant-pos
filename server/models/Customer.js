const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, default: "Home" },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    pincode: { type: String, required: true, trim: true },
    landmark: { type: String, trim: true },
    coordinates: {
      lat: { type: Number },
      lng: { type: Number },
    },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true }
);

const customerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      sparse: true,
    },
    gstin: {
      type: String,
      trim: true,
      uppercase: true,
    },
    addresses: [addressSchema],
    loyaltyPoints: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalSpent: {
      type: Number,
      default: 0,
      min: 0,
    },
    visitCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastVisit: {
      type: Date,
      default: null,
    },
    firstVisit: {
      type: Date,
      default: null,
    },
    preferredPaymentMethod: {
      type: String,
      enum: ["cash", "card", "upi", "wallet"],
      default: "cash",
    },
    dietaryPreferences: [{
      type: String,
      trim: true,
    }],
    allergies: [{
      type: String,
      trim: true,
    }],
    birthday: {
      type: Date,
    },
    anniversary: {
      type: Date,
    },
    source: {
      type: String,
      enum: ["walkin", "online", "referral", "social", "other"],
      default: "walkin",
    },
    tags: [{
      type: String,
      trim: true,
    }],
    isActive: {
      type: Boolean,
      default: true,
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

customerSchema.index({ phone: 1 });
customerSchema.index({ email: 1 });
customerSchema.index({ name: "text", phone: "text", email: "text" });
customerSchema.index({ loyaltyPoints: -1 });
customerSchema.index({ totalSpent: -1 });
customerSchema.index({ lastVisit: -1 });
customerSchema.index({ visitCount: -1 });

customerSchema.virtual("loyaltyTier").get(function () {
  if (this.totalSpent >= 100000) return "platinum";
  if (this.totalSpent >= 50000) return "gold";
  if (this.totalSpent >= 10000) return "silver";
  return "bronze";
});

customerSchema.set("toJSON", { virtuals: true });
customerSchema.set("toObject", { virtuals: true });

customerSchema.statics.search = async function (query, limit = 10) {
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return this.find({
    $or: [
      { phone: regex },
      { name: regex },
      { email: regex },
    ],
    isActive: true,
  })
    .select("name phone email loyaltyPoints totalSpent visitCount lastVisit loyaltyTier")
    .limit(limit)
    .lean();
};

customerSchema.statics.getByPhone = async function (phone) {
  return this.findOne({ phone: phone.trim() });
};

customerSchema.statics.createOrGet = async function (phone, name = "") {
  const normalizedPhone = phone.trim();
  let customer = await this.findOne({ phone: normalizedPhone });
  
  if (!customer) {
    customer = await this.create({
      phone: normalizedPhone,
      name: name.trim() || `Customer ${normalizedPhone.slice(-4)}`,
      firstVisit: new Date(),
      lastVisit: new Date(),
      visitCount: 1,
    });
  }
  
  return customer;
};

customerSchema.methods.recordVisit = async function (amount = 0, pointsEarned = 0) {
  this.visitCount += 1;
  this.lastVisit = new Date();
  this.totalSpent += amount;
  this.loyaltyPoints += pointsEarned;
  return this.save();
};

customerSchema.methods.redeemPoints = async function (points) {
  if (this.loyaltyPoints < points) {
    throw new Error("Insufficient loyalty points");
  }
  this.loyaltyPoints -= points;
  return this.save();
};

customerSchema.methods.addAddress = async function (addressData) {
  if (addressData.isDefault) {
    this.addresses.forEach(addr => addr.isDefault = false);
  }
  this.addresses.push(addressData);
  return this.save();
};

customerSchema.methods.setDefaultAddress = async function (addressId) {
  this.addresses.forEach(addr => {
    addr.isDefault = addr._id.toString() === addressId.toString();
  });
  return this.save();
};

module.exports = mongoose.model("Customer", customerSchema);