const express = require("express");
const router = express.Router();

const {
  getTables,
  getFloorPlan,
  getTableById,
  createTable,
  updateTable,
  deleteTable,
  updateTableStatus,
  mergeTables,
  getTablesByStatus,
} = require("../controllers/tableController");

const { protect } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

router.get("/", protect, getTables);
router.get("/floor-plan", protect, getFloorPlan);
router.get("/status/:status", protect, getTablesByStatus);
router.get("/:id", protect, getTableById);
router.post("/", protect, authorizeRoles("admin"), createTable);
router.put("/:id", protect, authorizeRoles("admin"), updateTable);
router.patch("/:id/status", protect, authorizeRoles("admin", "cashier"), updateTableStatus);
router.post("/merge", protect, authorizeRoles("admin"), mergeTables);
router.delete("/:id", protect, authorizeRoles("admin"), deleteTable);

module.exports = router;