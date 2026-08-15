const express = require("express");
const router = express.Router();

const {
  getCoupons,
  getCouponById,
  validateCoupon,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  toggleCouponStatus,
} = require("../controllers/couponController");

const { protect } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

router.get("/", protect, authorizeRoles("admin"), getCoupons);
router.get("/validate", protect, authorizeRoles("admin", "cashier"), validateCoupon);
router.get("/:id", protect, authorizeRoles("admin"), getCouponById);
router.post("/", protect, authorizeRoles("admin"), createCoupon);
router.put("/:id", protect, authorizeRoles("admin"), updateCoupon);
router.patch("/:id/toggle", protect, authorizeRoles("admin"), toggleCouponStatus);
router.delete("/:id", protect, authorizeRoles("admin"), deleteCoupon);

module.exports = router;