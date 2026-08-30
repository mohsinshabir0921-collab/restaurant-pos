const express = require("express");
const router = express.Router();

const {
  createCashfreeOrder,
  verifyCashfreePayment,
  createAdditionalCashfreeOrder,
  verifyAdditionalCashfreePayment,
  createAdditionalPaymentLink,
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
// Authenticated staff endpoint: generate/rotate a shareable additional-payment
// link (/pay/:token) for an order with an outstanding additional amount.
router.post(
  "/additional-link",
  protect,
  authorizeRoles("admin", "cashier"),
  createAdditionalPaymentLink
);
router.post("/webhook", handleCashfreeWebhook);

module.exports = router;