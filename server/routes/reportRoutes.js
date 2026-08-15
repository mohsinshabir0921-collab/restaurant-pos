const express = require("express");
const router = express.Router();

const {
  getTodayReport,
  getDashboardReport,
  getDateRangeReport,
  getSalesByCategory,
  getSalesByItem,
  getPaymentReport,
  getTaxReport,
  getStaffReport,
  getCustomerReport,
  getHourlyReport,
} = require("../controllers/reportController");

const { protect } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

router.get("/today", protect, authorizeRoles("admin"), getTodayReport);
router.get("/dashboard", protect, authorizeRoles("admin"), getDashboardReport);
router.get("/date-range", protect, authorizeRoles("admin"), getDateRangeReport);
router.get("/sales-by-category", protect, authorizeRoles("admin"), getSalesByCategory);
router.get("/sales-by-item", protect, authorizeRoles("admin"), getSalesByItem);
router.get("/payments", protect, authorizeRoles("admin"), getPaymentReport);
router.get("/tax", protect, authorizeRoles("admin"), getTaxReport);
router.get("/staff", protect, authorizeRoles("admin"), getStaffReport);
router.get("/customers", protect, authorizeRoles("admin"), getCustomerReport);
router.get("/hourly", protect, authorizeRoles("admin"), getHourlyReport);

module.exports = router;