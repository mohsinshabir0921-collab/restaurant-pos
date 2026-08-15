const Recipe = require("../models/Recipe");
const InventoryItem = require("../models/InventoryItem");
const MenuItem = require("../models/MenuItem");
const { handleError } = require("../utils/httpError");
const { parsePagination } = require("../utils/pagination");

const formatValidationError = (error) => {
  const messages = Object.values(error.errors || {})
    .map((e) => e.message)
    .join("; ");
  return {
    success: false,
    message: messages ? `Validation failed: ${messages}` : "Validation failed",
    errors: error.errors,
  };
};

const getRecipes = async (req, res) => {
  try {
    const { page = 1, limit = 50, search = "", isActive } = req.query;
    const query = {};

    if (search) {
      const menuItems = await MenuItem.find({ name: new RegExp(search, "i") }).select("_id").lean();
      query.menuItem = { $in: menuItems.map(m => m._id) };
    }
    if (isActive !== undefined) query.isActive = isActive === "true";

    const { page: safePage, limit: safeLimit, skip } = parsePagination(req.query, 50);
    const [recipes, total] = await Promise.all([
      Recipe.find(query).populate("menuItem", "name price isVeg category").populate("ingredients.item", "name unit currentStock costPerUnit").sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
      Recipe.countDocuments(query),
    ]);

    return res.status(200).json({ success: true, recipes, pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) } });
  } catch (error) {
    console.log("GET RECIPES ERROR:", error);
    return handleError(res, error);
  }
};

const getRecipeById = async (req, res) => {
  try {
    const { id } = req.params;
    const recipe = await Recipe.findById(id).populate("menuItem", "name price isVeg category").populate("ingredients.item", "name unit currentStock costPerUnit").lean();
    if (!recipe) return res.status(404).json({ success: false, message: "Recipe not found" });
    return res.status(200).json({ success: true, recipe });
  } catch (error) {
    console.log("GET RECIPE ERROR:", error);
    return handleError(res, error);
  }
};

const getRecipeByMenuItem = async (req, res) => {
  try {
    const { menuItemId } = req.params;
    const recipe = await Recipe.getByMenuItem(menuItemId);
    if (!recipe) return res.status(404).json({ success: false, message: "Recipe not found for this menu item" });
    return res.status(200).json({ success: true, recipe });
  } catch (error) {
    console.log("GET RECIPE BY MENU ITEM ERROR:", error);
    return handleError(res, error);
  }
};

const createRecipe = async (req, res) => {
  try {
    const { menuItem, ingredients, yieldQuantity, yieldUnit, prepInstructions, prepTime, isActive } = req.body;

    if (!menuItem) return res.status(400).json({ success: false, message: "Menu item is required" });
    if (!ingredients || !ingredients.length) return res.status(400).json({ success: false, message: "At least one ingredient is required" });

    const existingRecipe = await Recipe.findOne({ menuItem });
    if (existingRecipe) return res.status(400).json({ success: false, message: "Recipe already exists for this menu item" });

    const menuItemDoc = await MenuItem.findById(menuItem);
    if (!menuItemDoc) return res.status(404).json({ success: false, message: "Menu item not found" });

    for (const ing of ingredients) {
      const inventoryItem = await InventoryItem.findById(ing.item);
      if (!inventoryItem) return res.status(400).json({ success: false, message: `Inventory item ${ing.item} not found` });
      ing.unit = inventoryItem.unit;
    }

    const recipe = await Recipe.create({
      menuItem,
      ingredients,
      yieldQuantity: yieldQuantity || 1,
      yieldUnit: yieldUnit || "portion",
      prepInstructions: prepInstructions || [],
      prepTime: prepTime || 0,
      isActive: isActive !== undefined ? isActive : true,
    });

    const populatedRecipe = await Recipe.findById(recipe._id).populate("menuItem", "name price").populate("ingredients.item", "name unit currentStock costPerUnit").lean();
    return res.status(201).json({ success: true, message: "Recipe created", recipe: populatedRecipe });
  } catch (error) {
    console.log("CREATE RECIPE ERROR:", error);
    if (error.name === "ValidationError") return res.status(400).json(formatValidationError(error));
    if (error.code === 11000) return res.status(400).json({ success: false, message: "Recipe already exists for this menu item" });
    return handleError(res, error);
  }
};

const updateRecipe = async (req, res) => {
  try {
    const { id } = req.params;
    const { ingredients, yieldQuantity, yieldUnit, prepInstructions, prepTime, isActive } = req.body;

    const recipe = await Recipe.findById(id);
    if (!recipe) return res.status(404).json({ success: false, message: "Recipe not found" });

    if (ingredients) {
      for (const ing of ingredients) {
        const inventoryItem = await InventoryItem.findById(ing.item);
        if (!inventoryItem) return res.status(400).json({ success: false, message: `Inventory item ${ing.item} not found` });
        ing.unit = inventoryItem.unit;
      }
      recipe.ingredients = ingredients;
    }

    if (yieldQuantity !== undefined) recipe.yieldQuantity = yieldQuantity;
    if (yieldUnit !== undefined) recipe.yieldUnit = yieldUnit;
    if (prepInstructions !== undefined) recipe.prepInstructions = prepInstructions;
    if (prepTime !== undefined) recipe.prepTime = prepTime;
    if (isActive !== undefined) recipe.isActive = isActive;

    await recipe.save();
    const populatedRecipe = await Recipe.findById(recipe._id).populate("menuItem", "name price").populate("ingredients.item", "name unit currentStock costPerUnit").lean();
    return res.status(200).json({ success: true, message: "Recipe updated", recipe: populatedRecipe });
  } catch (error) {
    console.log("UPDATE RECIPE ERROR:", error);
    if (error.name === "ValidationError") return res.status(400).json(formatValidationError(error));
    if (error.code === 11000) return res.status(400).json({ success: false, message: "Recipe already exists for this menu item" });
    return handleError(res, error);
  }
};

const deleteRecipe = async (req, res) => {
  try {
    const { id } = req.params;
    const recipe = await Recipe.findByIdAndDelete(id);
    if (!recipe) return res.status(404).json({ success: false, message: "Recipe not found" });
    return res.status(200).json({ success: true, message: "Recipe deleted" });
  } catch (error) {
    console.log("DELETE RECIPE ERROR:", error);
    return handleError(res, error);
  }
};

const calculateRecipeCost = async (req, res) => {
  try {
    const { id } = req.params;
    const recipe = await Recipe.findById(id).populate("ingredients.item", "costPerUnit").lean();
    if (!recipe) return res.status(404).json({ success: false, message: "Recipe not found" });

    const cost = recipe.calculateCost();
    const costPerPortion = cost / recipe.yieldQuantity;

    return res.status(200).json({ success: true, totalCost: cost, costPerPortion, yieldQuantity: recipe.yieldQuantity, yieldUnit: recipe.yieldUnit });
  } catch (error) {
    console.log("CALCULATE RECIPE COST ERROR:", error);
    return handleError(res, error);
  }
};

const checkStockForRecipe = async (req, res) => {
  try {
    const { menuItemId, quantity = 1 } = req.query;
    const recipe = await Recipe.getByMenuItem(menuItemId);
    if (!recipe) return res.status(404).json({ success: false, message: "Recipe not found" });

    const results = recipe.ingredients.map(ing => {
      const required = ing.quantity * quantity;
      return {
        item: ing.item._id,
        name: ing.item.name,
        unit: ing.item.unit,
        required,
        available: ing.item.currentStock,
        sufficient: ing.item.currentStock >= required,
        shortfall: Math.max(0, required - ing.item.currentStock),
      };
    });

    const allSufficient = results.every(r => r.sufficient);
    return res.status(200).json({ success: true, canPrepare: allSufficient, items: results });
  } catch (error) {
    console.log("CHECK STOCK ERROR:", error);
    return handleError(res, error);
  }
};

module.exports = {
  getRecipes,
  getRecipeById,
  getRecipeByMenuItem,
  createRecipe,
  updateRecipe,
  deleteRecipe,
  calculateRecipeCost,
  checkStockForRecipe,
};