const express = require("express");
const router = express.Router();

const {
  registerUser,
  loginUser,
  refreshToken,
  logoutUser,
  getMe,
  getAllStaff,
  getStaffById,
  updateStaff,
  changePassword,
  deactivateStaff,
} = require("../controllers/authController");

const { protect } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

router.post("/register", protect, authorizeRoles("admin"), registerUser);
router.post("/login", loginUser);
router.post("/refresh", refreshToken);
router.post("/logout", protect, logoutUser);
router.get("/me", protect, getMe);

router.get("/staff", protect, authorizeRoles("admin"), getAllStaff);
router.get("/staff/:id", protect, authorizeRoles("admin"), getStaffById);
router.put("/staff/:id", protect, authorizeRoles("admin"), updateStaff);
router.patch("/staff/:id/password", protect, authorizeRoles("admin"), changePassword);
router.patch("/staff/:id/deactivate", protect, authorizeRoles("admin"), deactivateStaff);

module.exports = router;