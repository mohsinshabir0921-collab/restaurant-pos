const express = require("express");
const router = express.Router();

const {
  getCommunicationTemplates,
  getCommunicationTemplateById,
  getTemplatesByTrigger,
  createCommunicationTemplate,
  updateCommunicationTemplate,
  deleteCommunicationTemplate,
  previewTemplate,
} = require("../controllers/communicationController");

const { protect } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/roleMiddleware");

router.get("/", protect, authorizeRoles("admin"), getCommunicationTemplates);
router.get("/trigger/:trigger", protect, authorizeRoles("admin"), getTemplatesByTrigger);
router.get("/:id", protect, authorizeRoles("admin"), getCommunicationTemplateById);
router.post("/", protect, authorizeRoles("admin"), createCommunicationTemplate);
router.put("/:id", protect, authorizeRoles("admin"), updateCommunicationTemplate);
router.post("/:id/preview", protect, authorizeRoles("admin"), previewTemplate);
router.delete("/:id", protect, authorizeRoles("admin"), deleteCommunicationTemplate);

module.exports = router;