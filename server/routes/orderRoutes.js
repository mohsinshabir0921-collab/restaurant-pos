const express = require("express");
const router = express.Router();

const {
  createOrder,
  getAllOrders,
  getOrderById,
  getKitchenOrders,
  updateOrderStatus,
  updateItemKitchenStatus,
  updateOrder,
  addItemsToOrder,
  removeItemFromOrder,
  cancelOrder,
  printKOT,
  printInvoice,
  markOrderPaid,
} = require("../controllers/orderController");

const { protect } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

const {
  assignDeliveryBoy,
  getOrderTracking,
} = require("../controllers/deliveryController");

router.post("/", protect, authorizeRoles("admin", "cashier"), createOrder);
router.get("/", protect, authorizeRoles("admin", "cashier"), getAllOrders);
router.get("/kitchen", protect, authorizeRoles("admin", "kitchen"), getKitchenOrders);
router.get("/:id", protect, authorizeRoles("admin", "cashier"), getOrderById);
router.get("/:id/tracking", protect, authorizeRoles("admin", "cashier", "delivery"), getOrderTracking);
router.post("/:id/assign", protect, authorizeRoles("admin", "cashier"), assignDeliveryBoy);
router.patch("/:id/status", protect, authorizeRoles("admin", "kitchen", "delivery"), updateOrderStatus);
router.patch("/:id/items/:itemIndex/kitchen-status", protect, authorizeRoles("admin", "kitchen"), updateItemKitchenStatus);
router.put("/:id", protect, authorizeRoles("admin", "cashier"), updateOrder);
router.post("/:id/items", protect, authorizeRoles("admin", "cashier"), addItemsToOrder);
router.delete("/:id/items/:itemIndex", protect, authorizeRoles("admin", "cashier"), removeItemFromOrder);
router.post("/:id/cancel", protect, authorizeRoles("admin", "cashier"), cancelOrder);
router.post("/:id/mark-paid", protect, authorizeRoles("admin", "cashier"), markOrderPaid);
router.post("/:id/print-kot", protect, authorizeRoles("admin", "cashier", "kitchen"), printKOT);
router.post("/:id/print-invoice", protect, authorizeRoles("admin", "cashier"), printInvoice);

module.exports = router;