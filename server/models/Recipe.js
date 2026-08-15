const mongoose = require("mongoose");

const recipeSchema = new mongoose.Schema(
  {
    menuItem: { type: mongoose.Schema.Types.ObjectId, ref: "MenuItem", required: true, unique: true },
    ingredients: [{
      item: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true },
      quantity: { type: Number, required: true, min: 0 },
      unit: { type: String, required: true },
      notes: { type: String, trim: true },
    }],
    yieldQuantity: { type: Number, default: 1, min: 1 },
    yieldUnit: { type: String, default: "portion" },
    prepInstructions: [{ type: String, trim: true }],
    prepTime: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

recipeSchema.index({ "ingredients.item": 1 });

recipeSchema.statics.getByMenuItem = async function (menuItemId) {
  return this.findOne({ menuItem: menuItemId, isActive: true }).populate("ingredients.item", "name unit currentStock costPerUnit");
};

recipeSchema.methods.calculateCost = function () {
  return this.ingredients.reduce((sum, ing) => {
    const itemCost = ing.item?.costPerUnit || 0;
    return sum + (itemCost * ing.quantity);
  }, 0);
};

module.exports = mongoose.model("Recipe", recipeSchema);