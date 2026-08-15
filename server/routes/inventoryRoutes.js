const express = require("express");
const router = express.Router();

const {
  getInventoryItems,
  getLowStockItems,
  getOutOfStockItems,
  getInventoryItemById,
  createInventoryItem,
  updateInventoryItem,
  adjustStock,
  deleteInventoryItem,
  getStockMovements,
  getStockSummary,
} = require("../controllers/inventoryController");

const { protect } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

router.get("/", protect, authorizeRoles("admin"), getInventoryItems);
router.get("/low-stock", protect, authorizeRoles("admin"), getLowStockItems);
router.get("/out-of-stock", protect, authorizeRoles("admin"), getOutOfStockItems);
router.get("/summary", protect, authorizeRoles("admin"), getStockSummary);
router.get("/movements", protect, authorizeRoles("admin"), getStockMovements);
router.get("/:id", protect, authorizeRoles("admin"), getInventoryItemById);
router.post("/", protect, authorizeRoles("admin"), createInventoryItem);
router.put("/:id", protect, authorizeRoles("admin"), updateInventoryItem);
router.patch("/:id/adjust", protect, authorizeRoles("admin"), adjustStock);
router.delete("/:id", protect, authorizeRoles("admin"), deleteInventoryItem);

module.exports = router;