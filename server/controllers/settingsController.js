const Settings = require("../models/Settings");
const { handleError } = require("../utils/httpError");
const thermalPrinter = require("../services/thermalPrinter");

const NUMERIC_KEYS = new Set(["default_cgst", "default_sgst", "default_igst", "service_charge_percent"]);
const BOOLEAN_KEYS = new Set([
  "tax_inclusive",
  "service_charge_enabled",
  "thermal_printer_enabled",
  "kot_auto_print",
  "sms_enabled",
  "whatsapp_enabled",
  "email_enabled",
  "takeaway_enabled",
  "delivery_enabled",
  "cash_payment_enabled",
  "online_payment_enabled",
  "website_enabled",
  "online_ordering_enabled",
]);

const validateSettingValue = (key, value) => {
  if (NUMERIC_KEYS.has(key) && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
    return `${key.replace(/_/g, " ")} must be a valid non-negative number`;
  }
  if (BOOLEAN_KEYS.has(key) && typeof value !== "boolean") {
    return `${key.replace(/_/g, " ")} must be true or false`;
  }
  if (key === "opening_hours") {
    let parsed = value;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return "opening hours must be valid JSON";
      }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "opening hours must be a valid object";
    }
    const timeRe = /^\d{1,2}:\d{2}$/;
    for (const [day, slot] of Object.entries(parsed)) {
      if (!slot || typeof slot !== "object") return `opening hours for ${day} must be an object`;
      if (typeof slot.open !== "string" || typeof slot.close !== "string") {
        return `opening hours for ${day} must have open and close as HH:mm strings`;
      }
      if (!timeRe.test(slot.open) || !timeRe.test(slot.close)) {
        return `opening hours for ${day} must be HH:mm format`;
      }
      const [oh, om] = slot.open.split(":").map(Number);
      const [ch, cm] = slot.close.split(":").map(Number);
      if (oh < 0 || oh > 23 || om < 0 || om > 59 || ch < 0 || ch > 23 || cm < 0 || cm > 59) {
        return `opening hours for ${day} has invalid time`;
      }
    }
  }
  return null;
};

const getAllSettings = async (req, res) => {
  try {
    const { group } = req.query;
    let settings;

    if (group) {
      settings = await Settings.getGroup(group);
    } else {
      settings = await Settings.find().sort({ group: 1, key: 1 }).lean();
    }

    return res.status(200).json({
      success: true,
      settings,
    });
  } catch (error) {
    console.log("GET SETTINGS ERROR:", error);
    return handleError(res, error);
  }
};

const getPublicSettings = async (req, res) => {
  try {
    const settings = await Settings.getPublicSettings();
    // The public website uses progressive per-km delivery pricing, so the old
    // flat delivery_fee setting must never be exposed to it.
    delete settings.delivery_fee;
    return res.status(200).json({
      success: true,
      settings,
    });
  } catch (error) {
    console.log("GET PUBLIC SETTINGS ERROR:", error);
    return handleError(res, error);
  }
};

const getSetting = async (req, res) => {
  try {
    const { key } = req.params;
    const setting = await Settings.findOne({ key }).lean();

    if (!setting) {
      return res.status(404).json({
        success: false,
        message: "Setting not found",
      });
    }

    return res.status(200).json({
      success: true,
      setting,
    });
  } catch (error) {
    console.log("GET SETTING ERROR:", error);
    return handleError(res, error);
  }
};

const updateSetting = async (req, res) => {
  try {
    const { key } = req.params;
    const { value, description, group } = req.body;

    if (value === undefined) {
      return res.status(400).json({
        success: false,
        message: "Value is required",
      });
    }

    const invalid = validateSettingValue(key, value);
    if (invalid) {
      return res.status(400).json({
        success: false,
        message: invalid,
      });
    }

    const setting = await Settings.setValue(String(key).trim(), value, description, group);

    return res.status(200).json({
      success: true,
      message: "Setting updated successfully",
      setting,
    });
  } catch (error) {
    console.log("UPDATE SETTING ERROR:", error);
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors || {})
        .map((e) => e.message)
        .join("; ");
      return res.status(400).json({
        success: false,
        message: messages ? `Validation failed: ${messages}` : "Validation failed",
      });
    }
    if (error.name === "CastError" || error.name === "BSONError") {
      return handleError(res, error);
    }
    return handleError(res, error);
  }
};

const bulkUpdateSettings = async (req, res) => {
  try {
    const { settings } = req.body;

    if (!Array.isArray(settings) || settings.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Settings array is required",
      });
    }

    const results = [];
    for (const s of settings) {
      if (!s.key || !String(s.key).trim()) {
        return res.status(400).json({
          success: false,
          message: "Each setting must have a key",
        });
      }
      if (s.value === undefined) {
        return res.status(400).json({
          success: false,
          message: `Value is required for "${s.key}"`,
        });
      }
      const invalid = validateSettingValue(s.key, s.value);
      if (invalid) {
        return res.status(400).json({
          success: false,
          message: invalid,
        });
      }
      const result = await Settings.setValue(String(s.key).trim(), s.value, s.description, s.group);
      results.push(result);
    }

    return res.status(200).json({
      success: true,
      message: `${results.length} settings updated`,
      settings: results,
    });
  } catch (error) {
    console.log("BULK UPDATE SETTINGS ERROR:", error);
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors || {})
        .map((e) => e.message)
        .join("; ");
      return res.status(400).json({
        success: false,
        message: messages ? `Validation failed: ${messages}` : "Validation failed",
      });
    }
    if (error.name === "CastError" || error.name === "BSONError") {
      return handleError(res, error);
    }
    return handleError(res, error);
  }
};

const initializeDefaults = async (req, res) => {
  try {
    await Settings.initializeDefaults();
    return res.status(200).json({
      success: true,
      message: "Default settings initialized",
    });
  } catch (error) {
    console.log("INITIALIZE DEFAULTS ERROR:", error);
    return handleError(res, error);
  }
};

const testPrint = async (req, res) => {
  try {
    await thermalPrinter.printTest();
    return res.status(200).json({
      success: true,
      message: "Test receipt sent to thermal printer",
    });
  } catch (error) {
    console.log("TEST PRINT ERROR:", error);
    return res.status(502).json({
      success: false,
      message: `Test print failed: ${error.message}`,
    });
  }
};

module.exports = {
  getAllSettings,
  getPublicSettings,
  getSetting,
  updateSetting,
  bulkUpdateSettings,
  initializeDefaults,
  testPrint,
};