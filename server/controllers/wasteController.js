const WasteLog = require("../models/WasteLog");
const InventoryItem = require("../models/InventoryItem");
const StockMovement = require("../models/StockMovement");
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

const performWasteDeletionTx = async (wasteLog, userId, session) => {
  const q = (query) => (session && query && typeof query.session === "function" ? query.session(session) : query);
  const doCreate = async (Model, doc) => {
    if (session) {
      const res = await Model.create([doc], { session });
      return res[0];
    }
    return Model.create(doc);
  };
  if (!wasteLog.isApproved) {
    await q(StockMovement.deleteMany({ referenceId: wasteLog._id, referenceType: "waste_log" }));
    await q(WasteLog.deleteOne({ _id: wasteLog._id }));
    return;
  }
  for (const wasteItem of wasteLog.items || []) {
    const inventoryItem = await q(InventoryItem.findById(wasteItem.item));
    if (!inventoryItem) continue;
    const qty = Number(wasteItem.quantity) || 0;
    if (qty <= 0) continue;
    const previousStock = inventoryItem.currentStock;
    inventoryItem.currentStock = inventoryItem.currentStock + qty;
    await inventoryItem.save(session ? { session } : undefined);
    const movement = {
      item: inventoryItem._id,
      type: "in",
      quantity: qty,
      previousStock,
      newStock: inventoryItem.currentStock,
      reason: `Waste ${wasteLog.wasteNumber} deletion reversal`,
      referenceId: wasteLog._id,
      referenceType: "waste_log",
    };
    await doCreate(StockMovement, { ...movement, createdBy: userId });
  }
  await q(StockMovement.deleteMany({ referenceId: wasteLog._id, referenceType: "waste_log" }));
  await q(WasteLog.deleteOne({ _id: wasteLog._id }));
};

const performWasteDeletion = async (wasteLog, userId) => {
  const { withTransaction } = require("../utils/transaction");
  return withTransaction(async (session) => performWasteDeletionTx(wasteLog, userId, session));
};

const deleteWasteLog = async (req, res) => {
  try {
    const { id } = req.params;
    const wasteLog = await WasteLog.findById(id);
    if (!wasteLog) return res.status(404).json({ success: false, message: "Waste log not found" });
    await performWasteDeletion(wasteLog, req.user._id);
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

// Bulk-delete waste logs using same business rules as single delete.
// Un-approved: straightforward. Approved: inventory reversal then delete.
const bulkDeleteWasteLogs = async (req, res) => {
  try {
    const { parseIds } = require("../utils/bulkDelete");
    let ids;
    try {
      ids = parseIds(req.body?.ids);
    } catch (err) {
      return res.status(err.status || 400).json({ success: false, message: err.message });
    }
    const logs = await WasteLog.find({ _id: { $in: ids } });
    const foundMap = new Map(logs.map((l) => [String(l._id), l]));
    const blocked = [];
    const missing = [];
    let deletedCount = 0;
    for (const rawId of ids) {
      const str = String(rawId);
      const log = foundMap.get(str);
      if (!log) { missing.push(str); continue; }
      try {
        await performWasteDeletion(log, req.user._id);
        deletedCount += 1;
      } catch (e) {
        blocked.push({ id: str, wasteNumber: log.wasteNumber, reason: e.message });
      }
    }
    return res.status(200).json({
      success: true,
      message: `${deletedCount} waste log${deletedCount === 1 ? "" : "s"} deleted.`,
      deletedCount,
      blocked,
      missing,
    });
  } catch (error) {
    console.log("BULK DELETE WASTE ERROR:", error);
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
  bulkDeleteWasteLogs,
};