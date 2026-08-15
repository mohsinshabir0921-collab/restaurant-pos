const Order = require("../models/Order");
const Payment = require("../models/Payment");
const Customer = require("../models/Customer");
const MenuItem = require("../models/MenuItem");
const { parsePagination } = require("../utils/pagination");
const Category = require("../models/Category");
const { handleError } = require("../utils/httpError");

const TIMEZONE = "Asia/Kolkata";
const PAYMENT_MODES = ["cash", "card", "upi", "wallet", "cod", "split"];

const isPaidOrder = (order) => {
  const orderStatus = String(order.orderStatus || "").toLowerCase();
  if (["cancelled", "refunded"].includes(orderStatus)) return false;
  return (
    String(order.paymentStatus || "").toLowerCase() === "paid" ||
    orderStatus === "paid" ||
    ["paid", "completed"].includes(orderStatus) ||
    !!order.paidAt
  );
};

const getIndiaNow = () => {
  const now = new Date();
  const indiaString = now.toLocaleString("en-US", { timeZone: TIMEZONE });
  return new Date(indiaString);
};

const getIndiaDayRangeUtc = (baseDate = new Date()) => {
  const current = new Date(baseDate);
  const indiaString = current.toLocaleString("en-US", { timeZone: TIMEZONE });
  const indiaNow = new Date(indiaString);

  const startIndia = new Date(indiaNow);
  startIndia.setHours(0, 0, 0, 0);

  const endIndia = new Date(indiaNow);
  endIndia.setHours(23, 59, 59, 999);

  const offsetMs = current.getTime() - indiaNow.getTime();

  return {
    startUtc: new Date(startIndia.getTime() + offsetMs),
    endUtc: new Date(endIndia.getTime() + offsetMs),
    label: indiaNow.toISOString().slice(0, 10),
  };
};

const getDateRangeUtc = (startDate, endDate) => {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  return { startUtc: start, endUtc: end };
};

exports.getTodayReport = async (req, res) => {
  try {
    const { startUtc, endUtc, label } = getIndiaDayRangeUtc();

    const orders = await Order.find({
      createdAt: { $gte: startUtc, $lte: endUtc },
    }).lean();

    const report = {
      success: true,
      date: label,
      totalOrders: 0,
      paidOrders: 0,
      totalSales: 0,
      paidSales: 0,
      subtotal: 0,
      totalTax: 0,
      totalDiscount: 0,
      totalServiceCharge: 0,
      totalDeliveryFee: 0,
      paymentBreakdown: PAYMENT_MODES.reduce((acc, mode) => {
        acc[mode] = { count: 0, sales: 0, paidCount: 0, paidSales: 0 };
        return acc;
      }, {}),
      orderTypeBreakdown: {
        dinein: { count: 0, sales: 0 },
        takeaway: { count: 0, sales: 0 },
        delivery: { count: 0, sales: 0 },
      },
    };

    for (const order of orders) {
      const method = String(order.paymentMethod || "cash").toLowerCase();
      const total = Number(order.total || 0);
      const isPaid = isPaidOrder(order);

      if (!report.paymentBreakdown[method]) {
        report.paymentBreakdown[method] = {
          count: 0,
          sales: 0,
          paidCount: 0,
          paidSales: 0,
        };
      }

      report.totalOrders += 1;
      report.paymentBreakdown[method].count += 1;

      const orderType = order.orderType || "dinein";
      if (report.orderTypeBreakdown[orderType]) {
        report.orderTypeBreakdown[orderType].count += 1;
      }

      if (isPaid) {
        report.totalSales += total;
        report.subtotal += Number(order.subtotal || 0);
        report.totalTax += Number(order.tax || 0);
        report.totalDiscount += Number(order.discount || 0);
        report.totalServiceCharge += Number(order.serviceCharge || 0);
        report.totalDeliveryFee += Number(order.deliveryFee || 0);

        report.paymentBreakdown[method].sales += total;
        report.orderTypeBreakdown[orderType].sales += total;

        report.paidOrders += 1;
        report.paidSales += total;
        report.paymentBreakdown[method].paidCount += 1;
        report.paymentBreakdown[method].paidSales += total;
      }
    }

    return res.json(report);
  } catch (error) {
    console.error("TODAY REPORT ERROR:", error);
    return handleError(res, error);
  }
};

exports.getDashboardReport = async (req, res) => {
  try {
    const { startUtc: todayStart, endUtc: todayEnd } = getIndiaDayRangeUtc();
    const { startUtc: sevenDaysAgo } = getLast7IndiaDaysRangeUtc();

    const todayOrders = await Order.find({
      createdAt: { $gte: todayStart, $lte: todayEnd },
    })
      .sort({ createdAt: -1 })
      .lean();

    const totalOrders = todayOrders.length;
    const paidTodayOrders = todayOrders.filter(isPaidOrder);

    const totalRevenue = paidTodayOrders.reduce(
      (sum, order) => sum + Number(order.total || 0),
      0
    );

    const paidOrders = paidTodayOrders.length;

    const averageOrderValue =
      paidOrders > 0 ? Math.round(totalRevenue / paidOrders) : 0;

    const salesTrendRaw = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: sevenDaysAgo, $lte: todayEnd },
          paymentStatus: "paid",
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
              timezone: TIMEZONE,
            },
          },
          sales: { $sum: { $toDouble: "$total" } },
          orders: { $sum: 1 },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    const indiaNow = getIndiaNow();
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const salesTrend = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(indiaNow);
      d.setDate(indiaNow.getDate() - i);

      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const key = `${yyyy}-${mm}-${dd}`;

      const found = salesTrendRaw.find((item) => item._id === key);

      salesTrend.push({
        label: dayNames[d.getDay()],
        sales: found ? Number(found.sales || 0) : 0,
        orders: found ? Number(found.orders || 0) : 0,
      });
    }

    const paymentModeRaw = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: todayStart, $lte: todayEnd },
        },
      },
      {
        $group: {
          _id: {
            $toLower: { $ifNull: ["$paymentMethod", "cash"] },
          },
          value: { $sum: 1 },
          sales: { $sum: { $toDouble: "$total" } },
        },
      },
    ]);

    const paymentModeStats = paymentModeRaw.map((item) => ({
      label: String(item._id || "cash").toUpperCase(),
      value: Number(item.value || 0),
      sales: Number(item.sales || 0),
    }));

    const statusRaw = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: todayStart, $lte: todayEnd },
        },
      },
      {
        $group: {
          _id: {
            $toLower: { $ifNull: ["$orderStatus", "pending"] },
          },
          value: { $sum: 1 },
        },
      },
    ]);

    const statusSummary = statusRaw.map((item) => ({
      label: item._id
        ? item._id.charAt(0).toUpperCase() + item._id.slice(1)
        : "Pending",
      value: Number(item.value || 0),
    }));

    const orderTypeRaw = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: todayStart, $lte: todayEnd },
        },
      },
      {
        $group: {
          _id: { $toLower: { $ifNull: ["$orderType", "dinein"] } },
          count: { $sum: 1 },
          sales: { $sum: { $toDouble: "$total" } },
        },
      },
    ]);

    const orderTypeStats = orderTypeRaw.map((item) => ({
      label: String(item._id || "dinein").charAt(0).toUpperCase() + String(item._id || "dinein").slice(1),
      value: Number(item.count || 0),
      sales: Number(item.sales || 0),
    }));

    const recentOrders = todayOrders.slice(0, 6).map((order) => ({
      _id: order._id,
      orderNumber: order.orderNumber,
      customerName: order.customerName || "Walk-in Customer",
      tableNo: order.tableNo ?? "-",
      paymentMethod: order.paymentMethod || "cash",
      paymentStatus: order.paymentStatus || "pending",
      orderStatus: order.orderStatus || "pending",
      orderType: order.orderType || "dinein",
      total: Number(order.total || 0),
      items: Array.isArray(order.items) ? order.items.length : 0,
      createdAt: order.createdAt,
    }));

    return res.json({
      success: true,
      stats: {
        totalOrders,
        totalRevenue,
        paidOrders,
        averageOrderValue,
      },
      salesTrend,
      paymentModeStats,
      statusSummary,
      orderTypeStats,
      recentOrders,
    });
  } catch (error) {
    console.error("DASHBOARD API ERROR:", error);
    return handleError(res, error);
  }
};

exports.getDateRangeReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate are required",
      });
    }

    const { startUtc, endUtc } = getDateRangeUtc(startDate, endDate);

    const orders = await Order.find({
      createdAt: { $gte: startUtc, $lte: endUtc },
    }).lean();

    const report = {
      success: true,
      startDate,
      endDate,
      totalOrders: 0,
      paidOrders: 0,
      totalSales: 0,
      paidSales: 0,
      subtotal: 0,
      totalTax: 0,
      totalDiscount: 0,
      totalServiceCharge: 0,
      totalDeliveryFee: 0,
      paymentBreakdown: PAYMENT_MODES.reduce((acc, mode) => {
        acc[mode] = { count: 0, sales: 0, paidCount: 0, paidSales: 0 };
        return acc;
      }, {}),
      orderTypeBreakdown: {
        dinein: { count: 0, sales: 0 },
        takeaway: { count: 0, sales: 0 },
        delivery: { count: 0, sales: 0 },
      },
      dailyBreakdown: [],
    };

    const dailyMap = {};

    for (const order of orders) {
      const method = String(order.paymentMethod || "cash").toLowerCase();
      const total = Number(order.total || 0);
      const isPaid = isPaidOrder(order);
      const orderDate = new Date(order.createdAt).toLocaleDateString("en-CA", { timeZone: TIMEZONE });

      if (!dailyMap[orderDate]) {
        dailyMap[orderDate] = {
          date: orderDate,
          totalOrders: 0,
          paidOrders: 0,
          totalSales: 0,
          paidSales: 0,
        };
      }

      dailyMap[orderDate].totalOrders += 1;

      if (!report.paymentBreakdown[method]) {
        report.paymentBreakdown[method] = { count: 0, sales: 0, paidCount: 0, paidSales: 0 };
      }

      report.totalOrders += 1;
      report.paymentBreakdown[method].count += 1;

      const orderType = order.orderType || "dinein";
      if (report.orderTypeBreakdown[orderType]) {
        report.orderTypeBreakdown[orderType].count += 1;
      }

      if (isPaid) {
        const subtotal = Number(order.subtotal || 0);
        const tax = Number(order.tax || 0);
        const discount = Number(order.discount || 0);
        const serviceCharge = Number(order.serviceCharge || 0);
        const deliveryFee = Number(order.deliveryFee || 0);

        dailyMap[orderDate].totalSales += total;
        report.totalSales += total;
        report.subtotal += subtotal;
        report.totalTax += tax;
        report.totalDiscount += discount;
        report.totalServiceCharge += serviceCharge;
        report.totalDeliveryFee += deliveryFee;

        report.paymentBreakdown[method].sales += total;
        report.orderTypeBreakdown[orderType].sales += total;

        report.paidOrders += 1;
        report.paidSales += total;
        report.paymentBreakdown[method].paidCount += 1;
        report.paymentBreakdown[method].paidSales += total;
        dailyMap[orderDate].paidOrders += 1;
        dailyMap[orderDate].paidSales += total;
      }
    }

    report.dailyBreakdown = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    return res.json(report);
  } catch (error) {
    console.error("DATE RANGE REPORT ERROR:", error);
    return handleError(res, error);
  }
};

exports.getSalesByCategory = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let matchQuery = { paymentStatus: "paid" };
    if (startDate || endDate) {
      matchQuery.createdAt = {};
      if (startDate) matchQuery.createdAt.$gte = new Date(startDate);
      if (endDate) matchQuery.createdAt.$lte = new Date(endDate);
    }

    const sales = await Order.aggregate([
      { $match: matchQuery },
      { $unwind: "$items" },
      {
        $lookup: {
          from: "menuitems",
          localField: "items.menuItemId",
          foreignField: "_id",
          as: "menuItem",
        },
      },
      { $unwind: { path: "$menuItem", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "categories",
          localField: "menuItem.category",
          foreignField: "_id",
          as: "category",
        },
      },
      { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: "$category._id",
          categoryName: { $first: "$category.name" },
          totalQty: { $sum: "$items.qty" },
          totalSales: { $sum: { $multiply: ["$items.price", "$items.qty"] } },
          orderCount: { $addToSet: "$_id" },
        },
      },
      {
        $project: {
          categoryName: 1,
          totalQty: 1,
          totalSales: 1,
          orderCount: { $size: "$orderCount" },
        },
      },
      { $sort: { totalSales: -1 } },
    ]);

    return res.json({ success: true, sales });
  } catch (error) {
    console.error("SALES BY CATEGORY ERROR:", error);
    return handleError(res, error);
  }
};

exports.getSalesByItem = async (req, res) => {
  try {
    const { startDate, endDate, limit = 50 } = req.query;
    const { limit: safeLimit } = parsePagination(req.query, 50);
    
    let matchQuery = { paymentStatus: "paid" };
    if (startDate || endDate) {
      matchQuery.createdAt = {};
      if (startDate) matchQuery.createdAt.$gte = new Date(startDate);
      if (endDate) matchQuery.createdAt.$lte = new Date(endDate);
    }

    const sales = await Order.aggregate([
      { $match: matchQuery },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.menuItemId",
          name: { $first: "$items.name" },
          totalQty: { $sum: "$items.qty" },
          totalSales: { $sum: { $multiply: ["$items.price", "$items.qty"] } },
          avgPrice: { $avg: "$items.price" },
          orderCount: { $addToSet: "$_id" },
        },
      },
      {
        $project: {
          name: 1,
          totalQty: 1,
          totalSales: 1,
          avgPrice: 1,
          orderCount: { $size: "$orderCount" },
        },
      },
      { $sort: { totalSales: -1 } },
      { $limit: safeLimit },
    ]);

    return res.json({ success: true, sales });
  } catch (error) {
    console.error("SALES BY ITEM ERROR:", error);
    return handleError(res, error);
  }
};

exports.getPaymentReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let matchQuery = { status: "paid" };
    if (startDate || endDate) {
      matchQuery.createdAt = {};
      if (startDate) matchQuery.createdAt.$gte = new Date(startDate);
      if (endDate) matchQuery.createdAt.$lte = new Date(endDate);
    }

    const payments = await Payment.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: "$method",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
      { $sort: { totalAmount: -1 } },
    ]);

    const gatewayPayments = await Payment.aggregate([
      { $match: { ...matchQuery, gateway: { $ne: "manual" } } },
      {
        $group: {
          _id: "$gateway",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
      { $sort: { totalAmount: -1 } },
    ]);

    return res.json({ success: true, payments, gatewayPayments });
  } catch (error) {
    console.error("PAYMENT REPORT ERROR:", error);
    return handleError(res, error);
  }
};

exports.getTaxReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let matchQuery = { paymentStatus: "paid" };
    if (startDate || endDate) {
      matchQuery.createdAt = {};
      if (startDate) matchQuery.createdAt.$gte = new Date(startDate);
      if (endDate) matchQuery.createdAt.$lte = new Date(endDate);
    }

    const taxSummary = await Order.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalCgst: { $sum: "$cgst" },
          totalSgst: { $sum: "$sgst" },
          totalIgst: { $sum: "$igst" },
          totalTax: { $sum: "$tax" },
          totalSales: { $sum: "$subtotal" },
          totalDiscount: { $sum: "$discount" },
        },
      },
    ]);

    const taxByRate = await Order.aggregate([
      { $match: matchQuery },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.taxRate",
          taxAmount: { $sum: { $multiply: [{ $multiply: ["$items.price", "$items.qty"] }, { $divide: ["$items.taxRate", 100] }] } },
          taxableAmount: { $sum: { $multiply: ["$items.price", "$items.qty"] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return res.json({ 
      success: true, 
      taxSummary: taxSummary[0] || { totalCgst: 0, totalSgst: 0, totalIgst: 0, totalTax: 0, totalSales: 0, totalDiscount: 0 },
      taxByRate,
    });
  } catch (error) {
    console.error("TAX REPORT ERROR:", error);
    return handleError(res, error);
  }
};

exports.getStaffReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let matchQuery = { paymentStatus: "paid" };
    if (startDate || endDate) {
      matchQuery.createdAt = {};
      if (startDate) matchQuery.createdAt.$gte = new Date(startDate);
      if (endDate) matchQuery.createdAt.$lte = new Date(endDate);
    }

    const staffSales = await Order.aggregate([
      { $match: matchQuery },
      {
        $lookup: {
          from: "users",
          localField: "createdBy",
          foreignField: "_id",
          as: "staff",
        },
      },
      { $unwind: { path: "$staff", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: "$staff._id",
          staffName: { $first: "$staff.name" },
          orderCount: { $sum: 1 },
          totalSales: { $sum: "$total" },
          avgOrderValue: { $avg: "$total" },
        },
      },
      { $sort: { totalSales: -1 } },
    ]);

    return res.json({ success: true, staffSales });
  } catch (error) {
    console.error("STAFF REPORT ERROR:", error);
    return handleError(res, error);
  }
};

exports.getCustomerReport = async (req, res) => {
  try {
    const { startDate, endDate, limit = 50 } = req.query;
    const { limit: safeLimit } = parsePagination(req.query, 50);
    
    let matchQuery = { paymentStatus: "paid" };
    if (startDate || endDate) {
      matchQuery.createdAt = {};
      if (startDate) matchQuery.createdAt.$gte = new Date(startDate);
      if (endDate) matchQuery.createdAt.$lte = new Date(endDate);
    }

    const topCustomers = await Order.aggregate([
      { $match: { ...matchQuery, customer: { $ne: null } } },
      {
        $group: {
          _id: "$customer",
          orderCount: { $sum: 1 },
          totalSpent: { $sum: "$total" },
          lastOrder: { $max: "$createdAt" },
        },
      },
      {
        $lookup: {
          from: "customers",
          localField: "_id",
          foreignField: "_id",
          as: "customer",
        },
      },
      { $unwind: "$customer" },
      {
        $project: {
          name: "$customer.name",
          phone: "$customer.phone",
          email: "$customer.email",
          loyaltyPoints: "$customer.loyaltyPoints",
          loyaltyTier: "$customer.loyaltyTier",
          orderCount: 1,
          totalSpent: 1,
          lastOrder: 1,
        },
      },
      { $sort: { totalSpent: -1 } },
      { $limit: safeLimit },
    ]);

    const newVsReturning = await Order.aggregate([
      { $match: matchQuery },
      {
        $lookup: {
          from: "customers",
          localField: "customer",
          foreignField: "_id",
          as: "customer",
        },
      },
      { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $cond: [{ $eq: ["$customer.visitCount", 1] }, "new", "returning"] },
          count: { $sum: 1 },
          sales: { $sum: "$total" },
        },
      },
    ]);

    return res.json({ success: true, topCustomers, newVsReturning });
  } catch (error) {
    console.error("CUSTOMER REPORT ERROR:", error);
    return handleError(res, error);
  }
};

exports.getHourlyReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let matchQuery = { paymentStatus: "paid" };
    if (startDate || endDate) {
      matchQuery.createdAt = {};
      if (startDate) matchQuery.createdAt.$gte = new Date(startDate);
      if (endDate) matchQuery.createdAt.$lte = new Date(endDate);
    }

    const hourly = await Order.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { $hour: { date: "$createdAt", timezone: TIMEZONE } },
          count: { $sum: 1 },
          sales: { $sum: "$total" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const fullDay = [];
    for (let h = 0; h < 24; h++) {
      const found = hourly.find(item => item._id === h);
      fullDay.push({
        hour: h,
        label: `${h.toString().padStart(2, "0")}:00`,
        count: found ? found.count : 0,
        sales: found ? found.sales : 0,
      });
    }

    return res.json({ success: true, hourly: fullDay });
  } catch (error) {
    console.error("HOURLY REPORT ERROR:", error);
    return handleError(res, error);
  }
};

const getLast7IndiaDaysRangeUtc = () => {
  const now = new Date();
  const indiaNow = getIndiaNow();

  const startIndia = new Date(indiaNow);
  startIndia.setDate(startIndia.getDate() - 6);
  startIndia.setHours(0, 0, 0, 0);

  const endIndia = new Date(indiaNow);
  endIndia.setHours(23, 59, 59, 999);

  const offsetMs = now.getTime() - indiaNow.getTime();

  return {
    startUtc: new Date(startIndia.getTime() + offsetMs),
    endUtc: new Date(endIndia.getTime() + offsetMs),
  };
};