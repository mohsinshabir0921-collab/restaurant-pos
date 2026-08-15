const express = require("express");
const router = express.Router();

const {
  getMenuItems,
  getMenuItemsByCategory,
  getMenuItemById,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  toggleAvailability,
  reorderMenuItems,
} = require("../controllers/menuController");

const { protect } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

router.get("/", getMenuItems);
router.get("/by-category", getMenuItemsByCategory);
router.post("/reorder", protect, authorizeRoles("admin"), reorderMenuItems);
router.get("/:id", getMenuItemById);
router.post("/", protect, authorizeRoles("admin"), createMenuItem);
router.put("/:id", protect, authorizeRoles("admin"), updateMenuItem);
router.patch("/:id/toggle", protect, authorizeRoles("admin"), toggleAvailability);
router.delete("/:id", protect, authorizeRoles("admin"), deleteMenuItem);

module.exports = router;