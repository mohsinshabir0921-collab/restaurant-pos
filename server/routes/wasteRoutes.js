const express = require("express");
const router = express.Router();

const {
  getWasteLogs,
  getWasteLogById,
  createWasteLog,
  updateWasteLog,
  approveWasteLog,
  deleteWasteLog,
  getWasteSummary,
} = require("../controllers/wasteController");

const { protect } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

router.get("/", protect, authorizeRoles("admin"), getWasteLogs);
router.get("/summary", protect, authorizeRoles("admin"), getWasteSummary);
router.get("/:id", protect, authorizeRoles("admin"), getWasteLogById);
router.post("/", protect, authorizeRoles("admin"), createWasteLog);
router.put("/:id", protect, authorizeRoles("admin"), updateWasteLog);
router.patch("/:id/approve", protect, authorizeRoles("admin"), approveWasteLog);
router.delete("/:id", protect, authorizeRoles("admin"), deleteWasteLog);

module.exports = router;