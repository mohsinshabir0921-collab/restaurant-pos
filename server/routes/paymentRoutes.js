const express = require("express");
const router = express.Router();

const {
  createRazorpayOrder,
  verifyRazorpayPayment,
} = require("../controllers/paymentController");

const { handleRazorpayWebhook } = require("../controllers/webhookController");

const { protect } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

router.post("/create-order", protect, authorizeRoles("admin", "cashier"), createRazorpayOrder);
router.post("/verify", protect, authorizeRoles("admin", "cashier"), verifyRazorpayPayment);
router.post("/webhook", handleRazorpayWebhook);

module.exports = router;