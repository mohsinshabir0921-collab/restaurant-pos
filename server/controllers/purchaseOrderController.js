const PurchaseOrder = require("../models/PurchaseOrder");
const InventoryItem = require("../models/InventoryItem");
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

const deletePurchaseOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const po = await PurchaseOrder.findById(id);
    if (!po) return res.status(404).json({ success: false, message: "PO not found" });

    if (po.status !== "draft" && po.status !== "cancelled") {
      return res.status(400).json({ success: false, message: "Can only delete draft or cancelled POs" });
    }

    await PurchaseOrder.findByIdAndDelete(id);
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
};