const WasteLog = require("../models/WasteLog");
const InventoryItem = require("../models/InventoryItem");
const { handleError } = require("../utils/httpError");
const { parsePagination } = require("../utils/pagination");

const getWasteLogs = async (req, res) => {
  try {
    const { page = 1, limit = 20, reason, startDate, endDate, isApproved } = req.query;
    const query = {};

    if (reason) query.reason = reason;
    if (isApproved !== undefined) query.isApproved = isApproved === "true";
    if (startDate || endDate) {
      query.wasteDate = {};
      if (startDate) query.wasteDate.$gte = new Date(startDate);
      if (endDate) query.wasteDate.$lte = new Date(endDate);
    }

    const { page: safePage, limit: safeLimit, skip } = parsePagination(req.query, 20);
    const [logs, total] = await Promise.all([
      WasteLog.find(query).populate("reportedBy", "name").populate("approvedBy", "name").populate("items.item", "name unit").sort({ wasteDate: -1 }).skip(skip).limit(safeLimit).lean(),
      WasteLog.countDocuments(query),
    ]);

    return res.status(200).json({ success: true, logs, pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) } });
  } catch (error) {
    console.log("GET WASTE LOGS ERROR:", error);
    return handleError(res, error);
  }
};

const getWasteLogById = async (req, res) => {
  try {
    const { id } = req.params;
    const log = await WasteLog.findById(id).populate("reportedBy", "name").populate("approvedBy", "name").populate("items.item", "name unit costPerUnit").lean();
    if (!log) return res.status(404).json({ success: false, message: "Waste log not found" });
    return res.status(200).json({ success: true, log });
  } catch (error) {
    console.log("GET WASTE LOG ERROR:", error);
    return handleError(res, error);
  }
};

const createWasteLog = async (req, res) => {
  try {
    const { items, reason, reasonDetail, location, notes } = req.body;

    if (!items || !items.length) return res.status(400).json({ success: false, message: "At least one item is required" });
    if (!reason) return res.status(400).json({ success: false, message: "Reason is required" });

    for (const item of items) {
      const inventoryItem = await InventoryItem.findById(item.item);
      if (!inventoryItem) return res.status(400).json({ success: false, message: `Inventory item ${item.item} not found` });
      item.unit = inventoryItem.unit;
      item.unitCost = inventoryItem.costPerUnit;
      item.totalCost = item.quantity * inventoryItem.costPerUnit;
    }

    const wasteLog = await WasteLog.create({
      items,
      reason,
      reasonDetail: reasonDetail?.trim(),
      location: location?.trim(),
      notes: notes?.trim(),
      reportedBy: req.user._id,
    });

    const populatedLog = await WasteLog.findById(wasteLog._id).populate("reportedBy", "name").populate("items.item", "name unit").lean();
    return res.status(201).json({ success: true, message: "Waste log created", log: populatedLog });
  } catch (error) {
    console.log("CREATE WASTE LOG ERROR:", error);
    if (error.code === 11000) return res.status(400).json({ success: false, message: "Waste log number already exists" });
    return handleError(res, error);
  }
};

const updateWasteLog = async (req, res) => {
  try {
    const { id } = req.params;
    const { items, reason, reasonDetail, location, notes } = req.body;

    const wasteLog = await WasteLog.findById(id);
    if (!wasteLog) return res.status(404).json({ success: false, message: "Waste log not found" });
    if (wasteLog.isApproved) return res.status(400).json({ success: false, message: "Cannot modify approved waste log" });

    if (items) {
      for (const item of items) {
        const inventoryItem = await InventoryItem.findById(item.item);
        if (!inventoryItem) return res.status(400).json({ success: false, message: `Inventory item ${item.item} not found` });
        item.unit = inventoryItem.unit;
        item.unitCost = inventoryItem.costPerUnit;
        item.totalCost = item.quantity * inventoryItem.costPerUnit;
      }
      wasteLog.items = items;
    }

    if (reason) wasteLog.reason = reason;
    if (reasonDetail !== undefined) wasteLog.reasonDetail = reasonDetail?.trim();
    if (location !== undefined) wasteLog.location = location?.trim();
    if (notes !== undefined) wasteLog.notes = notes?.trim();

    await wasteLog.save();
    const populatedLog = await WasteLog.findById(wasteLog._id).populate("reportedBy", "name").populate("items.item", "name unit").lean();
    return res.status(200).json({ success: true, message: "Waste log updated", log: populatedLog });
  } catch (error) {
    console.log("UPDATE WASTE LOG ERROR:", error);
    if (error.code === 11000) return res.status(400).json({ success: false, message: "Waste log number already exists" });
    return handleError(res, error);
  }
};

const approveWasteLog = async (req, res) => {
  try {
    const { id } = req.params;
    const wasteLog = await WasteLog.findById(id);
    if (!wasteLog) return res.status(404).json({ success: false, message: "Waste log not found" });
    if (wasteLog.isApproved) return res.status(400).json({ success: false, message: "Already approved" });

    await wasteLog.processWaste(req.user._id);

    const populatedLog = await WasteLog.findById(wasteLog._id).populate("reportedBy", "name").populate("approvedBy", "name").populate("items.item", "name unit").lean();
    return res.status(200).json({ success: true, message: "Waste log approved and stock deducted", log: populatedLog });
  } catch (error) {
    console.log("APPROVE WASTE LOG ERROR:", error);
    return handleError(res, error);
  }
};

const deleteWasteLog = async (req, res) => {
  try {
    const { id } = req.params;
    const wasteLog = await WasteLog.findById(id);
    if (!wasteLog) return res.status(404).json({ success: false, message: "Waste log not found" });
    if (wasteLog.isApproved) return res.status(400).json({ success: false, message: "Cannot delete approved waste log" });

    await WasteLog.findByIdAndDelete(id);
    return res.status(200).json({ success: true, message: "Waste log deleted" });
  } catch (error) {
    console.log("DELETE WASTE LOG ERROR:", error);
    return handleError(res, error);
  }
};

const getWasteSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const query = {};
    if (startDate || endDate) {
      query.wasteDate = {};
      if (startDate) query.wasteDate.$gte = new Date(startDate);
      if (endDate) query.wasteDate.$lte = new Date(endDate);
    }

    const summary = await WasteLog.aggregate([
      { $match: query },
      { $group: { _id: "$reason", count: { $sum: 1 }, totalCost: { $sum: "$totalCost" }, totalQuantity: { $sum: "$totalQuantity" } } },
      { $sort: { totalCost: -1 } },
    ]);

    const dailyTrend = await WasteLog.aggregate([
      { $match: query },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$wasteDate" } }, totalCost: { $sum: "$totalCost" }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    return res.status(200).json({ success: true, summary, dailyTrend });
  } catch (error) {
    console.log("WASTE SUMMARY ERROR:", error);
    return handleError(res, error);
  }
};

module.exports = {
  getWasteLogs,
  getWasteLogById,
  createWasteLog,
  updateWasteLog,
  approveWasteLog,
  deleteWasteLog,
  getWasteSummary,
};