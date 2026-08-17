const express = require("express");
const router = express.Router();

const {
  reportLocation,
  getAssignedOrders,
} = require("../controllers/deliveryController");

const { protect } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

router.post("/location", protect, authorizeRoles("delivery"), reportLocation);
router.get("/assigned", protect, authorizeRoles("delivery"), getAssignedOrders);

module.exports = router;
