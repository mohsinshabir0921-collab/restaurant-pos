const express = require("express");
const router = express.Router();

const {
  getPurchaseOrders,
  getPurchaseOrderById,
  createPurchaseOrder,
  updatePurchaseOrder,
  sendPurchaseOrder,
  receivePurchaseOrder,
  cancelPurchaseOrder,
  deletePurchaseOrder,
  getPOSummary,
} = require("../controllers/purchaseOrderController");

const { protect } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

router.get("/", protect, authorizeRoles("admin"), getPurchaseOrders);
router.get("/summary", protect, authorizeRoles("admin"), getPOSummary);
router.get("/:id", protect, authorizeRoles("admin"), getPurchaseOrderById);
router.post("/", protect, authorizeRoles("admin"), createPurchaseOrder);
router.put("/:id", protect, authorizeRoles("admin"), updatePurchaseOrder);
router.patch("/:id/send", protect, authorizeRoles("admin"), sendPurchaseOrder);
router.patch("/:id/receive", protect, authorizeRoles("admin"), receivePurchaseOrder);
router.patch("/:id/cancel", protect, authorizeRoles("admin"), cancelPurchaseOrder);
router.delete("/:id", protect, authorizeRoles("admin"), deletePurchaseOrder);

module.exports = router;