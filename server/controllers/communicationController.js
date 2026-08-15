const CommunicationTemplate = require("../models/CommunicationTemplate");
const { handleError } = require("../utils/httpError");
const { parsePagination } = require("../utils/pagination");

const getCommunicationTemplates = async (req, res) => {
  try {
    const { page = 1, limit = 20, type, trigger, isActive } = req.query;
    const query = {};

    if (type) query.type = type;
    if (trigger) query.trigger = trigger;
    if (isActive !== undefined) query.isActive = isActive === "true";

    const { page: safePage, limit: safeLimit, skip } = parsePagination(req.query, 20);
    const [templates, total] = await Promise.all([
      CommunicationTemplate.find(query).populate("createdBy", "name").sort({ trigger: 1, priority: -1 }).skip(skip).limit(safeLimit).lean(),
      CommunicationTemplate.countDocuments(query),
    ]);

    return res.status(200).json({ success: true, templates, pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) } });
  } catch (error) {
    console.log("GET COMM TEMPLATES ERROR:", error);
    return handleError(res, error);
  }
};

const getCommunicationTemplateById = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await CommunicationTemplate.findById(id).populate("createdBy", "name").populate("fallbackTemplate", "name").lean();
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });
    return res.status(200).json({ success: true, template });
  } catch (error) {
    console.log("GET COMM TEMPLATE ERROR:", error);
    return handleError(res, error);
  }
};

const getTemplatesByTrigger = async (req, res) => {
  try {
    const { trigger } = req.params;
    const { type } = req.query;
    const templates = await CommunicationTemplate.getByTrigger(trigger, type);
    return res.status(200).json({ success: true, templates });
  } catch (error) {
    console.log("GET TEMPLATES BY TRIGGER ERROR:", error);
    return handleError(res, error);
  }
};

const createCommunicationTemplate = async (req, res) => {
  try {
    const { name, type, trigger, subject, content, variables, isActive, sendDelayMinutes, conditions, priority, fallbackTemplate } = req.body;

    if (!name || !type || !trigger || !content) {
      return res.status(400).json({ success: false, message: "Name, type, trigger, and content are required" });
    }

    const existing = await CommunicationTemplate.findOne({ name });
    if (existing) return res.status(400).json({ success: false, message: "Template name already exists" });

    const template = await CommunicationTemplate.create({
      name: name.trim(),
      type,
      trigger,
      subject: subject?.trim(),
      content,
      variables: variables || [],
      isActive: isActive !== undefined ? isActive : true,
      sendDelayMinutes: sendDelayMinutes || 0,
      conditions: conditions || [],
      priority: priority || "normal",
      fallbackTemplate: fallbackTemplate || null,
      createdBy: req.user._id,
    });

    return res.status(201).json({ success: true, message: "Template created", template });
  } catch (error) {
    console.log("CREATE COMM TEMPLATE ERROR:", error);
    if (error.code === 11000) return res.status(400).json({ success: false, message: "Template name already exists" });
    return handleError(res, error);
  }
};

const updateCommunicationTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const template = await CommunicationTemplate.findById(id);
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });

    const allowedUpdates = ["name", "type", "trigger", "subject", "content", "variables", "isActive", "sendDelayMinutes", "conditions", "priority", "fallbackTemplate"];
    allowedUpdates.forEach(field => {
      if (updates[field] !== undefined) template[field] = updates[field];
    });

    await template.save();
    return res.status(200).json({ success: true, message: "Template updated", template });
  } catch (error) {
    console.log("UPDATE COMM TEMPLATE ERROR:", error);
    if (error.code === 11000) return res.status(400).json({ success: false, message: "Template name already exists" });
    return handleError(res, error);
  }
};

const deleteCommunicationTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await CommunicationTemplate.findByIdAndDelete(id);
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });
    return res.status(200).json({ success: true, message: "Template deleted" });
  } catch (error) {
    console.log("DELETE COMM TEMPLATE ERROR:", error);
    return handleError(res, error);
  }
};

const previewTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { data } = req.body;

    const template = await CommunicationTemplate.findById(id);
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });

    const rendered = template.render(data || {});
    return res.status(200).json({ success: true, preview: rendered });
  } catch (error) {
    console.log("PREVIEW TEMPLATE ERROR:", error);
    return handleError(res, error);
  }
};

module.exports = {
  getCommunicationTemplates,
  getCommunicationTemplateById,
  getTemplatesByTrigger,
  createCommunicationTemplate,
  updateCommunicationTemplate,
  deleteCommunicationTemplate,
  previewTemplate,
};