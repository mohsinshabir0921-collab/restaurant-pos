const PurchaseOrder = require("../models/PurchaseOrder");
const InventoryItem = require("../models/InventoryItem");
const StockMovement = require("../models/StockMovement");
const { handleError } = require("../utils/httpError");
const { parsePagination } = require("../utils/pagination");

const getPurchaseOrders = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, supplier, startDate, endDate } = req.query;
    const query = {};

    if (status) query.status = status;
    if (supplier) query["supplier.name"] = new RegExp(supplier, "i");
    if (startDate || endDate) {
      query.orderDate = {};
      if (startDate) query.orderDate.$gte = new Date(startDate);
      if (endDate) query.orderDate.$lte = new Date(endDate);
    }

    const { page: safePage, limit: safeLimit, skip } = parsePagination(req.query, 20);
    const [orders, total] = await Promise.all([
      PurchaseOrder.find(query).populate("createdBy", "name").populate("receivedBy", "name").sort({ orderDate: -1 }).skip(skip).limit(safeLimit).lean(),
      PurchaseOrder.countDocuments(query),
    ]);

    return res.status(200).json({ success: true, orders, pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) } });
  } catch (error) {
    console.log("GET POs ERROR:", error);
    return handleError(res, error);
  }
};

const getPurchaseOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    const po = await PurchaseOrder.findById(id).populate("createdBy", "name").populate("receivedBy", "name").populate("approvedBy", "name").populate("items.item", "name unit currentStock").lean();
    if (!po) return res.status(404).json({ success: false, message: "PO not found" });
    return res.status(200).json({ success: true, po });
  } catch (error) {
    console.log("GET PO ERROR:", error);
    return handleError(res, error);
  }
};

const createPurchaseOrder = async (req, res) => {
  try {
    const { supplier, items, expectedDate, paymentTerms, tax, shipping, discount, notes, internalNotes } = req.body;

    if (!supplier || !supplier.name) return res.status(400).json({ success: false, message: "Supplier name is required" });
    if (!items || !items.length) return res.status(400).json({ success: false, message: "At least one item is required" });

    for (const item of items) {
      const inventoryItem = await InventoryItem.findById(item.item);
      if (!inventoryItem) return res.status(400).json({ success: false, message: `Inventory item ${item.item} not found` });
      item.unit = inventoryItem.unit;
      item.totalCost = item.orderedQty * item.costPerUnit;
    }

    const po = await PurchaseOrder.create({
      supplier,
      items,
      expectedDate: expectedDate ? new Date(expectedDate) : null,
      paymentTerms: paymentTerms || "net_30",
      tax: Number(tax) || 0,
      shipping: Number(shipping) || 0,
      discount: Number(discount) || 0,
      notes: notes?.trim(),
      internalNotes: internalNotes?.trim(),
      createdBy: req.user._id,
    });

    const populatedPO = await PurchaseOrder.findById(po._id).populate("createdBy", "name").populate("items.item", "name unit").lean();
    return res.status(201).json({ success: true, message: "PO created", po: populatedPO });
  } catch (error) {
    console.log("CREATE PO ERROR:", error);
    if (error.code === 11000) return res.status(400).json({ success: false, message: "Purchase order number already exists" });
    return handleError(res, error);
  }
};

const updatePurchaseOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { supplier, items, expectedDate, paymentTerms, tax, shipping, discount, notes, internalNotes, status } = req.body;

    const po = await PurchaseOrder.findById(id);
    if (!po) return res.status(404).json({ success: false, message: "PO not found" });

    if (["received", "cancelled"].includes(po.status)) {
      return res.status(400).json({ success: false, message: "Cannot modify completed or cancelled PO" });
    }

    if (supplier) po.supplier = supplier;
    if (items) {
      for (const item of items) {
        const inventoryItem = await InventoryItem.findById(item.item);
        if (!inventoryItem) return res.status(400).json({ success: false, message: `Inventory item ${item.item} not found` });
        item.unit = inventoryItem.unit;
        item.totalCost = item.orderedQty * item.costPerUnit;
      }
      po.items = items;
    }
    if (expectedDate !== undefined) po.expectedDate = expectedDate ? new Date(expectedDate) : null;
    if (paymentTerms) po.paymentTerms = paymentTerms;
    if (tax !== undefined) po.tax = Number(tax);
    if (shipping !== undefined) po.shipping = Number(shipping);
    if (discount !== undefined) po.discount = Number(discount);
    if (notes !== undefined) po.notes = notes?.trim();
    if (internalNotes !== undefined) po.internalNotes = internalNotes?.trim();
    if (status) po.status = status;

    await po.save();
    const populatedPO = await PurchaseOrder.findById(po._id).populate("createdBy", "name").populate("items.item", "name unit").lean();
    return res.status(200).json({ success: true, message: "PO updated", po: populatedPO });
  } catch (error) {
    console.log("UPDATE PO ERROR:", error);
    if (error.code === 11000) return res.status(400).json({ success: false, message: "Purchase order number already exists" });
    return handleError(res, error);
  }
};

const sendPurchaseOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const po = await PurchaseOrder.findById(id);
    if (!po) return res.status(404).json({ success: false, message: "PO not found" });

    if (po.status !== "draft") return res.status(400).json({ success: false, message: "Only draft POs can be sent" });

    po.status = "sent";
    await po.save();

    return res.status(200).json({ success: true, message: "PO sent to supplier", po });
  } catch (error) {
    console.log("SEND PO ERROR:", error);
    return handleError(res, error);
  }
};

const receivePurchaseOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { items } = req.body;

    if (!items || !items.length) return res.status(400).json({ success: false, message: "Received items required" });

    const po = await PurchaseOrder.findById(id);
    if (!po) return res.status(404).json({ success: false, message: "PO not found" });

    await po.receiveItems(items, req.user._id);

    const populatedPO = await PurchaseOrder.findById(po._id).populate("createdBy", "name").populate("receivedBy", "name").populate("items.item", "name unit currentStock").lean();
    return res.status(200).json({ success: true, message: "Items received", po: populatedPO });
  } catch (error) {
    console.log("RECEIVE PO ERROR:", error);
    return handleError(res, error);
  }
};

const cancelPurchaseOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const po = await PurchaseOrder.findById(id);
    if (!po) return res.status(404).json({ success: false, message: "PO not found" });

    if (po.status === "received") return res.status(400).json({ success: false, message: "Cannot cancel received PO" });

    po.status = "cancelled";
    po.internalNotes = (po.internalNotes || "") + `\nCancelled: ${reason}`;
    await po.save();

    return res.status(200).json({ success: true, message: "PO cancelled", po });
  } catch (error) {
    console.log("CANCEL PO ERROR:", error);
    return handleError(res, error);
  }
};

const performPODeletionTx = async (po, userId, session) => {
  const q = (query) => (session && query && typeof query.session === "function" ? query.session(session) : query);
  const doCreate = async (Model, doc) => {
    if (session) {
      const res = await Model.create([doc], { session });
      return res[0];
    }
    return Model.create(doc);
  };
  if (po.status === "draft" || po.status === "cancelled") {
    await q(StockMovement.deleteMany({ referenceId: po._id, referenceType: "purchase_order" }));
    await q(PurchaseOrder.deleteOne({ _id: po._id }));
    return;
  }
  if (po.status === "received" || po.status === "partially_received") {
    const hasReceived = po.items.some((i) => (Number(i.receivedQty) || 0) > 0);
    if (!hasReceived) {
      await q(StockMovement.deleteMany({ referenceId: po._id, referenceType: "purchase_order" }));
      await q(PurchaseOrder.deleteOne({ _id: po._id }));
      return;
    }
    for (const poItem of po.items) {
      const qty = Number(poItem.receivedQty) || 0;
      if (qty <= 0) continue;
      const inventoryItem = await q(InventoryItem.findById(poItem.item));
      if (!inventoryItem) continue;
      if (inventoryItem.currentStock < qty) {
        const err = new Error(`Cannot delete PO ${po.poNumber}: insufficient stock to reverse ${inventoryItem.name} (need ${qty}, have ${inventoryItem.currentStock})`);
        err.statusCode = 400;
        throw err;
      }
    }
    for (const poItem of po.items) {
      const qty = Number(poItem.receivedQty) || 0;
      if (qty <= 0) continue;
      const inventoryItem = await q(InventoryItem.findById(poItem.item));
      if (!inventoryItem) continue;
      const previousStock = inventoryItem.currentStock;
      inventoryItem.currentStock = Math.max(0, inventoryItem.currentStock - qty);
      await inventoryItem.save(session ? { session } : undefined);
      const movement = {
        item: inventoryItem._id,
        type: "out",
        quantity: qty,
        previousStock,
        newStock: inventoryItem.currentStock,
        reason: `PO ${po.poNumber} deletion reversal`,
        referenceId: po._id,
        referenceType: "purchase_order",
      };
      await doCreate(StockMovement, { ...movement, createdBy: userId });
    }
    await q(StockMovement.deleteMany({ referenceId: po._id, referenceType: "purchase_order" }));
    await q(PurchaseOrder.deleteOne({ _id: po._id }));
    return;
  }
  const err = new Error(`PO status ${po.status} is not deletable`);
  err.statusCode = 400;
  throw err;
};

const performPODeletion = async (po, userId) => {
  const { withTransaction } = require("../utils/transaction");
  return withTransaction(async (session) => performPODeletionTx(po, userId, session));
};

const deletePurchaseOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const po = await PurchaseOrder.findById(id);
    if (!po) return res.status(404).json({ success: false, message: "PO not found" });
    try {
      await performPODeletion(po, req.user._id);
    } catch (e) {
      if (e.statusCode) return res.status(e.statusCode).json({ success: false, message: e.message });
      throw e;
    }
    return res.status(200).json({ success: true, message: "PO deleted" });
  } catch (error) {
    console.log("DELETE PO ERROR:", error);
    return handleError(res, error);
  }
};

const getPOSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const query = {};
    if (startDate || endDate) {
      query.orderDate = {};
      if (startDate) query.orderDate.$gte = new Date(startDate);
      if (endDate) query.orderDate.$lte = new Date(endDate);
    }

    const summary = await PurchaseOrder.aggregate([
      { $match: query },
      { $group: { _id: "$status", count: { $sum: 1 }, totalAmount: { $sum: "$total" } } },
    ]);

    const pendingReceipt = await PurchaseOrder.countDocuments({ status: { $in: ["sent", "partially_received"] } });
    const overdue = await PurchaseOrder.countDocuments({ expectedDate: { $lt: new Date() }, status: { $in: ["sent", "partially_received"] } });

    return res.status(200).json({ success: true, summary, pendingReceipt, overdue });
  } catch (error) {
    console.log("PO SUMMARY ERROR:", error);
    return handleError(res, error);
  }
};

// Bulk-delete purchase orders using same business rules as single delete.
// Draft/cancelled: straightforward. Received/partially_received: inventory-aware reversal.
// Sent/on_hold: blocked.
const bulkDeletePurchaseOrders = async (req, res) => {
  try {
    const { parseIds } = require("../utils/bulkDelete");
    let ids;
    try {
      ids = parseIds(req.body?.ids);
    } catch (err) {
      return res.status(err.status || 400).json({ success: false, message: err.message });
    }
    const pos = await PurchaseOrder.find({ _id: { $in: ids } });
    const foundMap = new Map(pos.map((p) => [String(p._id), p]));
    const blocked = [];
    const missing = [];
    let deletedCount = 0;
    for (const rawId of ids) {
      const str = String(rawId);
      const po = foundMap.get(str);
      if (!po) { missing.push(str); continue; }
      try {
        await performPODeletion(po, req.user._id);
        deletedCount += 1;
      } catch (e) {
        blocked.push({ id: str, poNumber: po.poNumber, reason: e.message });
      }
    }
    return res.status(200).json({
      success: true,
      message: `${deletedCount} purchase order${deletedCount === 1 ? "" : "s"} deleted.`,
      deletedCount,
      blocked,
      missing,
    });
  } catch (error) {
    console.log("BULK DELETE PO ERROR:", error);
    return handleError(res, error);
  }
};

module.exports = {
  getPurchaseOrders,
  getPurchaseOrderById,
  createPurchaseOrder,
  updatePurchaseOrder,
  sendPurchaseOrder,
  receivePurchaseOrder,
  cancelPurchaseOrder,
  deletePurchaseOrder,
  getPOSummary,
  bulkDeletePurchaseOrders,
};