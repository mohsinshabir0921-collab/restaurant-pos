const express = require("express");
const router = express.Router();
const multer = require("multer");

const {
  getAllSettings,
  getPublicSettings,
  getSetting,
  updateSetting,
  bulkUpdateSettings,
  initializeDefaults,
  testPrint,
} = require("../controllers/settingsController");
const { uploadMedia, removeMedia, getHeroMedia } = require("../controllers/mediaController");

const { protect } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

// In-memory multipart parsing; files are streamed to object storage, never to MongoDB.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Translate multer errors into clean JSON (instead of HTML 500).
const multerErrorHandler = (err, req, res, next) => {
  if (!err) return next();
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ success: false, message: "File exceeds the 50 MB hard limit" });
  }
  if (err.code === "LIMIT_UNEXPECTED_FILE") {
    return res.status(400).json({ success: false, message: "Unexpected file field" });
  }
  return res.status(400).json({ success: false, message: err.message || "Upload error" });
};

router.get("/public", getPublicSettings);
// Public hero media retrieval — GridFS-backed, no auth (website needs to load image)
router.get("/media/hero/:id", getHeroMedia);

router.get("/init", protect, authorizeRoles("admin"), initializeDefaults);
router.post("/test-printer", protect, authorizeRoles("admin"), testPrint);
router.get("/", protect, authorizeRoles("admin"), getAllSettings);
router.get("/:key", protect, authorizeRoles("admin"), getSetting);
router.put("/:key", protect, authorizeRoles("admin"), updateSetting);
router.post("/bulk", protect, authorizeRoles("admin"), bulkUpdateSettings);

// Admin-only media upload (Hero Image / Hero Video) to GridFS (persistent).
router.post(
  "/media",
  protect,
  authorizeRoles("admin"),
  upload.single("file"),
  multerErrorHandler,
  uploadMedia
);
router.delete("/media", protect, authorizeRoles("admin"), removeMedia);

module.exports = router;