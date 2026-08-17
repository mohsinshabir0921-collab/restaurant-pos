const express = require("express");
const router = express.Router();

const {
  getAll,
  create,
  update,
  toggle,
  deleteBanner,
} = require("../controllers/bannerController");

const { protect } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

router.get("/", protect, authorizeRoles("admin"), getAll);
router.post("/", protect, authorizeRoles("admin"), create);
router.put("/:id", protect, authorizeRoles("admin"), update);
router.patch("/:id/toggle", protect, authorizeRoles("admin"), toggle);
router.delete("/:id", protect, authorizeRoles("admin"), deleteBanner);

module.exports = router;