const mongoose = require("mongoose");

const menuItemSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    isVeg: {
      type: Boolean,
      default: true,
    },
    spiceLevel: {
      type: String,
      enum: ["none", "mild", "medium", "hot", "extra_hot"],
      default: "none",
    },
    prepTime: {
      type: Number,
      default: 10,
      min: 0,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    taxRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    image: {
      type: String,
      default: "",
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
    tags: [{
      type: String,
      trim: true,
    }],
    modifiers: [{
      name: { type: String, required: true, trim: true },
      options: [{
        name: { type: String, required: true, trim: true },
        price: { type: Number, default: 0 },
        isDefault: { type: Boolean, default: false },
      }],
      required: { type: Boolean, default: false },
      multiSelect: { type: Boolean, default: false },
      minSelections: { type: Number, default: 0 },
      maxSelections: { type: Number, default: 1 },
    }],
  },
  { timestamps: true }
);

menuItemSchema.index({ category: 1, displayOrder: 1, name: 1 });
menuItemSchema.index({ isAvailable: 1 });
menuItemSchema.index({ name: "text", description: "text", tags: "text" });

menuItemSchema.statics.getAvailableByCategory = async function (categoryId = null) {
  const query = { isAvailable: true };
  if (categoryId) query.category = categoryId;
  return this.find(query).populate("category", "name displayOrder").sort({ displayOrder: 1, name: 1 });
};

module.exports = mongoose.model("MenuItem", menuItemSchema);