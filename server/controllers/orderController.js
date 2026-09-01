const mongoose = require("mongoose");
const Order = require("../models/Order");
const User = require("../models/User");
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
const OrderEditHistory = require("../models/OrderEditHistory");
const Notification = require("../models/Notification");
const { handleError } = require("../utils/httpError");
const { createNotificationForAdmins } = require("../utils/notificationService");
const { parsePagination } = require("../utils/pagination");
const thermalPrinter = require("../services/thermalPrinter");
const WebPushService = require("../services/webPush");
const { calculateDeliveryFee, getBaseDeliveryFee } = require("../utils/delivery");

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

const applyCoupon = async (code, orderAmount, orderType, customerId, context = "pos", items = []) => {
  const result = await Coupon.findValidForOrder(code, orderAmount, orderType, customerId, context);
  const coupon = result.coupon;
  if (!coupon) return { discount: 0, coupon: null, reason: result.reason };

  // Public/online orders must clear the admin-configurable bulk-order promo
  // floor. In-store (POS) coupons are not subject to this restriction.
  if (context === "online") {
    const { checkPromoFloor } = require("../utils/promo");
    const floor = await checkPromoFloor(orderAmount);
    if (!floor.eligible) {
      return { discount: 0, coupon: null, reason: floor.reason };
    }
  }

  const discount = coupon.calculateDiscount(orderAmount, items);
  return { discount, coupon, reason: null };
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
      if (!ingredient.item) continue;
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
          if (!ingredient.item) continue;
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
          if (!ingredient.item) continue;
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
      servedBy,
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
      const couponContext = req.body.source === "online" ? "online" : "pos";
      const result = await applyCoupon(couponCode, subtotal, orderType, customer?._id, couponContext, cleanItems);
      couponDiscount = result.discount;
      appliedCoupon = result.coupon;
      console.log("Coupon result:", { couponDiscount, appliedCoupon: !!appliedCoupon });

      // Public website orders must revalidate the coupon at order creation. If
      // the customer submitted a coupon that no longer passes server-side
      // validation (expired, usage limit reached, minimum not met, etc.), reject
      // rather than silently charge full price. The discount is ALWAYS computed
      // here from `couponDiscount`/`result.discount`; the client-sent discount
      // is never trusted.
      if (couponContext === "online" && !appliedCoupon) {
        return res.status(400).json({
          success: false,
          message: result.reason || "The coupon is no longer valid",
        });
      }
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
    // Dine-in cash is auto-paid at the counter on creation; Takeaway/Delivery
    // cash requires an explicit "Mark Cash Paid" confirmation later, so it is
    // created as "pending" (but operationally confirmed). Card/wallet/split
    // remain instant-paid as before.
    const isDineinCash = orderType === "dinein" && paymentMethod === "cash";
    const isInstantPaid = ["card", "wallet"].includes(paymentMethod) || isDineinCash;
    const isSplit = paymentMethod === "split";
    const isCOD = paymentMethod === "cod" && orderType === "delivery";
    // UPI and COD are never settled at creation: only instant-paid methods
    // (card/wallet/dine-in cash) and split payments create paid + confirmed
    // orders. UPI stays pending until the Cashfree verify/webhook path succeeds.
    const isPaidOnCreate = isInstantPaid || isSplit;
    const isCashNonDinein = paymentMethod === "cash" && orderType !== "dinein";
    const startConfirmed = isPaidOnCreate || isCashNonDinein;
    // Takeaway/Delivery cash is created operationally confirmed, so inventory
    // must still be reserved/deducted at creation even though payment is pending.
    const deductOnCreate = isPaidOnCreate || isCashNonDinein;
    console.log("Payment check:", { isInstantPaid, isSplit, isCOD, paymentMethod, orderType, isPaidOnCreate, isCashNonDinein, startConfirmed, deductOnCreate });

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

    // Validate an explicitly selected waiter (only for dine-in). We never infer
    // the waiter from createdBy; createdBy remains the authenticated user.
    let validatedServedBy = null;
    if (servedBy) {
      const WAITER_ROLES = ["waiter"];
      const waiterUser = await User.findById(servedBy);
      if (!waiterUser || !WAITER_ROLES.includes(waiterUser.role)) {
        console.log("VALIDATION FAILED: Invalid waiter selected", servedBy);
        return res.status(400).json({
          success: false,
          message: "Invalid waiter selected",
        });
      }
      validatedServedBy = waiterUser._id;
    }

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
      orderStatus: startConfirmed ? "confirmed" : "pending",
      deliveryAddress,
      deliveryFee: Number(deliveryFee) || 0,
      pickupAt: pickupAt ? new Date(pickupAt) : null,
      notes: notes?.trim() || "",
      source,
      servedBy: validatedServedBy,
      createdBy: req.user._id,
    });
    console.log("Order created:", order._id, "orderNumber:", order.orderNumber);

    // Deduct inventory for orders that consume stock at creation (instant-paid
    // orders and Takeaway/Delivery cash, which starts confirmed) before applying
    // any other side effects (table, loyalty, coupon, payment). If the deduction
    // fails after the availability pre-check (e.g. a concurrent order consumed
    // the stock), reject cleanly and remove the just-created order so no partial
    // state (order/payment/table/loyalty/coupon) is left behind.
    if (deductOnCreate) {
      console.log("Deducting inventory for order at creation");
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

    // Send push notification to POS devices (non-blocking)
    WebPushService.sendNewOrderNotification(order).catch(err => {
      console.error('Push notification failed:', err.message);
    });

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
        .populate("servedBy", "name")
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

    // A partial order (additional payment due after an edit) must be settled
    // before it can be marked completed — otherwise the extra amount would be
    // silently lost.
    if (normalizedStatus === "completed" && (Number(existingOrder.additionalAmountDue) || 0) > 0) {
      return res.status(400).json({
        success: false,
        message: `Order has ₹${Number(existingOrder.additionalAmountDue).toLocaleString("en-IN")} additional payment due. Collect it before completing the order.`,
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

    const servedAt = normalizedStatus === "served" ? new Date() : null;

    // Use atomic updateOne to avoid re-validating malformed legacy items
    await Order.updateOne(
      { _id: id },
      {
        $set: {
          [`items.${index}.kitchenStatus`]: normalizedStatus,
          [`items.${index}.servedAt`]: servedAt,
          updatedAt: new Date(),
        },
      }
    );

    const populatedOrder = await Order.findById(id)
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
    const cancellationReason = reason?.trim() || "";
    await Order.updateOne({ _id: order._id }, { $set: { cancellationReason, updatedAt: new Date() } });
    order.cancellationReason = cancellationReason;

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
      .populate("customer", "name phone")
      .populate("servedBy", "name");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const thermal = { ok: false };
    const target = await thermalPrinter.getThermalTarget();
    if (target) {
      try {
        await thermalPrinter.printKOT(order);
        thermal.ok = true;
        order.kotPrinted = true;
        order.kotPrintedAt = new Date();
        await order.save();
      } catch (err) {
        thermal.ok = false;
        thermal.error = err.message;
      }
    } else {
      thermal.error = "Thermal printer not configured (enable it and set a valid LAN IP, e.g. 192.168.1.50)";
    }

    return res.status(200).json({
      success: true,
      message: thermal.ok ? "KOT sent to thermal printer" : `KOT not printed via thermal: ${thermal.error || ""}`,
      thermalPrint: thermal,
      order: {
        ...order.toObject(),
        kotPrinted: order.kotPrinted,
        kotPrintedAt: order.kotPrintedAt,
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
      .populate("createdBy", "name")
      .populate("servedBy", "name");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const thermal = { ok: false };
    const target = await thermalPrinter.getThermalTarget();
    if (target) {
      try {
        await thermalPrinter.printInvoice(order);
        thermal.ok = true;
        order.invoicePrinted = true;
        order.invoicePrintedAt = new Date();
        await order.save();
      } catch (err) {
        thermal.ok = false;
        thermal.error = err.message;
      }
    } else {
      thermal.error = "Thermal printer not configured (enable it and set a valid LAN IP, e.g. 192.168.1.50)";
    }

    return res.status(200).json({
      success: true,
      message: thermal.ok ? "Invoice sent to thermal printer" : `Invoice not printed via thermal: ${thermal.error || ""}`,
      thermalPrint: thermal,
      order: {
        ...order.toObject(),
        invoicePrinted: order.invoicePrinted,
        invoicePrintedAt: order.invoicePrintedAt,
      },
    });
  } catch (error) {
    console.log("PRINT INVOICE ERROR:", error);
    return handleError(res, error);
  }
};

// Explicitly confirm cash collected for an order whose payment is "pending"
// (Takeaway/Delivery cash). This ONLY changes paymentStatus/paidAt and NEVER
// orderStatus, so the order stays operationally confirmed/preparing/etc.
// Atomic claim makes it idempotent and race-safe: exactly one concurrent
// request becomes the owner that calls Payment.ensurePaid.
const markOrderPaid = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order id",
      });
    }

    const existing = await Order.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (existing.paymentMethod !== "cash") {
      return res.status(400).json({
        success: false,
        message: "Only cash orders can be marked paid through this endpoint",
      });
    }

    if (["cancelled", "refunded"].includes(existing.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: "Cannot mark a cancelled or refunded order as paid",
      });
    }

    // Atomically claim the unpaid order so two concurrent requests cannot
    // both create a payment record. Only the winner proceeds to settle.
    const claimed = await Order.findOneAndUpdate(
      { _id: id, paymentStatus: { $ne: "paid" } },
      { $set: { paymentStatus: "paid", paidAt: new Date() } },
      { new: true }
    );

    if (!claimed) {
      // Already paid (or claimed by a concurrent request). Return idempotently
      // WITHOUT creating another Payment record.
      const alreadyPaid = await Order.findById(id)
        .populate("customer", "name phone email addresses")
        .populate("table", "number zone")
        .populate("createdBy", "name")
        .populate("servedBy", "name")
        .lean();
      return res.status(200).json({
        success: true,
        message: "Order already paid",
        order: alreadyPaid,
      });
    }

    try {
      await Payment.ensurePaid({
        order: claimed._id,
        customer: claimed.customer || null,
        amount: claimed.total,
        method: "cash",
        gateway: "manual",
        collectedBy: req.user._id,
        collectedAt: new Date(),
      });
    } catch (paymentError) {
      console.error("MARK CASH PAID - PAYMENT RECORD SYNC FAILED:", paymentError);
    }

    const populatedOrder = await Order.findById(claimed._id)
      .populate("customer", "name phone email addresses")
      .populate("table", "number zone")
      .populate("createdBy", "name")
      .populate("servedBy", "name")
      .lean();

    return res.status(200).json({
      success: true,
      order: populatedOrder,
    });
  } catch (error) {
    console.log("MARK ORDER PAID ERROR:", error);
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------------------
// Edit existing order (safe, server-authoritative)
// ---------------------------------------------------------------------------
//
// The frontend never sends financial values for an edit. It only sends the
// desired `items` (menuItemId + qty + size/addons/notes) and an optional
// `reason`. Every price, tax, charge and total is recomputed server-side from
// the current menu data using the exact same calculation helpers as order
// creation. The original order _id/orderNumber/customer/table/orderType/
// servedBy are preserved so public tracking and kitchen polling keep working.

const EDITABLE_ORDER_STATUSES = ["pending", "confirmed", "preparing", "paid"];
const NON_EDITABLE_ORDER_STATUSES = [
  "ready",
  "served",
  "out_for_delivery",
  "delivered",
  "completed",
  "cancelled",
  "refunded",
];

const normalizeModifierKey = (value) => String(value || "").toLowerCase().trim();

// Validates one requested item against the current menu and returns a clean
// item whose price/size/addons/tax/veg/category are all taken from the menu,
// never from the request.
const validateEditItem = async (item) => {
  if (!item || !item.menuItemId || !mongoose.Types.ObjectId.isValid(item.menuItemId)) {
    const err = new Error("Each item must reference a valid menu item");
    err.statusCode = 400;
    throw err;
  }

  const menuItem = await MenuItem.findById(item.menuItemId);
  if (!menuItem) {
    const err = new Error("Menu item not found");
    err.statusCode = 400;
    throw err;
  }
  if (!menuItem.isAvailable) {
    const err = new Error(`${menuItem.name} is not currently available`);
    err.statusCode = 400;
    throw err;
  }

  const qty = Number(item.qty);
  if (!Number.isInteger(qty) || qty < 1) {
    const err = new Error(`Quantity for ${menuItem.name} must be a whole number greater than zero`);
    err.statusCode = 400;
    throw err;
  }

  const menuGroups = (menuItem.modifiers || []).map((group) => ({
    key: normalizeModifierKey(group.name),
    name: group.name,
    required: !!group.required,
    multiSelect: !!group.multiSelect,
    minSelections: Number(group.minSelections) || 0,
    maxSelections: Number.isFinite(Number(group.maxSelections)) ? Number(group.maxSelections) : 1,
    options: (group.options || []).map((o) => ({ name: o.name, price: Number(o.price) || 0 })),
  }));

  const requestedMods = Array.isArray(item.modifiers) ? item.modifiers : [];
  const cleanMods = [];
  const selectedCountByGroup = new Map();

  for (const mod of requestedMods) {
    const groupKey = normalizeModifierKey(mod.name);
    const group = menuGroups.find((g) => g.key === groupKey);
    if (!group) {
      const err = new Error(`Invalid modifier "${mod.name}" for ${menuItem.name}`);
      err.statusCode = 400;
      throw err;
    }
    const option = group.options.find(
      (o) => normalizeModifierKey(o.name) === normalizeModifierKey(mod.option)
    );
    if (!option) {
      const err = new Error(`Invalid option "${mod.option}" for modifier "${group.name}"`);
      err.statusCode = 400;
      throw err;
    }
    selectedCountByGroup.set(group.name, (selectedCountByGroup.get(group.name) || 0) + 1);
    cleanMods.push({ name: group.name, option: option.name, price: option.price });
  }

  for (const group of menuGroups) {
    const selected = selectedCountByGroup.get(group.name) || 0;
    const min = group.required ? Math.max(group.minSelections, 1) : group.minSelections;
    if (group.required && selected < min) {
      const err = new Error(`${menuItem.name}: "${group.name}" is required`);
      err.statusCode = 400;
      throw err;
    }
    if (selected > group.maxSelections) {
      const err = new Error(`${menuItem.name}: too many selections for "${group.name}"`);
      err.statusCode = 400;
      throw err;
    }
    if (!group.multiSelect && selected > 1) {
      const err = new Error(`${menuItem.name}: choose only one option for "${group.name}"`);
      err.statusCode = 400;
      throw err;
    }
  }

  const sizeMod = cleanMods.find((m) => SIZE_MODIFIER_PATTERN.test(m.name));
  const modifierPrice = cleanMods.reduce((sum, m) => sum + (Number(m.price) || 0), 0);
  const price = Math.round(((Number(menuItem.price) || 0) + modifierPrice) * 100) / 100;

  return {
    name: menuItem.name,
    price,
    qty,
    menuItemId: menuItem._id,
    category: menuItem.category ? String(menuItem.category) : "",
    isVeg: menuItem.isVeg !== undefined ? menuItem.isVeg : true,
    taxRate: menuItem.taxRate || 0,
    modifiers: cleanMods,
    size: (sizeMod && sizeMod.option) || (item.size && String(item.size).trim()) || "",
    notes: typeof item.notes === "string" ? item.notes.slice(0, 500) : "",
    // Addon display no longer needs price handling here: price was recomputed
    // from the menu. Keep sizeAddonsPrice 0 so no legacy aggregation breaks.
    sizeAddonsPrice: 0,
    kitchenStatus: "pending",
    kitchenStation: "",
    servedAt: null,
  };
};

// Signature used to match unchanged items so kitchen lifecycle state (status,
// station, servedAt) and notes survive an edit for items that did not change.
const itemSignature = (item) => {
  const mods = (item.modifiers || [])
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
    .map((m) => `${m.name}:${m.option}`)
    .join("|");
  return `${String(item.menuItemId || "")}|${String(item.size || "")}|${mods}|${Number(item.qty) || 0}`;
};

const carryKitchenState = (oldItems, newItems) => {
  const pool = new Map();
  for (const oldItem of oldItems || []) {
    const key = itemSignature(oldItem);
    if (!pool.has(key)) pool.set(key, []);
    pool.get(key).push(oldItem);
  }

  return newItems.map((newItem) => {
    const key = itemSignature(newItem);
    const match = (pool.get(key) || []).shift();
    if (!match) return newItem;
    return {
      ...newItem,
      kitchenStatus: match.kitchenStatus || "pending",
      kitchenStation: match.kitchenStation || "",
      servedAt: match.servedAt || null,
      notes: newItem.notes || match.notes || "",
      kitchenStatusUnchanged: true,
    };
  });
};

// Total amount already collected for an order, derived from the paid Payment
// ledger (the single source of truth). Falls back to the previous order total
// only when the order claims to be paid but no ledger row exists (legacy data).
const getPaidAmount = async (order) => {
  const paidRecords = await Payment.find({ order: order._id, status: "paid" });
  if (paidRecords.length > 0) {
    return Math.round(paidRecords.reduce((sum, r) => sum + (Number(r.amount) || 0), 0) * 100) / 100;
  }
  if (order.paymentStatus === "paid") {
    return Math.round((Number(order.total) || 0) * 100) / 100;
  }
  return 0;
};

const flattenItemForAudit = (item) => ({
  name: item.name,
  price: Number(item.price) || 0,
  qty: Number(item.qty) || 0,
  menuItemId: item.menuItemId || null,
  size: item.size ? String(item.size) : "",
  modifiers: Array.isArray(item.modifiers)
    ? item.modifiers.map((m) => ({ name: m.name, option: m.option, price: Number(m.price) || 0 }))
    : [],
  notes: item.notes || "",
});

// Reconcile inventory by the NET difference between the old and new order item
// sets. Only applies when stock was already deducted for the order; otherwise
// the normal status-transition deduction handles the final set. Incorrect
// double-deduction is prevented because no per-item deduction happens here —
// every affected inventory row moves by (newQty - oldQty) in one pass.
// Compute the net per-inventory-item delta implied by an item-set edit. Pure
// calculation (no writes) so the caller can run the availability pre-check
// BEFORE persisting anything — a shortage must never leave a half-saved edit.
const computeInventoryDeltasForEdit = async (oldItems, newItems) => {
  const oldQty = new Map();
  const newQty = new Map();
  for (const it of oldItems || []) {
    if (it.menuItemId) oldQty.set(String(it.menuItemId), (oldQty.get(String(it.menuItemId)) || 0) + it.qty);
  }
  for (const it of newItems || []) {
    if (it.menuItemId) newQty.set(String(it.menuItemId), (newQty.get(String(it.menuItemId)) || 0) + it.qty);
  }

  const menuIds = new Set([...oldQty.keys(), ...newQty.keys()]);
  const inventoryDeltas = new Map();

  for (const menuId of menuIds) {
    const recipe = await Recipe.getByMenuItem(menuId);
    if (!recipe || !recipe.isActive) continue;

    const deltaQty = (newQty.get(menuId) || 0) - (oldQty.get(menuId) || 0);
    if (deltaQty === 0) continue;

    for (const ingredient of recipe.ingredients) {
      if (!ingredient.item || !ingredient.item._id) continue;
      const inventoryItem = await InventoryItem.findById(ingredient.item._id);
      if (!inventoryItem) continue;

      // adjustStock(quantity) MOVES currentStock BY quantity: negative consumes,
      // positive restores. An edit that adds items (deltaQty > 0) must consume
      // the extra portion, so the adjustment is the inverse of deltaQty.
      const delta = -deltaQty * (Number(ingredient.quantity) || 0);
      if (delta === 0) continue;

      const key = String(inventoryItem._id);
      const entry = inventoryDeltas.get(key) || { inventoryItem, delta: 0 };
      entry.delta += delta;
      inventoryDeltas.set(key, entry);
    }
  }

  return inventoryDeltas;
};

// Apply previously pre-checked inventory deltas as a single net adjustment per
// inventory item (never a double-deduction of unchanged portions). Best-effort,
// matching the existing deduct/restore tolerance: failures are logged, not
// thrown, because the order save already succeeded and financial correctness is
// unaffected.
const applyInventoryDeltasForEdit = async (order, inventoryDeltas, userId) => {
  for (const { inventoryItem, delta } of inventoryDeltas.values()) {
    const movement = await inventoryItem.adjustStock(
      delta,
      `Order ${order.orderNumber} edited: net ${delta > 0 ? "+" : ""}${delta}`,
      order._id,
      "order_edit",
      userId
    );
    await StockMovement.create({ ...movement, createdBy: userId });
  }
  return inventoryDeltas.size;
};

const editOrderItems = async (req, res) => {
  const fail = (status, message) => res.status(status).json({ success: false, message });

  try {
    const { id } = req.params;
    const { items, reason, baseUpdatedAt } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return fail(400, "Invalid order id");
    }

    if (!Array.isArray(items) || items.length === 0) {
      return fail(400, "Items are required");
    }

    const order = await Order.findById(id);
    if (!order) {
      return fail(404, "Order not found");
    }

    if (NON_EDITABLE_ORDER_STATUSES.includes(order.orderStatus)) {
      return fail(400, `Cannot edit an order that is ${order.orderStatus}`);
    }
    if (!EDITABLE_ORDER_STATUSES.includes(order.orderStatus)) {
      return fail(400, `Cannot edit an order in status ${order.orderStatus}`);
    }

    const cleanItems = [];
    for (const item of items) {
      cleanItems.push(await validateEditItem(item));
    }

    const oldItems = order.items || [];
    const finalItems = carryKitchenState(oldItems, cleanItems);

    if (finalItems.length === 0) {
      return fail(400, "Order must have at least one item");
    }

    // Server-side financial recalculation — every value below is derived from
    // the current menu/settings, never accepted from the request.
    const subtotal = Math.round(
      finalItems.reduce((sum, item) => sum + item.price * item.qty, 0) * 100
    ) / 100;

    // The previously applied discount amount is preserved as a flat rupee value
    // so the customer's effective discount never grows during a staff edit.
    // The original coupon/percent metadata is not reused against the new total.
    const totalDiscount = Math.min(Number(order.discount) || 0, subtotal);

    const isInterState =
      order.deliveryAddress &&
      order.deliveryAddress.state &&
      order.deliveryAddress.state !== (await Settings.getValue("restaurant_state", ""));

    const { cgst, sgst, igst, totalTax } = await calculateTax(
      subtotal - totalDiscount,
      finalItems,
      isInterState
    );
    const serviceCharge = await calculateServiceCharge(subtotal - totalDiscount);

    // Delivery fee is distance-based and untouched by an item edit. Recompute
    // it only from the stored address distance when available; otherwise keep
    // the existing charged fee exactly as-is (delivery-fee rules unchanged).
    let deliveryFee = Math.round((Number(order.deliveryFee) || 0) * 100) / 100;
    if (order.orderType === "delivery" && order.deliveryAddress && order.deliveryAddress.distanceKm) {
      const distanceKm = Number(order.deliveryAddress.distanceKm);
      const base = await getBaseDeliveryFee();
      deliveryFee = Math.max(base, calculateDeliveryFee(distanceKm));
    }

    const loyaltyPointsUsed = Number(order.loyaltyPointsUsed) || 0;
    let loyaltyPointsValue = 0;
    if (loyaltyPointsUsed > 0) {
      const loyaltyConfig = await LoyaltyConfig.getConfig();
      loyaltyPointsValue = loyaltyConfig.rupeePerPoint * loyaltyPointsUsed;
    }

    let total = subtotal - totalDiscount + totalTax + serviceCharge + deliveryFee - loyaltyPointsValue;
    total = Math.round(total * 100) / 100;
    const roundingAdjustment = Math.round(total) - total;
    total = Math.round(total);

    // Payment delta handling.
    const paidAmount = await getPaidAmount(order);
    const difference = Math.round((total - Number(order.total || 0)) * 100) / 100;

    let paymentStatus = order.paymentStatus;
    let additionalAmountDue = 0;
    let refundAmountDue = 0;

    if (paidAmount > 0) {
      if (total > paidAmount) {
        additionalAmountDue = Math.round((total - paidAmount) * 100) / 100;
        paymentStatus = "partial";
      } else {
        refundAmountDue = Math.round((paidAmount - total) * 100) / 100;
        paymentStatus = "paid";
      }
    } else {
      paymentStatus = "pending";
    }

    const updateData = {
      items: finalItems,
      subtotal,
      tax: totalTax,
      cgst,
      sgst,
      igst,
      serviceCharge,
      discount: totalDiscount,
      discountType: "flat",
      discountReason: order.discountReason || "",
      couponCode: null,
      total,
      roundingAdjustment,
      deliveryFee,
      loyaltyPointsUsed,
      paymentStatus,
      additionalAmountDue,
      refundAmountDue,
      updatedBy: req.user._id,
      updatedAt: new Date(),
    };

    // Inventory availability pre-check (net increases only) BEFORE any write.
    // A shortage here rejects the whole edit without touching the order or the
    // stock ledger, so stock can never be oversold by an item edit.
    let inventoryDeltas = new Map();
    if (order.inventoryDeducted) {
      inventoryDeltas = await computeInventoryDeltasForEdit(oldItems, finalItems);
      const shortages = [];
      for (const { inventoryItem, delta } of inventoryDeltas.values()) {
        if (delta < 0 && inventoryItem.currentStock < Math.abs(delta)) {
          shortages.push({
            name: inventoryItem.name,
            requiredQty: Math.abs(delta),
            availableQty: inventoryItem.currentStock,
          });
        }
      }
      if (shortages.length > 0) {
        const err = new Error(
          `Insufficient inventory: ${shortages
            .map((s) => `${s.name} (need ${s.requiredQty}, available ${s.availableQty})`)
            .join(", ")}`
        );
        err.statusCode = 400;
        throw err;
      }
    }

    // Optimistic concurrency: if the client supplied the order's updatedAt when
    // it opened the editor, only apply the write when the order has not been
    // touched by someone else since then.
    const filter = { _id: order._id };
    if (baseUpdatedAt) {
      filter.updatedAt = new Date(baseUpdatedAt);
    }

    const updated = await Order.findOneAndUpdate(filter, { $set: updateData }, { new: true });

    if (!updated) {
      return fail(
        409,
        "This order was modified by someone else. Reload it and review the latest items before saving again."
      );
    }

    let editHistory = null;
    try {
      editHistory = await OrderEditHistory.create({
        order: order._id,
        orderNumber: order.orderNumber,
        editedBy: req.user._id,
        previousItems: oldItems.map(flattenItemForAudit),
        newItems: finalItems.map(flattenItemForAudit),
        previousTotal: Math.round((Number(order.total) || 0) * 100) / 100,
        newTotal: total,
        difference,
        previousSubtotal: Math.round((Number(order.subtotal) || 0) * 100) / 100,
        newSubtotal: subtotal,
        paymentRequirement: additionalAmountDue,
        refundRequirement: refundAmountDue,
        reason: typeof reason === "string" ? reason.slice(0, 500) : "",
      });
    } catch (historyError) {
      console.error("ORDER EDIT HISTORY SAVE FAILED:", historyError.message);
    }

    // Apply inventory deltas (already pre-checked, net only). Best-effort:
    // a post-save apply failure is logged, not thrown — financial correctness
    // was fixed at save time and stock mismatches surface via the dashboard.
    let inventoryReconciled = false;
    if (order.inventoryDeducted && inventoryDeltas.size > 0) {
      try {
        await applyInventoryDeltasForEdit(updated, inventoryDeltas, req.user._id);
        inventoryReconciled = true;
      } catch (inventoryError) {
        console.error("ORDER EDIT INVENTORY RECONCILE FAILED:", inventoryError.message);
      }
    }

    try {
      await createNotificationForAdmins({
        type: "order",
        title: "Order Edited",
        message: `${updated.orderNumber} · previous ₹${Number(order.total || 0).toLocaleString("en-IN")} → ₹${total.toLocaleString("en-IN")}`,
        link: "/",
        entityId: updated._id,
      });
    } catch (notifyError) {
      console.error("ORDER EDIT NOTIFICATION ERROR:", notifyError.message);
    }

    const populatedOrder = await Order.findById(updated._id)
      .populate("customer", "name phone email")
      .populate("table", "number zone")
      .populate("updatedBy", "name")
      .lean();

    return res.status(200).json({
      success: true,
      message: "Order updated successfully",
      order: populatedOrder,
      edit: {
        previousTotal: Math.round((Number(order.total) || 0) * 100) / 100,
        newTotal: total,
        difference,
        paymentStatus,
        additionalAmountDue,
        refundAmountDue,
        inventoryReconciled,
      },
    });
  } catch (error) {
    console.log("EDIT ORDER ERROR:", error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    if (error.name === "ValidationError") {
      return handleError(res, error);
    }
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Duplicate order or invoice number" });
    }
    return handleError(res, error);
  }
};

// Collect an additional payment due (from an edit that increased a paid order).
// Manual (cash/card/wallet) path: staff records collection, idempotent atomic
// claim, ledger write mirrors the existing markOrderPaid pattern. The order is
// only marked fully paid when the ledger actually covers the new total.
const collectAdditionalPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      method = "cash",
      transactionId,
      notes,
    } = req.body;
    const ALLOWED_ADDITIONAL_METHODS = ["cash", "card", "wallet", "upi"];

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }
    if (!ALLOWED_ADDITIONAL_METHODS.includes(method)) {
      return res.status(400).json({
        success: false,
        message: `Additional payment method must be one of: ${ALLOWED_ADDITIONAL_METHODS.join(", ")}`,
      });
    }

    const order = await Order.findById(id);
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

    // Atomic claim so two concurrent requests cannot collect twice.
    const claimed = await Order.findOneAndUpdate(
      { _id: id, additionalAmountDue: { $gt: 0 }, additionalPaymentInProgress: { $ne: true } },
      { $set: { additionalPaymentInProgress: true, updatedAt: new Date() } },
      { new: true }
    );
    if (!claimed) {
      // Either already collected or another request is in progress.
      const latest = await Order.findById(id);
      const stillDue = Math.round((Number(latest?.additionalAmountDue) || 0) * 100) / 100;
      if (stillDue <= 0) {
        return res.status(200).json({ success: true, message: "Additional payment already collected", order: latest });
      }
      return res.status(409).json({
        success: false,
        message: "Another additional payment collection is already in progress",
      });
    }

    try {
      await Payment.create({
        order: claimed._id,
        customer: claimed.customer || null,
        amount: additional,
        method,
        gateway: "manual",
        status: "paid",
        transactionId: transactionId || `additional-${claimed.orderNumber}`,
        collectedBy: req.user._id,
        collectedAt: new Date(),
        notes: notes?.trim() || `Additional payment for edited order`,
        metadata: {
          additionalPayment: true,
          reason: "order_edit",
        },
      });

      const newPaidAmount = (await getPaidAmount(claimed)) + additional;
      const fullyPaid = newPaidAmount >= (Number(claimed.total) || 0);

      await Order.updateOne(
        { _id: claimed._id },
        {
          $set: {
            paymentStatus: fullyPaid ? "paid" : "partial",
            additionalAmountDue: fullyPaid ? 0 : Math.round((Number(claimed.total) - newPaidAmount) * 100) / 100,
            additionalPaymentInProgress: false,
            paidAt: fullyPaid ? new Date() : claimed.paidAt,
            updatedBy: req.user._id,
            updatedAt: new Date(),
          },
        }
      );
    } catch (paymentError) {
      console.error("ADDITIONAL PAYMENT COLLECT ERROR:", paymentError);
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
      message: "Additional payment collected",
      order: populatedOrder,
    });
  } catch (error) {
    console.log("COLLECT ADDITIONAL PAYMENT ERROR:", error);
    return handleError(res, error);
  }
};

// Internal helper to perform real business deletion for a single order.
// Wrapped in a MongoDB transaction so inventory reversal and all cleanups
// commit atomically. If any step fails, the entire deletion rolls back.
const performOrderDeletionTx = async (order, userId, session) => {
  const q = (query) => (session && query && typeof query.session === "function" ? query.session(session) : query);
  const doCreate = async (Model, doc) => {
    if (session) {
      const res = await Model.create([doc], { session });
      return res[0];
    }
    return Model.create(doc);
  };

  // Inventory reversal: if stock was deducted and not yet restored, restore it
  if (order.inventoryDeducted && !order.inventoryRestored) {
    for (const item of order.items || []) {
      if (!item.menuItemId) continue;
      const recipe = await Recipe.getByMenuItem(item.menuItemId);
      if (!recipe || !recipe.isActive) continue;
      for (const ingredient of recipe.ingredients) {
        if (!ingredient.item) continue;
        const invId = ingredient.item._id || ingredient.item;
        const inventoryItem = await q(InventoryItem.findById(invId));
        if (!inventoryItem) continue;
        const qtyToRestore = (Number(ingredient.quantity) || 0) * (Number(item.qty) || 0);
        if (qtyToRestore <= 0) continue;
        const previousStock = inventoryItem.currentStock;
        inventoryItem.currentStock = Math.max(0, inventoryItem.currentStock + qtyToRestore);
        await inventoryItem.save(session ? { session } : undefined);
        const movement = {
          item: inventoryItem._id,
          type: "in",
          quantity: qtyToRestore,
          previousStock,
          newStock: inventoryItem.currentStock,
          reason: `Order ${order.orderNumber} deleted: restore ${item.name} x ${item.qty}`,
          referenceId: order._id,
          referenceType: "order",
        };
        await doCreate(StockMovement, { ...movement, createdBy: userId });
      }
    }
  }
  await q(Payment.deleteMany({ order: order._id }));
  await q(StockMovement.deleteMany({ referenceId: order._id }));
  await q(OrderEditHistory.deleteMany({ order: order._id }));
  await q(Notification.deleteMany({ entityId: order._id }));
  await q(Table.updateMany({ currentOrder: order._id }, { $set: { currentOrder: null, status: "free" } }));
  if (order.customer && (order.loyaltyPointsEarned || order.loyaltyPointsUsed)) {
    const customer = await q(Customer.findById(order.customer));
    if (customer) {
      customer.loyaltyPoints = Math.max(0, (customer.loyaltyPoints || 0) - (order.loyaltyPointsEarned || 0) + (order.loyaltyPointsUsed || 0));
      await customer.save(session ? { session } : undefined);
    }
  }
  await q(Order.deleteOne({ _id: order._id }));
};

const performOrderDeletion = async (order, userId) => {
  const { withTransaction } = require("../utils/transaction");
  return withTransaction(async (session) => {
    return performOrderDeletionTx(order, userId, session);
  });
};

const deleteOrder = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }
    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    await performOrderDeletion(order, req.user._id);
    return res.status(200).json({ success: true, message: "Order deleted" });
  } catch (error) {
    console.log("DELETE ORDER ERROR:", error);
    return handleError(res, error);
  }
};

const bulkDeleteOrders = async (req, res) => {
  try {
    const { parseIds } = require("../utils/bulkDelete");
    let ids;
    try {
      ids = parseIds(req.body?.ids);
    } catch (err) {
      return res.status(err.status || 400).json({ success: false, message: err.message });
    }
    const orders = await Order.find({ _id: { $in: ids } });
    const foundMap = new Map(orders.map((o) => [String(o._id), o]));
    const blocked = [];
    const missing = [];
    let deletedCount = 0;
    for (const rawId of ids) {
      const str = String(rawId);
      const order = foundMap.get(str);
      if (!order) { missing.push(str); continue; }
      try {
        await performOrderDeletion(order, req.user._id);
        deletedCount += 1;
      } catch (e) {
        console.error("BULK DELETE ORDER ITEM ERROR:", e.message);
        blocked.push({ id: str, orderNumber: order.orderNumber, reason: e.message });
      }
    }
    return res.status(200).json({
      success: true,
      message: `${deletedCount} order${deletedCount === 1 ? "" : "s"} deleted.`,
      deletedCount,
      blocked,
      missing,
    });
  } catch (error) {
    console.log("BULK DELETE ORDERS ERROR:", error);
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
  markOrderPaid,
  editOrderItems,
  collectAdditionalPayment,
  deleteOrder,
  bulkDeleteOrders,
  calculateTax,
  calculateServiceCharge,
  applyCoupon,
};