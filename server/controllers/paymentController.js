const Order = require("../models/Order");
const Payment = require("../models/Payment");
const InventoryItem = require("../models/InventoryItem");
const Recipe = require("../models/Recipe");
const StockMovement = require("../models/StockMovement");
const cashfree = require("../services/cashfree");
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

// Cashfree uses rupee amounts (not paise) and requires a stable, unique
// merchant order_id per restaurant order. Derive it from the Mongo id so
// create-order is naturally idempotent and webhooks can be matched back.
const merchantOrderId = (order) => `pos_${order._id}`;
const merchantCustomerId = (order) => `cust_${order._id}`;

const buildCustomerDetails = (order) => ({
  customer_id: merchantCustomerId(order),
  customer_name: order.customerName || "Customer",
  customer_email: order.customerEmail || order.email || "",
  customer_phone: order.customerPhone || order.phone || "0000000000",
});

const buildCashfreeOrderResponse = (order, cashfreeOrder, session) => ({
  success: true,
  orderId: order._id,
  cashfreeOrderId: cashfreeOrder.order_id,
  paymentSessionId: session?.payment_session_id || cashfreeOrder.payment_session_id,
  amount: Number(cashfreeOrder.order_amount),
  currency: cashfreeOrder.order_currency,
  environment: process.env.CASHFREE_ENV === "production" ? "production" : "sandbox",
  customerName: order.customerName || "",
  phone: order.customerPhone || "",
  email: order.customerEmail || "",
});

const createCashfreeOrder = async (req, res) => {
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

    const expectedAmount = Math.round(Number(order.total) * 100) / 100;

    // Idempotency: a restaurant order maps to at most one Cashfree order.
    // Cashfree orders are immutable, so a previously created order can only be
    // reused when its amount/currency still match the current total. If they
    // do, a fresh payment session is issued so the customer can retry without
    // recreating the order. If they changed, a new Cashfree order is created.
    if (order.cashfreeOrderId) {
      try {
        const existingOrder = await cashfree.fetchOrder(order.cashfreeOrderId);
        if (
          existingOrder &&
          existingOrder.order_id === order.cashfreeOrderId &&
          Number(existingOrder.order_amount) === expectedAmount &&
          existingOrder.order_currency === "INR"
        ) {
          const session = await cashfree.createOrderSession(order.cashfreeOrderId, {
            order_amount: expectedAmount,
            order_currency: "INR",
            customer_details: buildCustomerDetails(order),
          });

          order.paymentMethod = "upi";
          order.paymentGateway = "cashfree";
          order.paymentStatus = "pending";
          await order.save();

          return res.status(200).json(buildCashfreeOrderResponse(order, existingOrder, session));
        }
      } catch (fetchError) {
        console.error("CASHFREE ORDER FETCH ERROR:", fetchError.message);
      }
    }

    const options = {
      order_id: merchantOrderId(order),
      order_amount: expectedAmount,
      order_currency: "INR",
      order_note: `Order ${order.orderNumber}`,
      customer_details: buildCustomerDetails(order),
      order_meta: {
        payment_methods: "upi,cc,dc,nb",
        ...(process.env.CASHFREE_WEBHOOK_URL
          ? { notify_url: process.env.CASHFREE_WEBHOOK_URL }
          : {}),
      },
    };

    const cashfreeOrder = await cashfree.createOrder(options);

    order.paymentMethod = "upi";
    order.paymentGateway = "cashfree";
    order.paymentStatus = "pending";
    order.cashfreeOrderId = cashfreeOrder.order_id;

    await order.save();

    return res.status(200).json(buildCashfreeOrderResponse(order, cashfreeOrder));
  } catch (error) {
    console.error(
      "CREATE CASHFREE ORDER ERROR:",
      error?.data || error.message
    );

    return handleError(res, error);
  }
};

// Keep the Order and Payment ledger consistent whenever Cashfree verification
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
    gateway: "cashfree",
    status: "failed",
    notes: reason,
  });
};

const verifyCashfreePayment = async (req, res) => {
  try {
    const { orderId, cashfreeOrderId, cfPaymentId } = req.body;

    if (!orderId || !cashfreeOrderId) {
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

    // A verification must correspond to a Cashfree order actually created for
    // this POS order. If createCashfreeOrder was never called, reject.
    if (!order.cashfreeOrderId) {
      return res.status(400).json({
        success: false,
        message: "No Cashfree order was created for this order",
      });
    }

    if (order.cashfreeOrderId !== cashfreeOrderId) {
      return res.status(400).json({
        success: false,
        message: "Cashfree order ID mismatch",
      });
    }

    // Idempotent re-verification of an already settled payment: the order is
    // already paid, so report success without re-applying any side effects.
    if (order.paymentStatus === "paid" && order.cashfreePaymentId) {
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

    // Confirm the payment with Cashfree server-side: the client drop-in result
    // alone does not prove the charged amount, currency, or captured state.
    let payment;
    try {
      const payments = await cashfree.fetchOrderPayments(cashfreeOrderId);
      if (Array.isArray(payments) && payments.length > 0) {
        payment = cfPaymentId
          ? payments.find((p) => String(p.cf_payment_id) === String(cfPaymentId))
          : payments[0];
        // Fall back to the latest attempt when the given id is unknown.
        if (!payment) payment = payments[0];
      }
    } catch (fetchError) {
      console.error("CASHFREE PAYMENTS FETCH FAILED:", fetchError.message);

      if (cfPaymentId) {
        try {
          payment = await cashfree.fetchPayment(cfPaymentId);
        } catch (singleFetchError) {
          console.error("CASHFREE SINGLE PAYMENT FETCH FAILED:", singleFetchError.message);
        }
      }
    }

    if (!payment) {
      order.paymentStatus = "failed";
      await order.save();

      try {
        await markPaymentFailed(order, "Could not confirm payment with Cashfree");
      } catch (paymentError) {
        console.error("CASHFREE PAYMENT FAILURE RECORD SYNC FAILED:", paymentError);
      }

      return res.status(400).json({
        success: false,
        message: "Could not confirm payment with Cashfree",
      });
    }

    const expectedAmount = Math.round(Number(order.total) * 100) / 100;
    const mismatches = [];

    if (String(payment.order_id) !== cashfreeOrderId) {
      mismatches.push("Cashfree order ID mismatch");
    }
    if (payment.payment_status !== "SUCCESS") {
      mismatches.push("Payment is not successful");
    }
    if (Number(payment.order_amount) !== expectedAmount) {
      mismatches.push("Payment amount does not match order total");
    }
    if (payment.payment_currency !== "INR") {
      mismatches.push("Payment currency mismatch");
    }

    if (mismatches.length > 0) {
      const reason = mismatches.join("; ");

      order.paymentStatus = "failed";
      await order.save();

      try {
        await markPaymentFailed(order, reason);
      } catch (paymentError) {
        console.error("CASHFREE PAYMENT FAILURE RECORD SYNC FAILED:", paymentError);
      }

      return res.status(400).json({
        success: false,
        message: reason,
      });
    }

    // Respect the order state machine: pending -> confirmed is the only valid
    // route into a paid Cashfree order.
    if (!order.canTransitionTo("confirmed")) {
      return res.status(400).json({
        success: false,
        message: `Cannot confirm payment for order in status ${order.orderStatus}`,
      });
    }

    await order.transitionTo("confirmed", req.user._id);

    order.paymentMethod = "upi";
    order.paymentGateway = "cashfree";
    order.paymentStatus = "paid";
    order.cashfreeOrderId = cashfreeOrderId;
    order.cashfreePaymentId = String(payment.cf_payment_id);
    order.cashfreePaymentStatus = payment.payment_status;
    order.paidAt = new Date();

    await order.save();

    // Create/update the Payment record so the ledger always reflects the
    // successful Cashfree payment (idempotent - no duplicates on re-verify).
    try {
      await Payment.ensurePaid({
        order: order._id,
        customer: order.customer || null,
        amount: order.total,
        method: "upi",
        gateway: "cashfree",
        collectedBy: order.createdBy,
        gatewayData: {
          gatewayOrderId: cashfreeOrderId,
          gatewayPaymentId: String(payment.cf_payment_id),
          gatewayResponse: payment,
        },
      });
    } catch (paymentError) {
      console.error("CASHFREE PAYMENT RECORD SYNC FAILED:", paymentError);
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

// Total amount already collected for an order from paid Payment ledger rows.
const getPaidAmountForOrder = async (order) => {
  const paidRecords = await Payment.find({ order: order._id, status: "paid" });
  if (paidRecords.length > 0) {
    return Math.round(paidRecords.reduce((sum, r) => sum + (Number(r.amount) || 0), 0) * 100) / 100;
  }
  if (order.paymentStatus === "paid") {
    return Math.round((Number(order.total) || 0) * 100) / 100;
  }
  return 0;
};

// ---------------------------------------------------------------------------
// Additional payment (pay the delta after an edit increased a paid order)
// ---------------------------------------------------------------------------

const cashfreeAdditionalOrderId = (order) => `pos_${order._id}_adj`;

const createAdditionalCashfreeOrder = async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ success: false, message: "orderId is required" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (["cancelled", "refunded"].includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: "Cannot collect additional payment for a cancelled or refunded order",
      });
    }

    const additional = Math.round((Number(order.additionalAmountDue) || 0) * 100) / 100;
    if (additional <= 0) {
      return res.status(400).json({ success: false, message: "No additional payment is due" });
    }

    const additionalOrderId = cashfreeAdditionalOrderId(order);

    // Idempotent reuse of a previously created additional Cashfree order when
    // the amount still matches (Cashfree orders are immutable; sessions are
    // re-issued so a customer can retry without recreating the order).
    if (order.cashfreeAdditionalOrderId) {
      try {
        const existingOrder = await cashfree.fetchOrder(order.cashfreeAdditionalOrderId);
        if (
          existingOrder &&
          existingOrder.order_id === order.cashfreeAdditionalOrderId &&
          Number(existingOrder.order_amount) === additional &&
          existingOrder.order_currency === "INR"
        ) {
          const session = await cashfree.createOrderSession(order.cashfreeAdditionalOrderId, {
            order_amount: additional,
            order_currency: "INR",
            customer_details: buildCustomerDetails(order),
          });

          return res.status(200).json(
            buildCashfreeOrderResponse(order, existingOrder, session)
          );
        }
      } catch (fetchError) {
        console.error("CASHFREE ADDITIONAL ORDER FETCH ERROR:", fetchError.message);
      }
    }

    const options = {
      order_id: additionalOrderId,
      order_amount: additional,
      order_currency: "INR",
      order_note: `Additional payment for order ${order.orderNumber}`,
      customer_details: buildCustomerDetails(order),
      order_meta: {
        payment_methods: "upi,cc,dc,nb",
        ...(process.env.CASHFREE_WEBHOOK_URL
          ? { notify_url: process.env.CASHFREE_WEBHOOK_URL }
          : {}),
      },
    };

    const cashfreeOrder = await cashfree.createOrder(options);

    await Order.updateOne(
      { _id: order._id },
      { $set: { cashfreeAdditionalOrderId: cashfreeOrder.order_id, updatedAt: new Date() } }
    );

    console.log("ADDITIONAL CASHFREE ORDER CREATED:", {
      orderId: order._id,
      orderNumber: order.orderNumber,
      cashfreeOrderId: cashfreeOrder.order_id,
      amount: additional,
    });

    return res.status(200).json(buildCashfreeOrderResponse(order, cashfreeOrder));
  } catch (error) {
    console.error("CREATE ADDITIONAL CASHFREE ORDER ERROR:", error?.data || error.message);
    return handleError(res, error);
  }
};

const verifyAdditionalCashfreePayment = async (req, res) => {
  try {
    const { orderId, cashfreeOrderId, cfPaymentId } = req.body;

    if (!orderId || !cashfreeOrderId) {
      return res.status(400).json({
        success: false,
        message: "Missing payment verification fields",
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (["cancelled", "refunded"].includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: "Cannot verify payment for a cancelled or refunded order",
      });
    }

    if (!order.cashfreeAdditionalOrderId) {
      return res.status(400).json({
        success: false,
        message: "No additional Cashfree order was created for this order",
      });
    }

    if (order.cashfreeAdditionalOrderId !== cashfreeOrderId) {
      return res.status(400).json({
        success: false,
        message: "Cashfree order ID mismatch",
      });
    }

    // Idempotent re-verification: the delta is already settled.
    if (Number(order.additionalAmountDue) <= 0 && Number(order.refundAmountDue) >= 0) {
      return res.status(200).json({
        success: true,
        message: "Additional payment already collected",
        order,
      });
    }

    const additional = Math.round((Number(order.additionalAmountDue) || 0) * 100) / 100;

    let payment;
    try {
      const payments = await cashfree.fetchOrderPayments(cashfreeOrderId);
      if (Array.isArray(payments) && payments.length > 0) {
        payment = cfPaymentId
          ? payments.find((p) => String(p.cf_payment_id) === String(cfPaymentId))
          : payments[0];
        if (!payment) payment = payments[0];
      }
    } catch (fetchError) {
      console.error("CASHFREE ADDITIONAL PAYMENTS FETCH FAILED:", fetchError.message);
      if (cfPaymentId) {
        try {
          payment = await cashfree.fetchPayment(cfPaymentId);
        } catch (singleFetchError) {
          console.error(
            "CASHFREE ADDITIONAL SINGLE PAYMENT FETCH FAILED:",
            singleFetchError.message
          );
        }
      }
    }

    if (!payment) {
      return res.status(400).json({
        success: false,
        message: "Could not confirm additional payment with Cashfree",
      });
    }

    const mismatches = [];
    if (String(payment.order_id) !== cashfreeOrderId) mismatches.push("Cashfree order ID mismatch");
    if (payment.payment_status !== "SUCCESS") mismatches.push("Payment is not successful");
    if (Number(payment.order_amount) !== additional) mismatches.push("Payment amount does not match additional amount due");
    if (payment.payment_currency !== "INR") mismatches.push("Payment currency mismatch");

    if (mismatches.length > 0) {
      return res.status(400).json({
        success: false,
        message: mismatches.join("; "),
      });
    }

    // Atomic claim so concurrent verifies cannot settle the delta twice.
    const claimed = await Order.findOneAndUpdate(
      {
        _id: order._id,
        additionalAmountDue: { $gt: 0 },
        additionalPaymentInProgress: { $ne: true },
      },
      { $set: { additionalPaymentInProgress: true, updatedAt: new Date() } },
      { new: true }
    );

    if (!claimed) {
      const latest = await Order.findById(order._id);
      if (Number(latest?.additionalAmountDue || 0) <= 0) {
        return res.status(200).json({
          success: true,
          message: "Additional payment already collected",
          order: latest,
        });
      }
      return res.status(409).json({
        success: false,
        message: "Another additional payment verification is already in progress",
      });
    }

    try {
      await Payment.create({
        order: claimed._id,
        customer: claimed.customer || null,
        amount: additional,
        method: "upi",
        gateway: "cashfree",
        status: "paid",
        transactionId: payment.cf_payment_id ? String(payment.cf_payment_id) : undefined,
        collectedBy: claimed.createdBy,
        collectedAt: new Date(),
        notes: "Additional payment for edited order",
        metadata: { additionalPayment: true, reason: "order_edit" },
        gatewayData: {
          gatewayOrderId: cashfreeOrderId,
          gatewayPaymentId: String(payment.cf_payment_id),
          gatewayResponse: payment,
        },
      });

      const newPaidAmount = (await getPaidAmountForOrder(claimed)) + additional;
      const fullyPaid = newPaidAmount >= (Number(claimed.total) || 0);

      await Order.updateOne(
        { _id: claimed._id },
        {
          $set: {
            paymentStatus: fullyPaid ? "paid" : "partial",
            additionalAmountDue: fullyPaid
              ? 0
              : Math.round((Number(claimed.total) - newPaidAmount) * 100) / 100,
            additionalPaymentInProgress: false,
            cashfreeAdditionalPaymentId: String(payment.cf_payment_id),
            paidAt: fullyPaid ? new Date() : claimed.paidAt,
            updatedAt: new Date(),
          },
        }
      );
    } catch (paymentError) {
      console.error("ADDITIONAL PAYMENT VERIFY LEDGER ERROR:", paymentError);
      await Order.updateOne(
        { _id: claimed._id, additionalPaymentInProgress: true },
        { $set: { additionalPaymentInProgress: false, updatedAt: new Date() } }
      ).catch(() => {});
      throw paymentError;
    }

    const populatedOrder = await Order.findById(claimed._id)
      .populate("customer", "name phone")
      .populate("table", "number zone")
      .populate("updatedBy", "name")
      .lean();

    return res.status(200).json({
      success: true,
      message: "Additional payment verified successfully",
      order: populatedOrder,
    });
  } catch (error) {
    console.error("VERIFY ADDITIONAL PAYMENT ERROR:", error.message);
    return handleError(res, error);
  }
};

module.exports = {
  createCashfreeOrder,
  verifyCashfreePayment,
  createAdditionalCashfreeOrder,
  verifyAdditionalCashfreePayment,
  markPaymentFailed,
  deductInventoryForOrder,
};