const mongoose = require("mongoose");
const Order = require("../models/Order");
const MenuItem = require("../models/MenuItem");
const Customer = require("../models/Customer");
const Table = require("../models/Table");
const Settings = require("../models/Settings");
const LoyaltyConfig = require("../models/LoyaltyConfig");
const Coupon = require("../models/Coupon");
const Payment = require("../models/Payment");
const InventoryItem = require("../models/InventoryItem");
const Recipe = require("../models/Recipe");
const StockMovement = require("../models/StockMovement");
const { handleError } = require("../utils/httpError");
const { createNotificationForAdmins } = require("../utils/notificationService");
const { parsePagination } = require("../utils/pagination");

const ALLOWED_PAYMENT_METHODS = ["cash", "card", "upi", "wallet", "cod", "split"];
const ALLOWED_ORDER_TYPES = ["dinein", "takeaway", "delivery"];

// A size/variant is modelled as a modifier group whose name contains "size" or
// "variant". Both the POS (hardcoded "Size") and the public website (the real
// menu group name) send it inside `modifiers`, so we normalize it into a
// dedicated `size` field here so every order — regardless of source — carries a
// consistent, explicitly-stored size/variant.
const SIZE_MODIFIER_PATTERN = /size|variant/i;

const extractItemSize = (modifiers) => {
  const sizeMod = (Array.isArray(modifiers) ? modifiers : []).find(
    (m) => m && SIZE_MODIFIER_PATTERN.test(m.name || "")
  );
  return sizeMod && sizeMod.option ? sizeMod.option : "";
};
const ALLOWED_ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "out_for_delivery",
  "delivered",
  "served",
  "paid",
  "completed",
  "cancelled",
  "refunded",
];

// Delivery users may only drive their own assigned delivery order through the
// delivery lifecycle. Admin and kitchen keep the full transition matrix.
const DELIVERY_ALLOWED_TRANSITIONS = {
  ready: ["out_for_delivery"],
  out_for_delivery: ["delivered"],
};

const calculateTax = async (subtotal, items, isInterState = false) => {
  const taxInclusive = await Settings.getValue("tax_inclusive", false);
  const defaultCgst = await Settings.getValue("default_cgst", 2.5);
  const defaultSgst = await Settings.getValue("default_sgst", 2.5);
  const defaultIgst = await Settings.getValue("default_igst", 5);

  let cgst = 0, sgst = 0, igst = 0, totalTax = 0;

  for (const item of items) {
    const itemTaxRate = item.taxRate || 0;
    const itemSubtotal = item.price * item.qty;
    const taxableAmount = taxInclusive ? itemSubtotal / (1 + itemTaxRate / 100) : itemSubtotal;
    const taxAmount = taxableAmount * (itemTaxRate / 100);

    if (isInterState) {
      igst += taxAmount;
    } else {
      cgst += taxAmount / 2;
      sgst += taxAmount / 2;
    }
    totalTax += taxAmount;
  }

  return { cgst: Math.round(cgst * 100) / 100, sgst: Math.round(sgst * 100) / 100, igst: Math.round(igst * 100) / 100, totalTax: Math.round(totalTax * 100) / 100 };
};

const calculateServiceCharge = async (subtotal) => {
  const enabled = await Settings.getValue("service_charge_enabled", false);
  if (!enabled) return 0;
  const percent = await Settings.getValue("service_charge_percent", 0);
  return Math.round((subtotal * percent / 100) * 100) / 100;
};

const applyCoupon = async (code, orderAmount, orderType, customerId) => {
  const coupon = await Coupon.findValidForOrder(code, orderAmount, orderType, customerId);
  if (!coupon) return { discount: 0, coupon: null };
  
  const discount = coupon.calculateDiscount(orderAmount);
  return { discount, coupon };
};

// Aggregate required inventory across all order items and report shortages.
// Resolves recipes the same way deduction does, so an order is rejected before
// anything is partially deducted.
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

const restoreInventoryForOrder = async (order, userId) => {
  try {
    // Atomically claim the restoration so concurrent/repeated cancellations
    // can only restore each order's inventory exactly once. The claim also
    // guarantees restoration only runs when inventory was actually deducted.
    const claimed = await Order.findOneAndUpdate(
      { _id: order._id, inventoryDeducted: true, inventoryRestored: { $ne: true } },
      { $set: { inventoryRestored: true } }
    );

    if (!claimed) {
      console.log("Inventory not previously deducted or already restored for order:", order.orderNumber);
      return true;
    }

    try {
      for (const item of order.items) {
        if (!item.menuItemId) continue;

        const recipe = await Recipe.getByMenuItem(item.menuItemId);
        if (!recipe || !recipe.isActive) continue;

        for (const ingredient of recipe.ingredients) {
          const inventoryItem = await InventoryItem.findById(ingredient.item._id);
          if (!inventoryItem) continue;

          const quantityToRestore = ingredient.quantity * item.qty;
          if (quantityToRestore <= 0) continue;

          const movement = await inventoryItem.adjustStock(
            quantityToRestore,
            `Order ${order.orderNumber} cancelled: ${item.name} x ${item.qty}`,
            order._id,
            "order_cancellation",
            userId
          );

          await StockMovement.create({ ...movement, createdBy: userId });
        }
      }

      // Restoration fully succeeded. Clear the deducted flag so a future
      // re-confirmation could deduct again; inventoryRestored stays true as
      // the permanent idempotency marker.
      await Order.updateOne(
        { _id: order._id, inventoryRestored: true },
        { $set: { inventoryDeducted: false } }
      );

      return true;
    } catch (restoreError) {
      // Release the claim so a later attempt can retry the full restoration.
      await Order.updateOne(
        { _id: order._id, inventoryRestored: true },
        { $set: { inventoryRestored: false } }
      ).catch(() => {});
      throw restoreError;
    }
  } catch (error) {
    console.error("INVENTORY RESTORE ERROR:", error);
    throw error;
  }
};

const createOrder = async (req, res) => {
  console.log("=== CREATE ORDER START ===");
  console.log("Request body:", JSON.stringify(req.body, null, 2));
  console.log("Authenticated user:", req.user ? { id: req.user._id, name: req.user.name, role: req.user.role } : "NO USER");
  
  try {
    console.log("--- Step 1: Destructuring req.body ---");
    const {
      customerName,
      customerPhone,
      customerEmail,
      customerId,
      tableId,
      tableNo,
      items,
      paymentMethod = "cash",
      splitPayments,
      orderType = "dinein",
      deliveryAddress,
      deliveryFee = 0,
      pickupAt,
      notes,
      couponCode,
      loyaltyPointsUsed = 0,
      discount = 0,
      discountType = "flat",
      discountReason,
      source = "pos",
    } = req.body;
    
    console.log("--- Step 1 complete: Destructured fields ---", {
      customerName, customerPhone, customerEmail, customerId,
      tableId, tableNo, itemsCount: items?.length,
      paymentMethod, orderType, deliveryFee, couponCode,
      loyaltyPointsUsed, discount, discountType, source
    });

    console.log("--- Step 2: Validation checks ---");
    if (!customerName || customerName.trim() === "") {
      console.log("VALIDATION FAILED: Customer name missing");
      return res.status(400).json({
        success: false,
        message: "Customer name is required",
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      console.log("VALIDATION FAILED: Items missing or empty");
      return res.status(400).json({
        success: false,
        message: "Items are required",
      });
    }

    console.log("--- Step 3: Items validation ---");
    if (!ALLOWED_PAYMENT_METHODS.includes(paymentMethod)) {
      console.log("VALIDATION FAILED: Invalid payment method", paymentMethod);
      return res.status(400).json({
        success: false,
        message: "Invalid payment method",
      });
    }

    if (!ALLOWED_ORDER_TYPES.includes(orderType)) {
      console.log("VALIDATION FAILED: Invalid order type", orderType);
      return res.status(400).json({
        success: false,
        message: "Invalid order type",
      });
    }

    if (paymentMethod === "cod" && orderType !== "delivery") {
      console.log("VALIDATION FAILED: COD requires delivery order type", paymentMethod, orderType);
      return res.status(400).json({
        success: false,
        message: "Cash on Delivery is only available for delivery orders",
      });
    }

    if (orderType === "takeaway") {
      if (!pickupAt) {
        console.log("VALIDATION FAILED: Pickup date/time missing for takeaway order");
        return res.status(400).json({
          success: false,
          message: "Pickup date and time are required for takeaway orders",
        });
      }
      const pickupDate = new Date(pickupAt);
      if (isNaN(pickupDate.getTime())) {
        console.log("VALIDATION FAILED: Invalid pickup date/time", pickupAt);
        return res.status(400).json({
          success: false,
          message: "Invalid pickup date/time",
        });
      }
      if (pickupDate.getTime() <= Date.now()) {
        console.log("VALIDATION FAILED: Pickup date/time is not in the future", pickupAt);
        return res.status(400).json({
          success: false,
          message: "Pickup date/time must be in the future",
        });
      }
    }

    console.log("--- Step 4: Customer lookup ---");
    let customer = null;
    let newCustomerCreated = null;
    if (customerId) {
      console.log("Looking up customer by ID:", customerId);
      customer = await Customer.findById(customerId);
      if (!customer) {
        console.log("Customer not found by ID:", customerId);
        return res.status(404).json({
          success: false,
          message: "Customer not found",
        });
      }
      console.log("Customer found by ID:", customer._id);
    } else if (customerPhone) {
      console.log("Looking up/creating customer by phone:", customerPhone);
      const existingCustomer = await Customer.getByPhone(customerPhone);
      customer = await Customer.createOrGet(customerPhone, customerName);
      if (!existingCustomer) newCustomerCreated = customer;
      console.log("Customer created/found:", customer._id);
    }

    console.log("--- Step 5: Table lookup ---");
    let table = null;
    let finalTableNo = null;
    
    if (orderType === "dinein") {
      if (tableId) {
        console.log("Looking up table by ID:", tableId);
        table = await Table.findById(tableId);
        if (!table) {
          console.log("Table not found by ID:", tableId);
          return res.status(404).json({
            success: false,
            message: "Table not found",
          });
        }
        if (table.status === "occupied" && table.currentOrder) {
          const existingOrder = await Order.findById(table.currentOrder);
          if (existingOrder && !["paid", "completed", "cancelled", "refunded"].includes(existingOrder.orderStatus)) {
            console.log("Table occupied by order:", table.currentOrder);
            return res.status(400).json({
              success: false,
              message: "Table is already occupied",
            });
          }
        }
        finalTableNo = table.number;
      } else if (tableNo) {
        console.log("Looking up table by number:", tableNo);
        table = await Table.findOne({ number: tableNo, isActive: true });
        if (table) {
          if (table.status === "occupied" && table.currentOrder) {
            const existingOrder = await Order.findById(table.currentOrder);
            if (existingOrder && !["paid", "completed", "cancelled", "refunded"].includes(existingOrder.orderStatus)) {
              console.log("Table occupied by order:", table.currentOrder);
              return res.status(400).json({
                success: false,
                message: "Table is already occupied",
              });
            }
          }
          finalTableNo = table.number;
        } else {
          console.log("Table not found, using number directly:", tableNo);
          finalTableNo = Number(tableNo);
        }
      }
    }

    console.log("--- Step 6: Items validation ---");
    for (const item of items) {
      if (!item.name || item.price == null || item.qty == null) {
        console.log("VALIDATION FAILED: Item missing required fields", item);
        return res.status(400).json({
          success: false,
          message: "Each item must have name, price and qty",
        });
      }

      if (Number.isNaN(Number(item.price)) || Number(item.price) < 0) {
        console.log("VALIDATION FAILED: Invalid price", item.price);
        return res.status(400).json({
          success: false,
          message: "Item price must be a valid positive number",
        });
      }

      if (
        Number.isNaN(Number(item.qty)) ||
        Number(item.qty) < 1 ||
        !Number.isInteger(Number(item.qty))
      ) {
        console.log("VALIDATION FAILED: Invalid qty", item.qty);
        return res.status(400).json({
          success: false,
          message: "Item quantity must be a whole number greater than zero",
        });
      }

      if (
        item.menuItemId &&
        !mongoose.Types.ObjectId.isValid(item.menuItemId)
      ) {
        console.log("VALIDATION FAILED: Invalid menuItemId", item.menuItemId);
        return res.status(400).json({
          success: false,
          message: "Invalid menu item id",
        });
      }
    }

    console.log("--- Step 7: Building cleanItems ---");
    const cleanItems = items.map((item) => ({
      name: String(item.name).trim(),
      price: Number(item.price),
      qty: Number(item.qty),
      menuItemId: item.menuItemId || null,
      category: item.category || "",
      isVeg: item.isVeg !== undefined ? item.isVeg : true,
      taxRate: item.taxRate || 0,
      modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
      size: (item.size && String(item.size).trim()) || extractItemSize(item.modifiers),
      notes: item.notes?.trim() || "",
    }));
    console.log("Clean items built:", cleanItems.length, "items");

    console.log("--- Step 8: Calculating subtotal ---");
    const subtotal = cleanItems.reduce((sum, item) => sum + item.price * item.qty, 0);
    console.log("Subtotal:", subtotal);

    console.log("--- Step 9: Coupon handling ---");
    let appliedCoupon = null;
    let couponDiscount = 0;
    if (couponCode) {
      console.log("Validating coupon:", couponCode);
      const result = await applyCoupon(couponCode, subtotal, orderType, customer?._id);
      couponDiscount = result.discount;
      appliedCoupon = result.coupon;
      console.log("Coupon result:", { couponDiscount, appliedCoupon: !!appliedCoupon });
    }

    console.log("--- Step 10: Discount calculation ---");
    let finalDiscount = Number(discount) || 0;
    if (discountType === "percent") {
      finalDiscount = Math.round((subtotal * finalDiscount / 100) * 100) / 100;
    }

    const totalDiscount = Math.min(couponDiscount + finalDiscount, subtotal);
    console.log("Total discount:", totalDiscount);

    console.log("--- Step 11: Tax calculation ---");
    const isInterState = deliveryAddress && deliveryAddress.state && 
      deliveryAddress.state !== (await Settings.getValue("restaurant_state", ""));
    console.log("Interstate:", isInterState);

    const { cgst, sgst, igst, totalTax } = await calculateTax(subtotal - totalDiscount, cleanItems, isInterState);
    console.log("Tax calculated:", { cgst, sgst, igst, totalTax });

    console.log("--- Step 12: Service charge ---");
    const serviceCharge = await calculateServiceCharge(subtotal - totalDiscount);
    console.log("Service charge:", serviceCharge);

    console.log("--- Step 13: Loyalty points ---");
    const loyaltyConfig = await LoyaltyConfig.getConfig();
    const loyaltyPointsValue = loyaltyPointsUsed > 0 ? loyaltyConfig.rupeePerPoint * loyaltyPointsUsed : 0;
    const minPoints = loyaltyConfig.minPointsToRedeem;
    
    if (loyaltyPointsUsed > 0 && (!customer || customer.loyaltyPoints < loyaltyPointsUsed)) {
      console.log("VALIDATION FAILED: Insufficient loyalty points");
      return res.status(400).json({
        success: false,
        message: "Insufficient loyalty points",
      });
    }
    
    if (loyaltyPointsUsed > 0 && loyaltyPointsUsed < minPoints) {
      console.log("VALIDATION FAILED: Minimum points not met");
      return res.status(400).json({
        success: false,
        message: `Minimum ${minPoints} points required for redemption`,
      });
    }

    console.log("--- Step 14: Total calculation ---");
    let total = subtotal - totalDiscount + totalTax + serviceCharge + Number(deliveryFee) - loyaltyPointsValue;
    total = Math.round(total * 100) / 100;

    const roundingAdjustment = Math.round(total) - total;
    total = Math.round(total);
    console.log("Total calculated:", { subtotal, totalDiscount, totalTax, serviceCharge, deliveryFee: Number(deliveryFee) || 0, loyaltyPointsValue, total, roundingAdjustment });

    console.log("--- Split payment validation ---");
    if (paymentMethod === "split") {
      const validSplitMethods = ["cash", "card", "upi", "wallet"];

      if (!Array.isArray(splitPayments) || splitPayments.length < 2) {
        return res.status(400).json({
          success: false,
          message: "Split payment requires at least 2 payment entries",
        });
      }

      let splitTotal = 0;
      for (const row of splitPayments) {
        const method = row?.method;
        const amount = Number(row?.amount);

        if (!validSplitMethods.includes(method)) {
          return res.status(400).json({
            success: false,
            message: "Split payment method must be one of: cash, card, upi, wallet",
          });
        }

        if (Number.isNaN(amount) || amount <= 0) {
          return res.status(400).json({
            success: false,
            message: "Each split payment amount must be greater than zero",
          });
        }

        splitTotal += amount;
      }

      splitTotal = Math.round(splitTotal * 100) / 100;

      if (splitTotal !== total) {
        return res.status(400).json({
          success: false,
          message: "Split payment amounts must exactly match the order total",
        });
      }
    }

    console.log("--- Step 15: Payment method check ---");
    const isInstantPaid = ["cash", "card", "wallet"].includes(paymentMethod);
    const isSplit = paymentMethod === "split";
    const isCOD = paymentMethod === "cod" && orderType === "delivery";
    // UPI and COD are never settled at creation: only instant-paid methods
    // (cash/card/wallet) and split payments create paid + confirmed orders.
    // UPI stays pending until the Cashfree verify/webhook path succeeds.
    const isPaidOnCreate = isInstantPaid || isSplit;
    console.log("Payment check:", { isInstantPaid, isSplit, isCOD, paymentMethod, orderType, isPaidOnCreate });

    console.log("--- Step 15b: Inventory availability check ---");
    const shortages = await getInventoryShortages({ items: cleanItems });
    if (shortages.length > 0) {
      console.log("Order rejected: insufficient inventory", shortages);
      return res.status(400).json({
        success: false,
        message: `Insufficient inventory: ${shortages
          .map((s) => `${s.name} (need ${s.requiredQty}, available ${s.availableQty})`)
          .join(", ")}`,
        shortages,
      });
    }

    console.log("--- Step 16: Creating order in database ---");
    const order = await Order.create({
      customer: customer?._id || null,
      customerName: customerName.trim(),
      customerPhone: customerPhone?.trim() || "",
      customerEmail: customerEmail?.trim().toLowerCase() || "",
      table: table?._id || null,
      tableNo: finalTableNo,
      orderType,
      items: cleanItems,
      subtotal,
      tax: totalTax,
      cgst,
      sgst,
      igst,
      serviceCharge,
      discount: totalDiscount,
      discountType: couponCode ? "coupon" : (discountType === "percent" ? "percent" : "flat"),
      discountReason: discountReason || (couponCode ? `Coupon: ${couponCode}` : ""),
      couponCode: couponCode || null,
      loyaltyPointsUsed,
      total,
      paymentMethod,
      paymentStatus: isPaidOnCreate ? "paid" : "pending",
      paidAt: isPaidOnCreate ? new Date() : null,
      orderStatus: isPaidOnCreate ? "confirmed" : "pending",
      deliveryAddress,
      deliveryFee: Number(deliveryFee) || 0,
      pickupAt: pickupAt ? new Date(pickupAt) : null,
      notes: notes?.trim() || "",
      source,
      createdBy: req.user._id,
    });
    console.log("Order created:", order._id, "orderNumber:", order.orderNumber);

    // Deduct inventory for instant paid orders before applying any other side
    // effects (table, loyalty, coupon, payment). If the deduction fails after
    // the availability pre-check (e.g. a concurrent order consumed the stock),
    // reject cleanly and remove the just-created order so no partial state
    // (order/payment/table/loyalty/coupon) is left behind.
    if (isPaidOnCreate) {
      console.log("Deducting inventory for instant paid order");
      try {
        await deductInventoryForOrder(order, req.user._id);
        console.log("Inventory deducted successfully");
      } catch (inventoryError) {
        console.error("INVENTORY DEDUCTION FAILED:", inventoryError);
        await Order.findByIdAndDelete(order._id).catch(() => {});
        return res.status(400).json({
          success: false,
          message: inventoryError?.message || "Insufficient inventory",
        });
      }
    }

    if (table) {
      console.log("Occupying table:", table._id);
      await table.occupy(order._id);
    }

    if (customer) {
      console.log("Updating customer loyalty");
      const pointsPerRupee = loyaltyConfig.pointsPerRupee;
      const pointsEarned = Math.floor(total * pointsPerRupee);
      order.loyaltyPointsEarned = pointsEarned;
      await customer.recordVisit(total, pointsEarned);
      
      if (loyaltyPointsUsed > 0) {
        await customer.redeemPoints(loyaltyPointsUsed);
      }
      
      await order.save();
      console.log("Customer loyalty updated, order saved");
    }

    if (appliedCoupon) {
      console.log("Incrementing coupon usage");
      await appliedCoupon.incrementUsage();
    }

    if (isPaidOnCreate) {
      console.log("Creating payment record");
      await Payment.create({
        order: order._id,
        customer: customer?._id || null,
        amount: total,
        method: paymentMethod,
        gateway: "manual",
        status: "paid",
        ...(isSplit ? { splitPayments } : {}),
        collectedBy: req.user._id,
        collectedAt: new Date(),
      });
    }

    console.log("--- Step 17: Populating order for response ---");
    const populatedOrder = await Order.findById(order._id)
      .populate("customer", "name phone email loyaltyPoints")
      .populate("table", "number zone")
      .populate("createdBy", "name")
      .lean();
    console.log("Order populated for response");

    try {
      await createNotificationForAdmins({
        type: "order",
        title: "New Order",
        message: `${order.orderNumber} · ${customerName} · ₹${order.total.toLocaleString("en-IN")}`,
        link: "/",
        entityId: order._id,
      });
      if (newCustomerCreated) {
        await createNotificationForAdmins({
          type: "customer",
          title: "New Customer",
          message: `${newCustomerCreated.name} · ${newCustomerCreated.phone}`,
          link: "/customers",
          entityId: newCustomerCreated._id,
        });
      }
    } catch (notifyError) {
      console.error("ORDER NOTIFICATION ERROR:", notifyError.message);
    }

    console.log("=== CREATE ORDER SUCCESS ===");
    return res.status(201).json({
      success: true,
      message: "Order placed successfully",
      order: populatedOrder,
    });
  } catch (error) {
    console.error("=== CREATE ORDER ERROR ===");
    console.error("Error name:", error.name);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    console.error("Error code:", error.code);
    console.error("Error keyValue:", error.keyValue);
    
    if (error.code === 11000) {
      console.log("Returning duplicate order number response");
      return res.status(400).json({
        success: false,
        message: "Order number already exists",
      });
    }

    if (error.name === "ValidationError") {
      console.log("Returning ValidationError response");
      return handleError(res, error);
    }
    
    console.log("Returning 500 Server error response");
    return handleError(res, error);
  }
};

const getAllOrders = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      status, 
      paymentStatus,
      orderType,
      customerId,
      tableId,
      startDate,
      endDate,
      search,
    } = req.query;

    const query = {};

    if (status) query.orderStatus = status;
    if (paymentStatus) query.paymentStatus = paymentStatus;
    if (orderType) query.orderType = orderType;
    if (customerId) query.customer = customerId;
    if (tableId) query.table = tableId;
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [
        { orderNumber: regex },
        { customerName: regex },
        { customerPhone: regex },
        { invoiceNumber: regex },
      ];
    }

    const { page: safePage, limit: safeLimit, skip } = parsePagination(req.query, 20);

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate("customer", "name phone email")
        .populate("table", "number zone")
        .populate("createdBy", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      Order.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      orders,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    });
  } catch (error) {
    console.log("GET ORDERS ERROR:", error.message);
    return handleError(res, error);
  }
};

const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id)
      .populate("customer", "name phone email addresses loyaltyPoints loyaltyTier")
      .populate("table", "number zone capacity")
      .populate("createdBy", "name")
      .populate("updatedBy", "name")
      .populate("servedBy", "name")
      .lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const payments = await Order.populate(order, { path: "payments" });

    return res.status(200).json({
      success: true,
      order,
    });
  } catch (error) {
    console.log("GET ORDER ERROR:", error);
    return handleError(res, error);
  }
};

const getKitchenOrders = async (req, res) => {
  try {
    const orders = await Order.getKitchenOrders();
    
    const groupedOrders = {
      pending: orders.filter((order) => ["pending", "confirmed"].includes(order.orderStatus)),
      preparing: orders.filter((order) => order.orderStatus === "preparing"),
      ready: orders.filter((order) => order.orderStatus === "ready"),
    };

    return res.status(200).json({
      success: true,
      count: orders.length,
      orders,
      groupedOrders,
    });
  } catch (error) {
    console.log("GET KITCHEN ORDERS ERROR:", error.message);
    return handleError(res, error);
  }
};

const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { orderStatus } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order id",
      });
    }

    if (!orderStatus) {
      return res.status(400).json({
        success: false,
        message: "orderStatus is required",
      });
    }

    const normalizedStatus = String(orderStatus).toLowerCase().trim();

    if (!ALLOWED_ORDER_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: `Order status must be one of: ${ALLOWED_ORDER_STATUSES.join(", ")}`,
      });
    }

    const existingOrder = await Order.findById(id);
    if (!existingOrder) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (req.user.role === "delivery") {
      if (existingOrder.orderType !== "delivery") {
        return res.status(403).json({
          success: false,
          message: "Delivery users can only update delivery orders",
        });
      }
      if (!existingOrder.assignedTo || existingOrder.assignedTo.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: "You are not assigned to this delivery",
        });
      }
      const allowedNext = DELIVERY_ALLOWED_TRANSITIONS[existingOrder.orderStatus] || [];
      if (!allowedNext.includes(normalizedStatus)) {
        return res.status(403).json({
          success: false,
          message:
            allowedNext.length > 0
              ? `Delivery users can only change this order from ${existingOrder.orderStatus} to ${allowedNext.join(", ")}`
              : `This order is ${existingOrder.orderStatus} and cannot be advanced by a delivery user`,
        });
      }
    }

    if (!existingOrder.canTransitionTo(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot change order status from ${existingOrder.orderStatus} to ${normalizedStatus}`,
      });
    }

    const updatedOrder = await existingOrder.transitionTo(normalizedStatus, req.user._id);

    if (["cancelled", "refunded"].includes(normalizedStatus)) {
      try {
        await createNotificationForAdmins({
          type: "order",
          title: normalizedStatus === "refunded" ? "Order Refunded" : "Order Cancelled",
          message: updatedOrder.orderNumber,
          link: "/",
          entityId: updatedOrder._id,
        });
      } catch (notifyError) {
        console.error("STATUS NOTIFICATION ERROR:", notifyError.message);
      }
    }

    // Ensure a paid Payment record exists once an order is actually collected
    // (covers COD and any order settled via status update). Existing records
    // for cash/card/wallet/split are left untouched - no duplicates.
    if (["paid", "completed"].includes(normalizedStatus)) {
      try {
        await Payment.ensurePaid({
          order: updatedOrder._id,
          customer: updatedOrder.customer || null,
          amount: updatedOrder.total,
          method: updatedOrder.paymentMethod,
          gateway: updatedOrder.paymentGateway || "manual",
          collectedBy: req.user._id,
        });
      } catch (paymentError) {
        console.error("PAYMENT RECORD SYNC FAILED:", paymentError);
      }
    }

    // Deduct inventory when order is confirmed or paid
    if (["confirmed", "paid"].includes(normalizedStatus)) {
      try {
        await deductInventoryForOrder(updatedOrder, req.user._id);
      } catch (inventoryError) {
        console.error("INVENTORY DEDUCTION FAILED:", inventoryError);
        // Don't fail the order status update if inventory deduction fails
      }
    }

    // Restore inventory when order is cancelled or refunded
    if (["cancelled", "refunded"].includes(normalizedStatus)) {
      try {
        await restoreInventoryForOrder(updatedOrder, req.user._id);
      } catch (inventoryError) {
        console.error("INVENTORY RESTORE FAILED:", inventoryError);
        // Don't fail the order status update if inventory restoration fails
      }
    }

    if (updatedOrder.table && ["paid", "completed", "cancelled", "refunded"].includes(normalizedStatus)) {
      await Table.findByIdAndUpdate(updatedOrder.table, { 
        status: "cleaning", 
        currentOrder: null 
      });
    }

    if (["preparing", "ready", "served"].includes(normalizedStatus) && updatedOrder.table) {
      await Table.findByIdAndUpdate(updatedOrder.table, { status: "occupied" });
    }

    const populatedOrder = await Order.findById(updatedOrder._id)
      .populate("customer", "name phone")
      .populate("table", "number zone")
      .populate("updatedBy", "name")
      .lean();

    return res.status(200).json({
      success: true,
      message: "Order status updated successfully",
      order: populatedOrder,
    });
  } catch (error) {
    console.log("UPDATE ORDER STATUS ERROR:", error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Duplicate order or invoice number",
      });
    }
    if (error.name === "ValidationError") {
      return handleError(res, error);
    }
    return handleError(res, error);
  }
};

const ALLOWED_KITCHEN_STATUSES = ["pending", "preparing", "ready", "served"];

const updateItemKitchenStatus = async (req, res) => {
  try {
    const { id, itemIndex } = req.params;
    const { kitchenStatus } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order id",
      });
    }

    const normalizedStatus = String(kitchenStatus || "").toLowerCase().trim();

    if (!ALLOWED_KITCHEN_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: `kitchenStatus must be one of: ${ALLOWED_KITCHEN_STATUSES.join(", ")}`,
      });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const index = Number(itemIndex);
    if (!Number.isInteger(index) || index < 0 || index >= order.items.length) {
      return res.status(400).json({
        success: false,
        message: "Invalid item index",
      });
    }

    const item = order.items[index];
    item.kitchenStatus = normalizedStatus;
    item.servedAt = normalizedStatus === "served" ? new Date() : null;

    order.markModified("items");
    await order.save();

    const populatedOrder = await Order.findById(order._id)
      .populate("customer", "name phone")
      .populate("table", "number zone")
      .populate("updatedBy", "name")
      .lean();

    return res.status(200).json({
      success: true,
      message: "Item kitchen status updated",
      order: populatedOrder,
    });
  } catch (error) {
    console.log("UPDATE ITEM KITCHEN STATUS ERROR:", error);
    return handleError(res, error);
  }
};

const updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      customerName, 
      customerPhone, 
      customerEmail, 
      notes, 
      internalNotes,
      deliveryAddress,
      pickupAt,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order id",
      });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (["paid", "completed", "cancelled", "refunded"].includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: "Cannot modify completed or cancelled order",
      });
    }

    if (customerName) order.customerName = customerName.trim();
    if (customerPhone !== undefined) order.customerPhone = customerPhone.trim();
    if (customerEmail !== undefined) order.customerEmail = customerEmail.trim().toLowerCase();
    if (notes !== undefined) order.notes = notes.trim();
    if (internalNotes !== undefined) order.internalNotes = internalNotes.trim();
    if (deliveryAddress !== undefined) order.deliveryAddress = deliveryAddress;
    if (pickupAt !== undefined) order.pickupAt = pickupAt ? new Date(pickupAt) : null;
    order.updatedBy = req.user._id;

    await order.save();

    const populatedOrder = await Order.findById(order._id)
      .populate("customer", "name phone email")
      .populate("table", "number zone")
      .populate("updatedBy", "name")
      .lean();

    return res.status(200).json({
      success: true,
      message: "Order updated successfully",
      order: populatedOrder,
    });
  } catch (error) {
    console.log("UPDATE ORDER ERROR:", error);
    return handleError(res, error);
  }
};

const addItemsToOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { items } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order id",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Items array is required",
      });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (["paid", "completed", "cancelled", "refunded"].includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: "Cannot modify completed or cancelled order",
      });
    }

    for (const item of items) {
      if (!item.name || item.price == null || item.qty == null) {
        return res.status(400).json({
          success: false,
          message: "Each item must have name, price and qty",
        });
      }
    }

    const cleanItems = items.map((item) => ({
      name: String(item.name).trim(),
      price: Number(item.price),
      qty: Number(item.qty),
      menuItemId: item.menuItemId || null,
      category: item.category || "",
      isVeg: item.isVeg !== undefined ? item.isVeg : true,
      taxRate: item.taxRate || 0,
      modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
      size: (item.size && String(item.size).trim()) || extractItemSize(item.modifiers),
      notes: item.notes?.trim() || "",
    }));

    order.items.push(...cleanItems);
    
    const subtotal = order.items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const { totalTax } = await calculateTax(subtotal - order.discount, order.items, false);
    const serviceCharge = await calculateServiceCharge(subtotal - order.discount);
    
    order.subtotal = subtotal;
    order.tax = totalTax;
    order.total = Math.round(subtotal - order.discount + totalTax + serviceCharge + order.deliveryFee);
    order.updatedBy = req.user._id;

    await order.save();

    const populatedOrder = await Order.findById(order._id)
      .populate("customer", "name phone")
      .populate("table", "number zone")
      .populate("updatedBy", "name")
      .lean();

    return res.status(200).json({
      success: true,
      message: "Items added to order",
      order: populatedOrder,
    });
  } catch (error) {
    console.log("ADD ITEMS TO ORDER ERROR:", error);
    return handleError(res, error);
  }
};

const removeItemFromOrder = async (req, res) => {
  try {
    const { id, itemIndex } = req.params;
    const index = parseInt(itemIndex);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order id",
      });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (["paid", "completed", "cancelled", "refunded"].includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: "Cannot modify completed or cancelled order",
      });
    }

    if (index < 0 || index >= order.items.length) {
      return res.status(400).json({
        success: false,
        message: "Invalid item index",
      });
    }

    order.items.splice(index, 1);
    
    if (order.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Order must have at least one item",
      });
    }

    const subtotal = order.items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const { totalTax } = await calculateTax(subtotal - order.discount, order.items, false);
    const serviceCharge = await calculateServiceCharge(subtotal - order.discount);
    
    order.subtotal = subtotal;
    order.tax = totalTax;
    order.total = Math.round(subtotal - order.discount + totalTax + serviceCharge + order.deliveryFee);
    order.updatedBy = req.user._id;

    await order.save();

    const populatedOrder = await Order.findById(order._id)
      .populate("customer", "name phone")
      .populate("table", "number zone")
      .populate("updatedBy", "name")
      .lean();

    return res.status(200).json({
      success: true,
      message: "Item removed from order",
      order: populatedOrder,
    });
  } catch (error) {
    console.log("REMOVE ITEM FROM ORDER ERROR:", error);
    return handleError(res, error);
  }
};

const cancelOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order id",
      });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (["cancelled", "refunded"].includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: "Order is already cancelled",
      });
    }

    if (order.paymentStatus === "paid" && !["admin"].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Paid orders can only be cancelled by admin",
      });
    }

    await order.transitionTo("cancelled", req.user._id);
    order.cancellationReason = reason?.trim() || "";
    await order.save();

    try {
      await createNotificationForAdmins({
        type: "order",
        title: "Order Cancelled",
        message: `${order.orderNumber}${order.cancellationReason ? ` · ${order.cancellationReason}` : ""}`,
        link: "/",
        entityId: order._id,
      });
    } catch (notifyError) {
      console.error("CANCEL NOTIFICATION ERROR:", notifyError.message);
    }

    // Restore inventory for cancelled order
    try {
      await restoreInventoryForOrder(order, req.user._id);
    } catch (inventoryError) {
      console.error("INVENTORY RESTORE FAILED:", inventoryError);
    }

    if (order.table) {
      await Table.findByIdAndUpdate(order.table, { status: "free", currentOrder: null });
    }

    if (order.customer && (order.loyaltyPointsEarned > 0 || order.loyaltyPointsUsed > 0)) {
      const customer = await Customer.findById(order.customer);
      if (customer) {
        customer.loyaltyPoints = Math.max(0, customer.loyaltyPoints - order.loyaltyPointsEarned + order.loyaltyPointsUsed);
        await customer.save();
      }
    }

    const populatedOrder = await Order.findById(order._id)
      .populate("customer", "name phone")
      .populate("table", "number zone")
      .lean();

    return res.status(200).json({
      success: true,
      message: "Order cancelled successfully",
      order: populatedOrder,
    });
  } catch (error) {
    console.log("CANCEL ORDER ERROR:", error);
    return handleError(res, error);
  }
};

const printKOT = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order id",
      });
    }

    const order = await Order.findById(id)
      .populate("table", "number zone")
      .populate("customer", "name phone");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    order.kotPrinted = true;
    order.kotPrintedAt = new Date();
    await order.save();

    return res.status(200).json({
      success: true,
      message: "KOT print triggered",
      order: {
        ...order,
        kotPrinted: true,
        kotPrintedAt: new Date(),
      },
    });
  } catch (error) {
    console.log("PRINT KOT ERROR:", error);
    return handleError(res, error);
  }
};

const printInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order id",
      });
    }

    const order = await Order.findById(id)
      .populate("customer", "name phone email addresses")
      .populate("table", "number zone")
      .populate("createdBy", "name");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    order.invoicePrinted = true;
    order.invoicePrintedAt = new Date();
    await order.save();

    return res.status(200).json({
      success: true,
      message: "Invoice print triggered",
      order: {
        ...order,
        invoicePrinted: true,
        invoicePrintedAt: new Date(),
      },
    });
  } catch (error) {
    console.log("PRINT INVOICE ERROR:", error);
    return handleError(res, error);
  }
};

module.exports = {
  createOrder,
  getAllOrders,
  getOrderById,
  getKitchenOrders,
  updateOrderStatus,
  updateItemKitchenStatus,
  updateOrder,
  addItemsToOrder,
  removeItemFromOrder,
  cancelOrder,
  printKOT,
  printInvoice,
  calculateTax,
  calculateServiceCharge,
  applyCoupon,
};