const crypto = require("crypto");
const razorpay = require("../config/razorpay");
const Order = require("../models/Order");
const Payment = require("../models/Payment");
const InventoryItem = require("../models/InventoryItem");
const Recipe = require("../models/Recipe");
const StockMovement = require("../models/StockMovement");
const { handleError } = require("../utils/httpError");

// Aggregate required inventory across all order items and report shortages.
// Resolves recipes the same way deduction does, so nothing is partially
// deducted when stock is insufficient.
const getInventoryShortages = async (order) => {
  const required = new Map();

  for (const item of order.items || []) {
    if (!item.menuItemId) continue;

    const recipe = await Recipe.getByMenuItem(item.menuItemId);
    if (!recipe || !recipe.isActive) continue;

    for (const ingredient of recipe.ingredients) {
      const inventoryItem = await InventoryItem.findById(ingredient.item._id);
      if (!inventoryItem) continue;

      const quantityToDeduct = ingredient.quantity * item.qty;
      if (quantityToDeduct <= 0) continue;

      const key = String(inventoryItem._id);
      const entry = required.get(key);
      if (entry) {
        entry.requiredQty += quantityToDeduct;
      } else {
        required.set(key, { inventoryItem, requiredQty: quantityToDeduct });
      }
    }
  }

  const shortages = [];
  for (const { inventoryItem, requiredQty } of required.values()) {
    if (inventoryItem.currentStock < requiredQty) {
      shortages.push({
        name: inventoryItem.name,
        requiredQty,
        availableQty: inventoryItem.currentStock,
      });
    }
  }

  return shortages;
};

const deductInventoryForOrder = async (order, userId) => {
  try {
    // Atomically claim the deduction so concurrent/repeated status updates
    // can only deduct each order's inventory exactly once.
    const claimed = await Order.findOneAndUpdate(
      { _id: order._id, inventoryDeducted: { $ne: true } },
      { $set: { inventoryDeducted: true } }
    );

    if (!claimed) {
      console.log("Inventory already deducted for order:", order.orderNumber);
      return true;
    }

    try {
      const shortages = await getInventoryShortages(order);
      if (shortages.length > 0) {
        const details = shortages
          .map((s) => `${s.name} (need ${s.requiredQty}, available ${s.availableQty})`)
          .join(", ");
        throw new Error(`Insufficient inventory: ${details}`);
      }

      for (const item of order.items) {
        if (!item.menuItemId) continue;
        
        const recipe = await Recipe.getByMenuItem(item.menuItemId);
        if (!recipe || !recipe.isActive) continue;
        
        for (const ingredient of recipe.ingredients) {
          const inventoryItem = await InventoryItem.findById(ingredient.item._id);
          if (!inventoryItem) continue;
          
          const quantityToDeduct = ingredient.quantity * item.qty;
          if (quantityToDeduct <= 0) continue;
          
          const movement = await inventoryItem.adjustStock(
            -quantityToDeduct,
            `Order ${order.orderNumber}: ${item.name} x ${item.qty}`,
            order._id,
            "order",
            userId
          );
          
          await StockMovement.create({ ...movement, createdBy: userId });
        }
      }
      return true;
    } catch (deductionError) {
      // Release the claim so a later transition can retry the deduction.
      await Order.updateOne(
        { _id: order._id, inventoryDeducted: true },
        { $set: { inventoryDeducted: false } }
      ).catch(() => {});
      throw deductionError;
    }
  } catch (error) {
    console.error("INVENTORY DEDUCTION ERROR:", error);
    throw error;
  }
};

const buildRazorpayOrderResponse = (order, razorpayOrder) => ({
  success: true,
  key: process.env.RAZORPAY_KEY_ID,
  orderId: order._id,
  razorpayOrderId: razorpayOrder.id,
  amount: razorpayOrder.amount,
  currency: razorpayOrder.currency,
  customerName: order.customerName || "",
  phone: order.phone || "",
  email: order.email || "",
});

const createRazorpayOrder = async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "orderId is required",
      });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (Number(order.total || 0) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Order total must be greater than zero",
      });
    }

    const expectedAmount = Math.round(Number(order.total) * 100);

    // Idempotency: a restaurant order must map to at most one Razorpay order.
    // Razorpay orders are immutable, so a previously created order can only be
    // reused when its amount/currency still match the current total. If the
    // order changed, a fresh Razorpay order is created instead.
    if (order.razorpayOrderId) {
      try {
        const existingOrder = await razorpay.orders.fetch(order.razorpayOrderId);
        if (
          existingOrder &&
          existingOrder.id === order.razorpayOrderId &&
          Number(existingOrder.amount) === expectedAmount &&
          existingOrder.currency === "INR"
        ) {
          order.paymentMethod = "upi";
          order.paymentGateway = "razorpay";
          order.paymentStatus = "pending";
          await order.save();

          return res.status(200).json(buildRazorpayOrderResponse(order, existingOrder));
        }
      } catch (fetchError) {
        console.error("RAZORPAY ORDER FETCH ERROR:", fetchError.message);
      }
    }

    const options = {
      amount: expectedAmount,
      currency: "INR",
      receipt: `order_${order._id}`.slice(0, 40),
      notes: {
        orderId: order._id.toString(),
        customerName: order.customerName || "",
      },
      // Explicit automatic capture: the order-level setting overrides any
      // Dashboard capture configuration, so payments are captured automatically
      // and the existing server-side "captured" verification stays valid.
      payment: {
        capture: "automatic",
        capture_options: {
          automatic_expiry_period: 12,
        },
      },
    };

    const razorpayOrder = await razorpay.orders.create(options);

    order.paymentMethod = "upi";
    order.paymentGateway = "razorpay";
    order.paymentStatus = "pending";
    order.razorpayOrderId = razorpayOrder.id;

    await order.save();

    return res.status(200).json(buildRazorpayOrderResponse(order, razorpayOrder));
  } catch (error) {
    console.error(
      "CREATE RAZORPAY ORDER ERROR:",
      error?.response?.data || error.message
    );

    return handleError(res, error);
  }
};

// Keep the Order and Payment ledger consistent whenever Razorpay verification
// fails. Reuses the existing Payment.markFailed mechanism for existing records
// and only creates a failed record when none exists yet.
const markPaymentFailed = async (order, reason) => {
  const existing = await Payment.findOne({ order: order._id }).sort({ createdAt: -1 });

  if (existing) {
    // Never downgrade a settled payment ledger entry to failed.
    if (existing.status === "paid") {
      return existing;
    }
    if (existing.status !== "failed") {
      await existing.markFailed(reason);
    }
    return existing;
  }

  return Payment.create({
    order: order._id,
    customer: order.customer || null,
    amount: order.total,
    method: "upi",
    gateway: "razorpay",
    status: "failed",
    notes: reason,
  });
};

const verifyRazorpayPayment = async (req, res) => {
  try {
    const {
      orderId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (
      !orderId ||
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing payment verification fields",
      });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Cancelled or refunded orders can never be marked paid again.
    if (["cancelled", "refunded"].includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: "Cannot verify payment for a cancelled or refunded order",
      });
    }

    // A verification must correspond to a Razorpay order actually created for
    // this POS order. If createRazorpayOrder was never called, reject.
    if (!order.razorpayOrderId) {
      return res.status(400).json({
        success: false,
        message: "No Razorpay order was created for this order",
      });
    }

    if (order.razorpayOrderId !== razorpay_order_id) {
      return res.status(400).json({
        success: false,
        message: "Razorpay order ID mismatch",
      });
    }

    // Idempotent re-verification of an already settled payment: the order is
    // already paid and this is the same Razorpay payment, so report success
    // without re-applying any side effects.
    if (
      order.paymentStatus === "paid" &&
      order.razorpayPaymentId === razorpay_payment_id
    ) {
      return res.status(200).json({
        success: true,
        message: "Payment already verified",
        order,
      });
    }

    // Never silently re-mark an already paid order with a different payment.
    if (order.paymentStatus === "paid") {
      return res.status(400).json({
        success: false,
        message: "Order is already paid",
      });
    }

    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (generatedSignature !== razorpay_signature) {
      order.paymentMethod = "upi";
      order.paymentGateway = "razorpay";
      order.paymentStatus = "failed";
      await order.save();

      try {
        await markPaymentFailed(order, "Invalid payment signature");
      } catch (paymentError) {
        console.error("RAZORPAY PAYMENT FAILURE RECORD SYNC FAILED:", paymentError);
      }

      return res.status(400).json({
        success: false,
        message: "Invalid payment signature",
      });
    }

    // Confirm the payment with Razorpay server-side: the client signature alone
    // does not prove the charged amount, currency, or captured state.
    let razorpayPayment;
    try {
      razorpayPayment = await razorpay.payments.fetch(razorpay_payment_id);
    } catch (fetchError) {
      console.error("RAZORPAY PAYMENT FETCH FAILED:", fetchError.message);

      order.paymentStatus = "failed";
      await order.save();

      try {
        await markPaymentFailed(order, "Could not confirm payment with Razorpay");
      } catch (paymentError) {
        console.error("RAZORPAY PAYMENT FAILURE RECORD SYNC FAILED:", paymentError);
      }

      return res.status(400).json({
        success: false,
        message: "Could not confirm payment with Razorpay",
      });
    }

    const expectedAmount = Math.round(Number(order.total) * 100);
    const mismatches = [];

    if (razorpayPayment.order_id !== razorpay_order_id) {
      mismatches.push("Razorpay order ID mismatch");
    }
    if (razorpayPayment.status !== "captured") {
      mismatches.push("Payment is not captured");
    }
    if (Number(razorpayPayment.amount) !== expectedAmount) {
      mismatches.push("Payment amount does not match order total");
    }
    if (razorpayPayment.currency !== "INR") {
      mismatches.push("Payment currency mismatch");
    }

    if (mismatches.length > 0) {
      const reason = mismatches.join("; ");

      order.paymentStatus = "failed";
      await order.save();

      try {
        await markPaymentFailed(order, reason);
      } catch (paymentError) {
        console.error("RAZORPAY PAYMENT FAILURE RECORD SYNC FAILED:", paymentError);
      }

      return res.status(400).json({
        success: false,
        message: reason,
      });
    }

    // Respect the order state machine: pending -> confirmed is the only valid
    // route into a paid Razorpay order.
    if (!order.canTransitionTo("confirmed")) {
      return res.status(400).json({
        success: false,
        message: `Cannot confirm payment for order in status ${order.orderStatus}`,
      });
    }

    await order.transitionTo("confirmed", req.user._id);

    order.paymentMethod = "upi";
    order.paymentGateway = "razorpay";
    order.paymentStatus = "paid";
    order.razorpayOrderId = razorpay_order_id;
    order.razorpayPaymentId = razorpay_payment_id;
    order.razorpaySignature = razorpay_signature;
    order.paidAt = new Date();

    await order.save();

    // Create/update the Payment record so the ledger always reflects the
    // successful Razorpay payment (idempotent - no duplicates on re-verify).
    try {
      await Payment.ensurePaid({
        order: order._id,
        customer: order.customer || null,
        amount: order.total,
        method: "upi",
        gateway: "razorpay",
        collectedBy: order.createdBy,
        gatewayData: {
          gatewayOrderId: razorpay_order_id,
          gatewayPaymentId: razorpay_payment_id,
          gatewaySignature: razorpay_signature,
        },
      });
    } catch (paymentError) {
      console.error("RAZORPAY PAYMENT RECORD SYNC FAILED:", paymentError);
    }

    // Deduct inventory for UPI payment
    try {
      await deductInventoryForOrder(order, order.createdBy);
    } catch (inventoryError) {
      console.error("INVENTORY DEDUCTION FAILED:", inventoryError);
    }

    console.log("PAYMENT VERIFIED ORDER:", {
      orderId: order._id,
      orderNumber: order.orderNumber,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
    });

    return res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      order,
    });
  } catch (error) {
    console.error("VERIFY PAYMENT ERROR:", error.message);

    return handleError(res, error);
  }
};

module.exports = {
  createRazorpayOrder,
  verifyRazorpayPayment,
  markPaymentFailed,
  deductInventoryForOrder,
};