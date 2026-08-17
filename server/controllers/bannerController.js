const Banner = require("../models/Banner");
const { handleError } = require("../utils/httpError");

// Shape the public response explicitly so no internal fields (isActive,
// startDate, endDate, timestamps, __v, ...) ever leak to the website.
const PUBLIC_BANNER_FIELDS = ["_id", "title", "description", "couponCode", "ctaText", "ctaLink", "sortOrder"];

const toPublicBanner = (banner) => {
  const publicBanner = {};
  for (const field of PUBLIC_BANNER_FIELDS) {
    publicBanner[field] = banner[field];
  }
  return publicBanner;
};

const getAll = async (req, res) => {
  try {
    const banners = await Banner.find().sort({ sortOrder: 1, createdAt: -1 }).lean();
    return res.status(200).json({ success: true, banners });
  } catch (error) {
    return handleError(res, error);
  }
};

const getPublicActive = async (req, res) => {
  try {
    // The server decides which banners are live. Expired, not-yet-started and
    // deactivated banners are excluded here, never by the client.
    const banners = await Banner.findActive();
    return res.status(200).json({
      success: true,
      banners: banners.map(toPublicBanner),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const parseDates = (startDate, endDate) => {
  const fromDate = startDate ? new Date(startDate) : null;
  const untilDate = endDate ? new Date(endDate) : null;
  if (!fromDate || isNaN(fromDate.getTime()) || !untilDate || isNaN(untilDate.getTime())) {
    return { error: "Valid start and end dates are required" };
  }
  if (untilDate <= fromDate) {
    return { error: "End date must be after start date" };
  }
  return { fromDate, untilDate };
};

const create = async (req, res) => {
  try {
    const {
      title,
      description,
      couponCode,
      ctaText,
      ctaLink,
      startDate,
      endDate,
      isActive,
      sortOrder,
    } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ success: false, message: "Banner title is required" });
    }

    const dates = parseDates(startDate, endDate);
    if (dates.error) {
      return res.status(400).json({ success: false, message: dates.error });
    }

    const banner = await Banner.create({
      title: String(title).trim(),
      description: String(description || "").trim(),
      couponCode: String(couponCode || "").trim().toUpperCase(),
      ctaText: String(ctaText || "").trim(),
      ctaLink: String(ctaLink || "").trim(),
      startDate: dates.fromDate,
      endDate: dates.untilDate,
      isActive: isActive !== undefined ? isActive : true,
      sortOrder: sortOrder !== undefined ? Number(sortOrder) || 0 : 0,
    });

    return res.status(201).json({
      success: true,
      message: "Banner created successfully",
      banner,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors || {})
        .map((e) => e.message)
        .join("; ");
      return res.status(400).json({
        success: false,
        message: messages ? `Validation failed: ${messages}` : "Validation failed",
      });
    }
    return handleError(res, error);
  }
};

const update = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const banner = await Banner.findById(id);
    if (!banner) {
      return res.status(404).json({ success: false, message: "Banner not found" });
    }

    if (updates.title !== undefined && !String(updates.title).trim()) {
      return res.status(400).json({ success: false, message: "Banner title is required" });
    }

    const fromDate = updates.startDate !== undefined ? new Date(updates.startDate) : new Date(banner.startDate);
    const untilDate = updates.endDate !== undefined ? new Date(updates.endDate) : new Date(banner.endDate);
    if (isNaN(fromDate.getTime()) || isNaN(untilDate.getTime())) {
      return res.status(400).json({ success: false, message: "Valid start and end dates are required" });
    }
    if (untilDate <= fromDate) {
      return res.status(400).json({ success: false, message: "End date must be after start date" });
    }

    const allowedUpdates = [
      "title",
      "description",
      "couponCode",
      "ctaText",
      "ctaLink",
      "startDate",
      "endDate",
      "isActive",
      "sortOrder",
    ];

    allowedUpdates.forEach((field) => {
      if (updates[field] === undefined) return;
      if (field === "startDate" || field === "endDate") {
        banner[field] = new Date(updates[field]);
      } else if (field === "title") {
        banner[field] = String(updates[field]).trim();
      } else if (field === "couponCode") {
        banner[field] = String(updates[field] || "").trim().toUpperCase();
      } else if (typeof updates[field] === "string") {
        banner[field] = String(updates[field]).trim();
      } else {
        banner[field] = updates[field];
      }
    });

    await banner.save();

    return res.status(200).json({
      success: true,
      message: "Banner updated successfully",
      banner,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors || {})
        .map((e) => e.message)
        .join("; ");
      return res.status(400).json({
        success: false,
        message: messages ? `Validation failed: ${messages}` : "Validation failed",
      });
    }
    return handleError(res, error);
  }
};

const toggle = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const banner = await Banner.findByIdAndUpdate(
      id,
      { isActive: isActive !== undefined ? isActive : true },
      { new: true }
    );

    if (!banner) {
      return res.status(404).json({
        success: false,
        message: "Banner not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: `Banner ${banner.isActive ? "activated" : "deactivated"}`,
      banner,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const deleteBanner = async (req, res) => {
  try {
    const { id } = req.params;
    const banner = await Banner.findByIdAndDelete(id);

    if (!banner) {
      return res.status(404).json({
        success: false,
        message: "Banner not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Banner deleted successfully",
    });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
  getAll,
  getPublicActive,
  create,
  update,
  toggle,
  deleteBanner,
  toPublicBanner,
};