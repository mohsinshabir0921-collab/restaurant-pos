const crypto = require("crypto");
const mongoose = require("mongoose");
const MenuItem = require("../models/MenuItem");
const Category = require("../models/Category");
const { handleError } = require("../utils/httpError");
const { parsePagination } = require("../utils/pagination");
const { getMenuImagesBucket } = require("../utils/gridfs");

const ALLOWED_MENU_IMAGE = {
  mimes: ["image/jpeg", "image/jpg", "image/png", "image/webp"],
  maxBytes: 5 * 1024 * 1024,
  maxLabel: "5 MB",
};

function publicBaseUrl(req) {
  const get = (header) => (typeof req?.get === "function" ? req.get(header) : req?.[header]);
  const proto = ((get("x-forwarded-proto") || "").split(",")[0] || "http").trim();
  const host = (get("host") || "").trim() || `localhost:${process.env.PORT || 5000}`;
  return `${proto}://${host}`.replace(/\/$/, "");
}

const getMenuItems = async (req, res) => {
  try {
    const { 
      category, 
      availableOnly = "true", 
      search = "", 
      page = 1, 
      limit = 50,
      sortBy = "displayOrder",
      sortOrder = "asc"
    } = req.query;

    const query = {};
    
    if (availableOnly === "true") {
      query.isAvailable = true;
    }
    
    if (category) {
      query.category = category;
    }
    
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [
        { name: regex },
        { description: regex },
        { tags: regex },
      ];
    }

    const { page: safePage, limit: safeLimit, skip } = parsePagination(req.query, 50);
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const [items, total] = await Promise.all([
      MenuItem.find(query)
        .populate("category", "name displayOrder")
        .sort(sort)
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      MenuItem.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      menuItems: items,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    });
  } catch (error) {
    console.log("GET MENU ITEMS ERROR:", error);
    return handleError(res, error);
  }
};

const getMenuItemsByCategory = async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true }).sort({ displayOrder: 1 }).lean();
    
    const menuItems = await MenuItem.find({ isAvailable: true })
      .populate("category", "name displayOrder")
      .sort({ "category.displayOrder": 1, displayOrder: 1, name: 1 })
      .lean();

    const grouped = {};
    menuItems.forEach(item => {
      const catName = item.category?.name || "Uncategorized";
      if (!grouped[catName]) {
        grouped[catName] = {
          category: item.category || { name: catName, _id: null },
          items: [],
        };
      }
      grouped[catName].items.push(item);
    });

    const result = categories
      .map(cat => grouped[cat.name] || { category: cat, items: [] })
      .filter(g => g.items.length > 0);

    return res.status(200).json({
      success: true,
      categories: result,
    });
  } catch (error) {
    console.log("GET MENU BY CATEGORY ERROR:", error);
    return handleError(res, error);
  }
};

const getMenuItemById = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await MenuItem.findById(id).populate("category", "name").lean();

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Menu item not found",
      });
    }

    return res.status(200).json({
      success: true,
      menuItem: item,
    });
  } catch (error) {
    console.log("GET MENU ITEM ERROR:", error);
    return handleError(res, error);
  }
};

const createMenuItem = async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      category,
      isVeg,
      spiceLevel,
      prepTime,
      isAvailable,
      taxRate,
      image,
      displayOrder,
      tags,
      modifiers,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Item name is required",
      });
    }

    const numericPrice = price === "" || price === undefined || price === null ? NaN : Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      return res.status(400).json({
        success: false,
        message: "Valid price is required",
      });
    }

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Category is required",
      });
    }

    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      return res.status(400).json({
        success: false,
        message: "Invalid category",
      });
    }

    const numericPrepTime = prepTime === "" ? NaN : Number(prepTime);
    const numericTaxRate = taxRate === "" ? NaN : Number(taxRate);
    const numericDisplayOrder = displayOrder === "" ? NaN : Number(displayOrder);
    if (prepTime !== undefined && !Number.isFinite(numericPrepTime)) {
      return res.status(400).json({ success: false, message: "Prep time must be a valid number" });
    }
    if (taxRate !== undefined && !Number.isFinite(numericTaxRate)) {
      return res.status(400).json({ success: false, message: "Tax rate must be a valid number" });
    }
    if (displayOrder !== undefined && !Number.isFinite(numericDisplayOrder)) {
      return res.status(400).json({ success: false, message: "Display order must be a valid number" });
    }

    const maxOrder = await MenuItem.findOne({ category }).sort({ displayOrder: -1 }).select("displayOrder").lean();
    const nextOrder = maxOrder ? maxOrder.displayOrder + 1 : 0;

    const item = await MenuItem.create({
      name: name.trim(),
      description: description?.trim() || "",
      price: numericPrice,
      category,
      isVeg: isVeg !== undefined ? isVeg : true,
      spiceLevel: spiceLevel || "none",
      prepTime: prepTime !== undefined ? numericPrepTime : 10,
      isAvailable: isAvailable !== undefined ? isAvailable : true,
      taxRate: taxRate !== undefined ? numericTaxRate : 0,
      image: image || "",
      displayOrder: displayOrder !== undefined ? numericDisplayOrder : nextOrder,
      tags: Array.isArray(tags) ? tags : [],
      modifiers: Array.isArray(modifiers) ? modifiers : [],
    });

    const populatedItem = await MenuItem.findById(item._id).populate("category", "name").lean();

    return res.status(201).json({
      success: true,
      message: "Menu item created successfully",
      menuItem: populatedItem,
    });
  } catch (error) {
    console.log("CREATE MENU ITEM ERROR:", error);
    if (error.name === "ValidationError") {
      return handleError(res, error);
    }
    if (error.name === "CastError" || error.name === "BSONError") {
      return handleError(res, error);
    }
    return handleError(res, error);
  }
};

const updateMenuItem = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      price,
      category,
      isVeg,
      spiceLevel,
      prepTime,
      isAvailable,
      taxRate,
      image,
      displayOrder,
      tags,
      modifiers,
    } = req.body;

    const item = await MenuItem.findById(id);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Menu item not found",
      });
    }

    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName) {
        return res.status(400).json({ success: false, message: "Item name is required" });
      }
      item.name = trimmedName;
    }
    if (description !== undefined) item.description = description.trim();
    if (price !== undefined) {
      const numericPrice = price === "" ? NaN : Number(price);
      if (!Number.isFinite(numericPrice) || numericPrice < 0) {
        return res.status(400).json({
          success: false,
          message: "Price must be a valid non-negative number",
        });
      }
      item.price = numericPrice;
    }
    if (category !== undefined) {
      if (!category) {
        return res.status(400).json({
          success: false,
          message: "Category is required",
        });
      }
      const categoryExists = await Category.findById(category);
      if (!categoryExists) {
        return res.status(400).json({
          success: false,
          message: "Invalid category",
        });
      }
      item.category = category;
    }
    if (isVeg !== undefined) item.isVeg = isVeg;
    if (spiceLevel) item.spiceLevel = spiceLevel;
    if (prepTime !== undefined) {
      const numericPrepTime = prepTime === "" ? NaN : Number(prepTime);
      if (!Number.isFinite(numericPrepTime)) {
        return res.status(400).json({ success: false, message: "Prep time must be a valid number" });
      }
      item.prepTime = numericPrepTime;
    }
    if (isAvailable !== undefined) item.isAvailable = isAvailable;
    if (taxRate !== undefined) {
      const numericTaxRate = taxRate === "" ? NaN : Number(taxRate);
      if (!Number.isFinite(numericTaxRate)) {
        return res.status(400).json({ success: false, message: "Tax rate must be a valid number" });
      }
      item.taxRate = numericTaxRate;
    }
    if (image !== undefined) item.image = image;
    if (displayOrder !== undefined) {
      const numericDisplayOrder = displayOrder === "" ? NaN : Number(displayOrder);
      if (!Number.isFinite(numericDisplayOrder)) {
        return res.status(400).json({ success: false, message: "Display order must be a valid number" });
      }
      item.displayOrder = numericDisplayOrder;
    }
    if (tags !== undefined) item.tags = Array.isArray(tags) ? tags : [];
    if (modifiers !== undefined) item.modifiers = Array.isArray(modifiers) ? modifiers : [];

    await item.save();

    const populatedItem = await MenuItem.findById(item._id).populate("category", "name").lean();

    return res.status(200).json({
      success: true,
      message: "Menu item updated successfully",
      menuItem: populatedItem,
    });
  } catch (error) {
    console.log("UPDATE MENU ITEM ERROR:", error);
    if (error.name === "ValidationError") {
      return handleError(res, error);
    }
    if (error.name === "CastError" || error.name === "BSONError") {
      return handleError(res, error);
    }
    return handleError(res, error);
  }
};

const deleteMenuItem = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await MenuItem.findByIdAndDelete(id);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Menu item not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Menu item deleted successfully",
    });
  } catch (error) {
    console.log("DELETE MENU ITEM ERROR:", error);
    return handleError(res, error);
  }
};

const toggleAvailability = async (req, res) => {
  try {
    const { id } = req.params;
    const { isAvailable } = req.body;

    const item = await MenuItem.findByIdAndUpdate(
      id,
      { isAvailable: isAvailable !== undefined ? isAvailable : true },
      { new: true }
    ).populate("category", "name").lean();

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Menu item not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: `Menu item ${item.isAvailable ? "enabled" : "disabled"}`,
      menuItem: item,
    });
  } catch (error) {
    console.log("TOGGLE AVAILABILITY ERROR:", error);
    return handleError(res, error);
  }
};

const reorderMenuItems = async (req, res) => {
  try {
    const { itemOrders } = req.body;

    if (!Array.isArray(itemOrders) || itemOrders.length === 0) {
      return res.status(400).json({
        success: false,
        message: "itemOrders array is required",
      });
    }

    const bulkOps = itemOrders.map((item, index) => ({
      updateOne: {
        filter: { _id: item.id },
        update: { displayOrder: item.order !== undefined ? item.order : index },
      },
    }));

    await MenuItem.bulkWrite(bulkOps);

    return res.status(200).json({
      success: true,
      message: "Menu items reordered successfully",
    });
  } catch (error) {
    console.log("REORDER MENU ITEMS ERROR:", error);
    return handleError(res, error);
  }
};

const uploadMenuImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file provided" });
    }
    const mime = req.file.mimetype;
    const normalizedMime = mime === "image/jpg" ? "image/jpeg" : mime;
    if (!ALLOWED_MENU_IMAGE.mimes.includes(mime) && !ALLOWED_MENU_IMAGE.mimes.includes(normalizedMime)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported file type. Allowed: JPG, JPEG, PNG, WEBP`,
      });
    }
    if (req.file.size > ALLOWED_MENU_IMAGE.maxBytes) {
      return res.status(400).json({
        success: false,
        message: `File too large (max ${ALLOWED_MENU_IMAGE.maxLabel})`,
      });
    }
    const extMap = {
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    };
    const ext = extMap[normalizedMime] || (req.file.originalname.split(".").pop() || "jpg").toLowerCase();
    const filename = `menu-${crypto.randomUUID()}.${ext}`;
    const bucket = getMenuImagesBucket();
    const uploadStream = bucket.openUploadStream(filename, {
      contentType: normalizedMime,
      metadata: { originalName: req.file.originalname },
    });
    await new Promise((resolve, reject) => {
      uploadStream.on("error", reject);
      uploadStream.on("finish", resolve);
      uploadStream.end(req.file.buffer);
    });
    const fileId = uploadStream.id;
    const base = publicBaseUrl(req);
    const url = `${base}/api/menu/images/${fileId}`;
    // Also accept relative URL stored as /api/menu/images/<id> for compatibility;
    // frontend will handle both absolute and relative.
    return res.status(200).json({ success: true, url });
  } catch (error) {
    console.log("UPLOAD MENU IMAGE ERROR:", error);
    return handleError(res, error, "Upload failed");
  }
};

const getMenuImage = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, message: "Image not found" });
    }
    const bucket = getMenuImagesBucket();
    const fileId = new mongoose.Types.ObjectId(id);
    const files = await bucket.find({ _id: fileId }).toArray();
    if (!files || files.length === 0) {
      return res.status(404).json({ success: false, message: "Image not found" });
    }
    const file = files[0];
    res.set("Content-Type", file.contentType || "application/octet-stream");
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    const downloadStream = bucket.openDownloadStream(fileId);
    downloadStream.on("error", () => {
      if (!res.headersSent) {
        return res.status(404).json({ success: false, message: "Image not found" });
      }
      res.end();
    });
    return downloadStream.pipe(res);
  } catch (error) {
    console.log("GET MENU IMAGE ERROR:", error);
    if (!res.headersSent) {
      return res.status(404).json({ success: false, message: "Image not found" });
    }
    return res.end();
  }
};

module.exports = {
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
};