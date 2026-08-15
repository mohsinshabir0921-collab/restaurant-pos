const LoyaltyConfig = require("../models/LoyaltyConfig");
const Customer = require("../models/Customer");
const { handleError } = require("../utils/httpError");

const getLoyaltyConfig = async (req, res) => {
  try {
    const config = await LoyaltyConfig.getConfig();
    return res.status(200).json({ success: true, config });
  } catch (error) {
    console.log("GET LOYALTY CONFIG ERROR:", error);
    return handleError(res, error);
  }
};

const updateLoyaltyConfig = async (req, res) => {
  try {
    const updates = req.body;
    const config = await LoyaltyConfig.getConfig();

    const numericRules = [
      { field: "pointsPerRupee", min: 0, label: "Points per rupee" },
      { field: "rupeePerPoint", min: 0.01, label: "Rupee per point" },
      { field: "minPointsToRedeem", min: 1, label: "Minimum redemption points" },
      { field: "maxPointsPerOrder", min: 0, label: "Maximum points per order" },
      { field: "pointsExpiryDays", min: 0, label: "Points expiry days" },
      { field: "birthdayBonusPoints", min: 0, label: "Birthday bonus points" },
      { field: "referralBonusPoints", min: 0, label: "Referral bonus points" },
      { field: "firstOrderBonusPoints", min: 0, label: "First order bonus points" },
    ];

    for (const rule of numericRules) {
      if (updates[rule.field] !== undefined) {
        const num = Number(updates[rule.field]);
        if (!Number.isFinite(num)) {
          return res.status(400).json({ success: false, message: `${rule.label} must be a valid number` });
        }
        if (num < rule.min) {
          return res.status(400).json({ success: false, message: `${rule.label} must be at least ${rule.min}` });
        }
        config[rule.field] = num;
      }
    }

    if (updates.isEnabled !== undefined) {
      if (typeof updates.isEnabled !== "boolean") {
        return res.status(400).json({ success: false, message: "isEnabled must be a boolean" });
      }
      config.isEnabled = updates.isEnabled;
    }

    for (const field of ["tiers", "earnRules", "redeemRules"]) {
      if (updates[field] !== undefined) {
        if (!Array.isArray(updates[field])) {
          return res.status(400).json({ success: false, message: `${field} must be an array` });
        }
        config[field] = updates[field];
      }
    }

    await config.save();
    return res.status(200).json({ success: true, message: "Loyalty config updated", config });
  } catch (error) {
    console.log("UPDATE LOYALTY CONFIG ERROR:", error);
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

const getCustomerLoyalty = async (req, res) => {
  try {
    const { id } = req.params;
    const customer = await Customer.findById(id).select("name phone loyaltyPoints loyaltyTier totalSpent visitCount").lean();
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

    const config = await LoyaltyConfig.getConfig();
    const currentTier = config.tiers.find(t => t.name === customer.loyaltyTier) || config.tiers[0];
    const nextTier = config.tiers.find(t => t.minSpend > currentTier.minSpend);

    return res.status(200).json({
      success: true,
      customer,
      currentTier,
      nextTier,
      pointsToNextTier: nextTier ? nextTier.minSpend - customer.totalSpent : 0,
    });
  } catch (error) {
    console.log("GET CUSTOMER LOYALTY ERROR:", error);
    return handleError(res, error);
  }
};

const adjustLoyaltyPoints = async (req, res) => {
  try {
    const { id } = req.params;
    const { points, reason } = req.body;

    const numericPoints = Number(points);
    if (!Number.isInteger(numericPoints) || numericPoints === 0) {
      return res.status(400).json({ success: false, message: "Points must be a non-zero whole number" });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ success: false, message: "Reason required" });
    }

    const customer = await Customer.findById(id);
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

    const newPoints = customer.loyaltyPoints + numericPoints;
    if (newPoints < 0) return res.status(400).json({ success: false, message: "Insufficient points" });

    customer.loyaltyPoints = newPoints;
    await customer.save();

    return res.status(200).json({
      success: true,
      message: `${numericPoints > 0 ? "Added" : "Deducted"} ${Math.abs(numericPoints)} points`,
      customer,
    });
  } catch (error) {
    console.log("ADJUST LOYALTY POINTS ERROR:", error);
    if (error.name === "CastError" || error.name === "BSONError") {
      return handleError(res, error);
    }
    return handleError(res, error);
  }
};

const getLoyaltyReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const query = {};
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const tierDistribution = await Customer.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$loyaltyTier", count: { $sum: 1 }, avgPoints: { $avg: "$loyaltyPoints" }, avgSpend: { $avg: "$totalSpent" } } },
    ]);

    const totalPoints = await Customer.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: null, totalPoints: { $sum: "$loyaltyPoints" }, totalCustomers: { $sum: 1 } } },
    ]);

    return res.status(200).json({ success: true, tierDistribution, totalPoints: totalPoints[0] || { totalPoints: 0, totalCustomers: 0 } });
  } catch (error) {
    console.log("LOYALTY REPORT ERROR:", error);
    return handleError(res, error);
  }
};

module.exports = {
  getLoyaltyConfig,
  updateLoyaltyConfig,
  getCustomerLoyalty,
  adjustLoyaltyPoints,
  getLoyaltyReport,
};