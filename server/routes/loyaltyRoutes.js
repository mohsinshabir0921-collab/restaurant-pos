const express = require("express");
const router = express.Router();

const {
  getLoyaltyConfig,
  updateLoyaltyConfig,
  getCustomerLoyalty,
  adjustLoyaltyPoints,
  getLoyaltyReport,
} = require("../controllers/loyaltyController");

const { protect } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

router.get("/config", protect, authorizeRoles("admin"), getLoyaltyConfig);
router.put("/config", protect, authorizeRoles("admin"), updateLoyaltyConfig);
router.get("/report", protect, authorizeRoles("admin"), getLoyaltyReport);
router.get("/customer/:id", protect, authorizeRoles("admin", "cashier"), getCustomerLoyalty);
router.patch("/customer/:id/adjust", protect, authorizeRoles("admin"), adjustLoyaltyPoints);

module.exports = router;