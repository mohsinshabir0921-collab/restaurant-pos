const express = require("express");
const router = express.Router();

const {
  createCashfreeOrder,
  verifyCashfreePayment,
  createAdditionalCashfreeOrder,
  verifyAdditionalCashfreePayment,
} = require("../controllers/paymentController");

const { handleCashfreeWebhook } = require("../controllers/webhookController");

const { protect } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

router.post("/create-order", protect, authorizeRoles("admin", "cashier"), createCashfreeOrder);
router.post("/verify", protect, authorizeRoles("admin", "cashier"), verifyCashfreePayment);
router.post(
  "/create-additional-order",
  protect,
  authorizeRoles("admin", "cashier"),
  createAdditionalCashfreeOrder
);
router.post(
  "/verify-additional",
  protect,
  authorizeRoles("admin", "cashier"),
  verifyAdditionalCashfreePayment
);
router.post("/webhook", handleCashfreeWebhook);

module.exports = router;