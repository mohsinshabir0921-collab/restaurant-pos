const Coupon = require("../models/Coupon");
const { handleError } = require("../utils/httpError");
const { parsePagination } = require("../utils/pagination");

const formatValidationError = (error) => {
  const messages = Object.values(error.errors || {})
    .map((e) => e.message)
    .join("; ");
  return {
    success: false,
    message: messages ? `Validation failed: ${messages}` : "Validation failed",
    errors: error.errors,
  };
};

const getCoupons = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      search = "", 
      isActive,
      type,
    } = req.query;

    const query = {};
    
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ code: regex }, { name: regex }];
    }
    
    if (isActive !== undefined) query.isActive = isActive === "true";
    if (type) query.type = type;

    const { page: safePage, limit: safeLimit, skip } = parsePagination(req.query, 20);

    const [coupons, total] = await Promise.all([
      Coupon.find(query).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
      Coupon.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      coupons,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    });
  } catch (error) {
    console.log("GET COUPONS ERROR:", error);
    return handleError(res, error);
  }
};

const getCouponById = async (req, res) => {
  try {
    const { id } = req.params;
    const coupon = await Coupon.findById(id)
      .populate("applicableCategories", "name")
      .populate("excludedCategories", "name")
      .populate("applicableItems", "name price")
      .populate("excludedItems", "name price")
      .lean();

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
      });
    }

    return res.status(200).json({
      success: true,
      coupon,
    });
  } catch (error) {
    console.log("GET COUPON ERROR:", error);
    return handleError(res, error);
  }
};

const validateCoupon = async (req, res) => {
  try {
    const { code, orderAmount, orderType, customerId } = req.query;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Coupon code is required",
      });
    }

    const coupon = await Coupon.findValidForOrder(code, orderAmount || 0, orderType || "dinein", customerId);

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: "Invalid or expired coupon",
      });
    }

    const discount = coupon.calculateDiscount(orderAmount || 0);

    return res.status(200).json({
      success: true,
      coupon: {
        _id: coupon._id,
        code: coupon.code,
        name: coupon.name,
        type: coupon.type,
        value: coupon.value,
        maxDiscount: coupon.maxDiscount,
        discount,
      },
    });
  } catch (error) {
    console.log("VALIDATE COUPON ERROR:", error);
    return handleError(res, error);
  }
};

const createCoupon = async (req, res) => {
  try {
    const {
      code,
      name,
      description,
      type,
      value,
      maxDiscount,
      minOrderAmount,
      applicableOrderTypes,
      applicableCategories,
      applicableItems,
      excludedCategories,
      excludedItems,
      usageLimit,
      usageLimitPerCustomer,
      validFrom,
      validUntil,
      isActive,
      firstOrderOnly,
      customerTags,
      autoApply,
      stackable,
    } = req.body;

    const codeValue = String(code || "").trim().toUpperCase();
    if (!codeValue) {
      return res.status(400).json({ success: false, message: "Coupon code is required" });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: "Coupon name is required" });
    }
    if (!type || !["percent", "flat", "buy_x_get_y"].includes(type)) {
      return res.status(400).json({ success: false, message: "Invalid coupon type" });
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 0) {
      return res.status(400).json({ success: false, message: "Coupon value must be a valid non-negative number" });
    }

    const fromDate = validFrom ? new Date(validFrom) : new Date();
    const untilDate = validUntil ? new Date(validUntil) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    if (isNaN(fromDate.getTime()) || isNaN(untilDate.getTime())) {
      return res.status(400).json({ success: false, message: "Valid from and valid until must be valid dates" });
    }
    if (untilDate <= fromDate) {
      return res.status(400).json({ success: false, message: "Valid until must be after valid from" });
    }

    const existingCoupon = await Coupon.findOne({ code: codeValue });
    if (existingCoupon) {
      return res.status(400).json({
        success: false,
        message: "Coupon code already exists",
      });
    }

    const coupon = await Coupon.create({
      code: codeValue,
      name: name.trim(),
      description: description?.trim() || "",
      type,
      value: numericValue,
      maxDiscount: maxDiscount ? Number(maxDiscount) : null,
      minOrderAmount: minOrderAmount ? Number(minOrderAmount) : 0,
      applicableOrderTypes: Array.isArray(applicableOrderTypes) ? applicableOrderTypes : ["dinein", "takeaway", "delivery"],
      applicableCategories: Array.isArray(applicableCategories) ? applicableCategories : [],
      applicableItems: Array.isArray(applicableItems) ? applicableItems : [],
      excludedCategories: Array.isArray(excludedCategories) ? excludedCategories : [],
      excludedItems: Array.isArray(excludedItems) ? excludedItems : [],
      usageLimit: usageLimit ? Number(usageLimit) : null,
      usageLimitPerCustomer: usageLimitPerCustomer ? Number(usageLimitPerCustomer) : 1,
      validFrom: fromDate,
      validUntil: untilDate,
      isActive: isActive !== undefined ? isActive : true,
      firstOrderOnly: firstOrderOnly || false,
      customerTags: Array.isArray(customerTags) ? customerTags : [],
      autoApply: autoApply || false,
      stackable: stackable || false,
    });

    return res.status(201).json({
      success: true,
      message: "Coupon created successfully",
      coupon,
    });
  } catch (error) {
    console.log("CREATE COUPON ERROR:", error);
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Coupon code already exists" });
    }
    if (error.name === "ValidationError") {
      return res.status(400).json(formatValidationError(error));
    }
    if (error.name === "CastError" || error.name === "BSONError") {
      return handleError(res, error);
    }
    return handleError(res, error);
  }
};

const updateCoupon = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const coupon = await Coupon.findById(id);
    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
      });
    }

    if (updates.code !== undefined) {
      const codeValue = String(updates.code).trim().toUpperCase();
      if (!codeValue) {
        return res.status(400).json({ success: false, message: "Coupon code is required" });
      }
      updates.code = codeValue;
      const existingCoupon = await Coupon.findOne({ code: codeValue, _id: { $ne: id } });
      if (existingCoupon) {
        return res.status(400).json({
          success: false,
          message: "Coupon code already exists",
        });
      }
      coupon.code = codeValue;
    }

    if (updates.value !== undefined) {
      const numericValue = Number(updates.value);
      if (!Number.isFinite(numericValue) || numericValue < 0) {
        return res.status(400).json({ success: false, message: "Coupon value must be a valid non-negative number" });
      }
      updates.value = numericValue;
    }

    if (updates.type !== undefined && !["percent", "flat", "buy_x_get_y"].includes(updates.type)) {
      return res.status(400).json({ success: false, message: "Invalid coupon type" });
    }

    const fromDate = updates.validFrom !== undefined ? new Date(updates.validFrom) : new Date(coupon.validFrom);
    const untilDate = updates.validUntil !== undefined ? new Date(updates.validUntil) : new Date(coupon.validUntil);
    if (isNaN(fromDate.getTime()) || isNaN(untilDate.getTime())) {
      return res.status(400).json({ success: false, message: "Valid from and valid until must be valid dates" });
    }
    if (untilDate <= fromDate) {
      return res.status(400).json({ success: false, message: "Valid until must be after valid from" });
    }

    const allowedUpdates = [
      "name", "description", "type", "value", "maxDiscount", "minOrderAmount",
      "applicableOrderTypes", "applicableCategories", "applicableItems",
      "excludedCategories", "excludedItems", "usageLimit", "usageLimitPerCustomer",
      "validFrom", "validUntil", "isActive", "firstOrderOnly", "customerTags",
      "autoApply", "stackable"
    ];

    allowedUpdates.forEach(field => {
      if (updates[field] !== undefined) {
        if (["validFrom", "validUntil"].includes(field)) {
          coupon[field] = new Date(updates[field]);
        } else if (Array.isArray(updates[field])) {
          coupon[field] = updates[field];
        } else {
          coupon[field] = updates[field];
        }
      }
    });

    await coupon.save();

    return res.status(200).json({
      success: true,
      message: "Coupon updated successfully",
      coupon,
    });
  } catch (error) {
    console.log("UPDATE COUPON ERROR:", error);
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Coupon code already exists" });
    }
    if (error.name === "ValidationError") {
      return res.status(400).json(formatValidationError(error));
    }
    if (error.name === "CastError" || error.name === "BSONError") {
      return handleError(res, error);
    }
    return handleError(res, error);
  }
};

const deleteCoupon = async (req, res) => {
  try {
    const { id } = req.params;
    const coupon = await Coupon.findByIdAndDelete(id);

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Coupon deleted successfully",
    });
  } catch (error) {
    console.log("DELETE COUPON ERROR:", error);
    return handleError(res, error);
  }
};

const toggleCouponStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const coupon = await Coupon.findByIdAndUpdate(
      id,
      { isActive: isActive !== undefined ? isActive : true },
      { new: true }
    );

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: `Coupon ${coupon.isActive ? "activated" : "deactivated"}`,
      coupon,
    });
  } catch (error) {
    console.log("TOGGLE COUPON STATUS ERROR:", error);
    return handleError(res, error);
  }
};

module.exports = {
  getCoupons,
  getCouponById,
  validateCoupon,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  toggleCouponStatus,
};