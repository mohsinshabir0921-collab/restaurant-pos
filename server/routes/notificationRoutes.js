const express = require("express");
const router = express.Router();

const {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  bulkDeleteNotifications,
  clearAllNotifications,
} = require("../controllers/notificationController");

const { protect } = require("../middleware/authMiddleware");

router.get("/", protect, getMyNotifications);
router.patch("/read-all", protect, markAllAsRead);
router.delete("/clear-all", protect, clearAllNotifications);
router.delete("/bulk", protect, bulkDeleteNotifications);
router.patch("/:id/read", protect, markAsRead);

module.exports = router;
