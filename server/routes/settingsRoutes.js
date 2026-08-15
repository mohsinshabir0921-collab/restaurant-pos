const express = require("express");
const router = express.Router();

const {
  getAllSettings,
  getPublicSettings,
  getSetting,
  updateSetting,
  bulkUpdateSettings,
  initializeDefaults,
} = require("../controllers/settingsController");

const { protect } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

router.get("/public", getPublicSettings);
router.get("/init", protect, authorizeRoles("admin"), initializeDefaults);
router.get("/", protect, authorizeRoles("admin"), getAllSettings);
router.get("/:key", protect, authorizeRoles("admin"), getSetting);
router.put("/:key", protect, authorizeRoles("admin"), updateSetting);
router.post("/bulk", protect, authorizeRoles("admin"), bulkUpdateSettings);

module.exports = router;