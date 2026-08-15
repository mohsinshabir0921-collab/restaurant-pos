const express = require("express");
const router = express.Router();

const {
  getRecipes,
  getRecipeById,
  getRecipeByMenuItem,
  createRecipe,
  updateRecipe,
  deleteRecipe,
  calculateRecipeCost,
  checkStockForRecipe,
} = require("../controllers/recipeController");

const { protect } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

router.get("/", protect, authorizeRoles("admin"), getRecipes);
router.get("/menu-item/:menuItemId", protect, authorizeRoles("admin"), getRecipeByMenuItem);
router.get("/cost/:id", protect, authorizeRoles("admin"), calculateRecipeCost);
router.get("/check-stock", protect, authorizeRoles("admin", "kitchen"), checkStockForRecipe);
router.get("/:id", protect, authorizeRoles("admin"), getRecipeById);
router.post("/", protect, authorizeRoles("admin"), createRecipe);
router.put("/:id", protect, authorizeRoles("admin"), updateRecipe);
router.delete("/:id", protect, authorizeRoles("admin"), deleteRecipe);

module.exports = router;