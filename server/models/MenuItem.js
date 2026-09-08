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
    halfPrice: {
      type: Number,
      min: 0,
      default: null,
    },
    fullPrice: {
      type: Number,
      min: 0,
      default: null,
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

// Helper to resolve the exact price for a given size/variant.
// For Half/Full items: use halfPrice/fullPrice directly, ignoring modifier delta.
// For all other sizes or when half/full not set: fall back to base price.
menuItemSchema.statics.getPriceForSize = function (menuItem, size) {
  const s = String(size || "").toLowerCase().trim();
  if (s === "half" && menuItem.halfPrice != null && Number.isFinite(Number(menuItem.halfPrice))) return Number(menuItem.halfPrice);
  if (s === "full" && menuItem.fullPrice != null && Number.isFinite(Number(menuItem.fullPrice))) return Number(menuItem.fullPrice);
  return Number(menuItem.price) || 0;
};

menuItemSchema.methods.getPriceForSize = function (size) {
  return this.constructor.getPriceForSize(this, size);
};

// Ensure halfPrice/fullPrice always have a value after save — robust for legacy
// documents even when only unrelated fields (name, description, etc.) are touched.
// Also keep price as the Half-price compatibility mirror for Half/Full items.
menuItemSchema.pre("save", function () {
  // Always populate missing half/full, regardless of which field triggered save
  if (this.halfPrice == null || !Number.isFinite(Number(this.halfPrice))) {
    this.halfPrice = Number(this.price) || 0;
  }
  if (this.fullPrice == null || !Number.isFinite(Number(this.fullPrice))) {
    this.fullPrice = Number(this.price) || 0;
  }
  // Canonical: for Half/Full items, price must mirror halfPrice (price is Half)
  // Detect Half/Full by Size modifier containing both options; do not alter other size types
  try {
    const mods = Array.isArray(this.modifiers) ? this.modifiers : [];
    const sizeMod = mods.find((m) => m && /size|variant/i.test(m.name || ""));
    if (sizeMod && Array.isArray(sizeMod.options)) {
      const names = sizeMod.options.map((o) => String(o.name || "").toLowerCase().trim());
      const isHalfFull = names.includes("half") && names.includes("full");
      if (isHalfFull && Number(this.halfPrice) !== Number(this.price)) {
        this.price = Number(this.halfPrice) || 0;
      }
    }
  } catch (_) {
    // ignore detection errors — do not block save
  }
});

menuItemSchema.statics.getAvailableByCategory = async function (categoryId = null) {
  const query = { isAvailable: true };
  if (categoryId) query.category = categoryId;
  return this.find(query).populate("category", "name displayOrder").sort({ displayOrder: 1, name: 1 });
};

module.exports = mongoose.model("MenuItem", menuItemSchema);