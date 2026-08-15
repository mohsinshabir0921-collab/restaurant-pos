const InventoryItem = require("../models/InventoryItem");
const StockMovement = require("../models/StockMovement");
const Recipe = require("../models/Recipe");
const { handleError } = require("../utils/httpError");
const { parsePagination } = require("../utils/pagination");

const toNumber = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

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

const getInventoryItems = async (req, res) => {
  try {
    const { page = 1, limit = 50, search = "", category, lowStock, outOfStock, isActive } = req.query;
    const query = {};

    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ name: regex }, { sku: regex }];
    }
    if (category) query.category = category;
    if (isActive !== undefined) query.isActive = isActive === "true";

    const { page: safePage, limit: safeLimit, skip } = parsePagination(req.query, 50);
    const [items, total] = await Promise.all([
      InventoryItem.find(query).sort({ category: 1, name: 1 }).skip(skip).limit(safeLimit).lean(),
      InventoryItem.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      items,
      pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) },
    });
  } catch (error) {
    console.log("GET INVENTORY ERROR:", error);
    return handleError(res, error);
  }
};

const getLowStockItems = async (req, res) => {
  try {
    const items = await InventoryItem.getLowStockItems();
    return res.status(200).json({ success: true, items });
  } catch (error) {
    console.log("GET LOW STOCK ERROR:", error);
    return handleError(res, error);
  }
};

const getOutOfStockItems = async (req, res) => {
  try {
    const items = await InventoryItem.getOutOfStockItems();
    return res.status(200).json({ success: true, items });
  } catch (error) {
    console.log("GET OUT OF STOCK ERROR:", error);
    return handleError(res, error);
  }
};

const getInventoryItemById = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await InventoryItem.findById(id).lean();
    if (!item) return res.status(404).json({ success: false, message: "Item not found" });

    const movements = await StockMovement.getByItem(id, 20);
    const recipes = await Recipe.find({ "ingredients.item": id }).populate("menuItem", "name").lean();

    return res.status(200).json({ success: true, item, movements, recipes });
  } catch (error) {
    console.log("GET INVENTORY ITEM ERROR:", error);
    return handleError(res, error);
  }
};

const createInventoryItem = async (req, res) => {
  try {
    const { name, sku, unit, category, currentStock, minStock, maxStock, reorderLevel, costPerUnit, sellingPrice, supplier, storageLocation, expiryTracking, batchTracking, isActive, notes } = req.body;

    if (!name || !unit || !category) {
      return res.status(400).json({ success: false, message: "Name, unit, and category are required" });
    }

    const trimmedSku = typeof sku === "string" ? sku.trim() : sku;

    const item = await InventoryItem.create({
      name: name.trim(),
      sku: trimmedSku || undefined,
      unit,
      category,
      currentStock: toNumber(currentStock, 0),
      minStock: toNumber(minStock, 10),
      maxStock: toNumber(maxStock, 1000),
      reorderLevel: toNumber(reorderLevel, 20),
      costPerUnit: toNumber(costPerUnit, 0),
      sellingPrice: toNumber(sellingPrice, 0),
      supplier,
      storageLocation: storageLocation?.trim(),
      expiryTracking: expiryTracking || false,
      batchTracking: batchTracking || false,
      isActive: isActive !== undefined ? isActive : true,
      notes: notes?.trim(),
    });

    if (item.currentStock > 0) {
      const StockMovement = require("../models/StockMovement");
      await StockMovement.create({
        item: item._id,
        type: "in",
        quantity: item.currentStock,
        previousStock: 0,
        newStock: item.currentStock,
        unitCost: item.costPerUnit,
        totalCost: item.costPerUnit * item.currentStock,
        reason: "Opening stock",
        referenceType: "opening_stock",
        createdBy: req.user._id,
      });
    }

    return res.status(201).json({ success: true, message: "Inventory item created", item });
  } catch (error) {
    console.log("CREATE INVENTORY ERROR:", error);
    if (error.code === 11000) return res.status(400).json({ success: false, message: "SKU already exists" });
    if (error.name === "ValidationError") return res.status(400).json(formatValidationError(error));
    return handleError(res, error);
  }
};

const updateInventoryItem = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const item = await InventoryItem.findById(id);
    if (!item) return res.status(404).json({ success: false, message: "Item not found" });

    Object.keys(updates).forEach(key => {
      if (updates[key] === undefined || key === "_id" || key === "currentStock") return;
      if (key === "sku") {
        item.sku = typeof updates.sku === "string" && updates.sku.trim() ? updates.sku.trim() : null;
        return;
      }
      item[key] = updates[key];
    });

    await item.save();
    return res.status(200).json({ success: true, message: "Item updated", item });
  } catch (error) {
    console.log("UPDATE INVENTORY ERROR:", error);
    if (error.code === 11000) return res.status(400).json({ success: false, message: "SKU already exists" });
    if (error.name === "ValidationError") return res.status(400).json(formatValidationError(error));
    return handleError(res, error);
  }
};

const adjustStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, reason, referenceId, referenceType } = req.body;

    if (quantity === undefined || quantity === 0) {
      return res.status(400).json({ success: false, message: "Quantity is required" });
    }
    if (!reason) {
      return res.status(400).json({ success: false, message: "Reason is required" });
    }

    const item = await InventoryItem.findById(id);
    if (!item) return res.status(404).json({ success: false, message: "Item not found" });

    const movement = await item.adjustStock(Number(quantity), reason, referenceId, referenceType, req.user._id);
    await StockMovement.create({ ...movement, createdBy: req.user._id });

    return res.status(200).json({ success: true, message: "Stock adjusted", item, movement });
  } catch (error) {
    console.log("ADJUST STOCK ERROR:", error);
    return handleError(res, error);
  }
};

const deleteInventoryItem = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await InventoryItem.findByIdAndDelete(id);
    if (!item) return res.status(404).json({ success: false, message: "Item not found" });
    return res.status(200).json({ success: true, message: "Item deleted" });
  } catch (error) {
    console.log("DELETE INVENTORY ERROR:", error);
    return handleError(res, error);
  }
};

const getStockMovements = async (req, res) => {
  try {
    const { itemId, startDate, endDate, type, page = 1, limit = 50 } = req.query;
    const query = {};

    if (itemId) query.item = itemId;
    if (type) query.type = type;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const { page: safePage, limit: safeLimit, skip } = parsePagination(req.query, 50);
    const [movements, total] = await Promise.all([
      StockMovement.find(query).populate("item", "name unit").populate("createdBy", "name").sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
      StockMovement.countDocuments(query),
    ]);

    return res.status(200).json({ success: true, movements, pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) } });
  } catch (error) {
    console.log("GET STOCK MOVEMENTS ERROR:", error);
    return handleError(res, error);
  }
};

const getStockSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const summary = await StockMovement.getDailySummary(startDate ? new Date(startDate) : new Date());
    const lowStock = await InventoryItem.getLowStockItems();
    const outOfStock = await InventoryItem.getOutOfStockItems();
    const totalValue = await InventoryItem.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: null, totalValue: { $sum: { $multiply: ["$currentStock", "$costPerUnit"] } }, totalItems: { $sum: 1 } } },
    ]);

    return res.status(200).json({
      success: true,
      dailySummary: summary,
      lowStockCount: lowStock.length,
      outOfStockCount: outOfStock.length,
      totalStockValue: totalValue[0]?.totalValue || 0,
      totalItems: totalValue[0]?.totalItems || 0,
    });
  } catch (error) {
    console.log("GET STOCK SUMMARY ERROR:", error);
    return handleError(res, error);
  }
};

module.exports = {
  getInventoryItems,
  getLowStockItems,
  getOutOfStockItems,
  getInventoryItemById,
  createInventoryItem,
  updateInventoryItem,
  adjustStock,
  deleteInventoryItem,
  getStockMovements,
  getStockSummary,
};