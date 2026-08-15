const express = require("express");
const router = express.Router();

const {
  getCustomers,
  searchCustomers,
  getCustomerById,
  getCustomerByPhone,
  createOrGetCustomer,
  updateCustomer,
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  getCustomerOrders,
  getCustomerStats,
  redeemLoyaltyPoints,
} = require("../controllers/customerController");

const { protect } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

router.get("/", protect, authorizeRoles("admin", "cashier"), getCustomers);
router.get("/search", protect, authorizeRoles("admin", "cashier"), searchCustomers);
router.get("/:id", protect, authorizeRoles("admin", "cashier"), getCustomerById);
router.get("/phone/:phone", protect, authorizeRoles("admin", "cashier"), getCustomerByPhone);
router.get("/:id/orders", protect, authorizeRoles("admin", "cashier"), getCustomerOrders);
router.get("/:id/stats", protect, authorizeRoles("admin", "cashier"), getCustomerStats);
router.post("/lookup", protect, authorizeRoles("admin", "cashier"), createOrGetCustomer);
router.put("/:id", protect, authorizeRoles("admin"), updateCustomer);
router.post("/:id/addresses", protect, authorizeRoles("admin"), addAddress);
router.put("/:id/addresses/:addressId", protect, authorizeRoles("admin"), updateAddress);
router.delete("/:id/addresses/:addressId", protect, authorizeRoles("admin"), deleteAddress);
router.patch("/:id/addresses/:addressId/default", protect, authorizeRoles("admin"), setDefaultAddress);
router.post("/:id/redeem-points", protect, authorizeRoles("admin", "cashier"), redeemLoyaltyPoints);

module.exports = router;