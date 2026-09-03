const express = require("express");
const router = express.Router();

const {
  getMenuItems,
  getMenuItemsByCategory,
  getMenuItemById,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  toggleAvailability,
  reorderMenuItems,
  uploadMenuImage,
  getMenuImage,
} = require("../controllers/menuController");

const { protect } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");
const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const multerErrorHandler = (err, req, res, next) => {
  if (!err) return next();
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ success: false, message: "File exceeds the 5 MB limit" });
  }
  if (err.code === "LIMIT_UNEXPECTED_FILE") {
    return res.status(400).json({ success: false, message: "Unexpected file field" });
  }
  return res.status(400).json({ success: false, message: err.message || "Upload error" });
};

router.get("/", getMenuItems);
router.get("/by-category", getMenuItemsByCategory);
router.get("/images/:id", getMenuImage);
router.post("/reorder", protect, authorizeRoles("admin"), reorderMenuItems);
router.post(
  "/upload-image",
  protect,
  authorizeRoles("admin"),
  upload.single("file"),
  multerErrorHandler,
  uploadMenuImage
);
router.get("/:id", getMenuItemById);
router.post("/", protect, authorizeRoles("admin"), createMenuItem);
router.put("/:id", protect, authorizeRoles("admin"), updateMenuItem);
router.patch("/:id/toggle", protect, authorizeRoles("admin"), toggleAvailability);
router.delete("/:id", protect, authorizeRoles("admin"), deleteMenuItem);

module.exports = router;