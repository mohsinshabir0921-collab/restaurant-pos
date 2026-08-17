const mongoose = require("mongoose");
const Order = require("../models/Order");
const User = require("../models/User");
const DeliveryLocation = require("../models/DeliveryLocation");
const { handleError } = require("../utils/httpError");

// Delivery orders the delivery boy still needs to fulfil.
const ACTIVE_DELIVERY_STATUSES = ["ready", "out_for_delivery"];

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const isValidLatitude = (value) =>
  Number.isFinite(value) && value >= -90 && value <= 90;

const isValidLongitude = (value) =>
  Number.isFinite(value) && value >= -180 && value <= 180;

const parseCoordinate = (value, min, max, label) => {
  if (value === null || value === undefined || value === "") {
    return { error: `${label} is required` };
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) {
    return { error: `${label} must be between ${min} and ${max}` };
  }
  return { value: num };
};

const getLatestLocation = (orderId) =>
  DeliveryLocation.findOne({ order: orderId })
    .sort({ timestamp: -1 })
    .lean();

// POST /api/orders/:id/assign  (admin / cashier)
const assignDeliveryBoy = async (req, res) => {
  try {
    const { id } = req.params;
    const { deliveryBoyId } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }

    if (!deliveryBoyId || !isValidObjectId(deliveryBoyId)) {
      return res.status(400).json({ success: false, message: "A valid delivery user id is required" });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (order.orderType !== "delivery") {
      return res.status(400).json({
        success: false,
        message: "Only delivery orders can be assigned a delivery boy",
      });
    }

    const deliveryBoy = await User.findById(deliveryBoyId).select("-password -refreshTokens");
    if (!deliveryBoy) {
      return res.status(404).json({ success: false, message: "Delivery user not found" });
    }

    if (deliveryBoy.role !== "delivery") {
      return res.status(400).json({
        success: false,
        message: "Selected user is not a delivery staff member",
      });
    }

    if (deliveryBoy.isActive === false) {
      return res.status(400).json({ success: false, message: "Selected delivery user is inactive" });
    }

    order.assignedTo = deliveryBoy._id;
    order.updatedBy = req.user._id;
    await order.save();

    return res.status(200).json({
      success: true,
      message: "Delivery boy assigned successfully",
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        orderStatus: order.orderStatus,
        assignedTo: {
          _id: deliveryBoy._id,
          name: deliveryBoy.name,
          role: deliveryBoy.role,
        },
      },
    });
  } catch (error) {
    console.log("ASSIGN DELIVERY BOY ERROR:", error);
    return handleError(res, error);
  }
};

// GET /api/deliveries/assigned  (delivery)
const getAssignedOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      assignedTo: req.user._id,
      orderType: "delivery",
      orderStatus: { $in: ACTIVE_DELIVERY_STATUSES },
    })
      .sort({ createdAt: -1 })
      .lean();

    const safeOrders = orders.map((order) => ({
      _id: order._id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      orderStatus: order.orderStatus,
      customerName: order.customerName,
      deliveryAddress: order.deliveryAddress || null,
      total: order.total ?? 0,
      assignedTo: order.assignedTo || null,
    }));

    return res.status(200).json({
      success: true,
      orders: safeOrders,
    });
  } catch (error) {
    console.log("GET ASSIGNED ORDERS ERROR:", error);
    return handleError(res, error);
  }
};

// POST /api/deliveries/location  (delivery)
// The authenticated delivery boy reports their own live location for one of
// their assigned orders. deliveryBoy is always taken from the session; the
// client can never supply who is reporting.
const reportLocation = async (req, res) => {
  try {
    const { orderId, lat, lng } = req.body;

    if (!orderId || !isValidObjectId(orderId)) {
      return res.status(400).json({ success: false, message: "A valid order id is required" });
    }

    const parsedLat = parseCoordinate(lat, -90, 90, "Latitude");
    if (parsedLat.error) {
      return res.status(400).json({ success: false, message: parsedLat.error });
    }
    const parsedLng = parseCoordinate(lng, -180, 180, "Longitude");
    if (parsedLng.error) {
      return res.status(400).json({ success: false, message: parsedLng.error });
    }
    const latitude = parsedLat.value;
    const longitude = parsedLng.value;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (order.orderType !== "delivery") {
      return res.status(400).json({ success: false, message: "Order is not a delivery order" });
    }

    if (!order.assignedTo || order.assignedTo.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "You are not assigned to this delivery" });
    }

    if (order.orderStatus !== "out_for_delivery") {
      return res.status(400).json({
        success: false,
        message: "Location can only be reported while the order is out for delivery",
      });
    }

    const created = await DeliveryLocation.create({
      order: order._id,
      deliveryBoy: req.user._id,
      lat: latitude,
      lng: longitude,
      status: order.orderStatus,
    });

    const latest = (await getLatestLocation(order._id)) || created;

    return res.status(201).json({
      success: true,
      message: "Location updated",
      location: {
        _id: latest._id,
        order: latest.order,
        lat: latest.lat,
        lng: latest.lng,
        status: latest.status,
        timestamp: latest.timestamp,
      },
    });
  } catch (error) {
    console.log("REPORT DELIVERY LOCATION ERROR:", error);
    return handleError(res, error);
  }
};

// GET /api/orders/:id/tracking  (admin / cashier / delivery)
// Admins and cashiers can inspect any delivery. A delivery user can only
// inspect deliveries assigned to themselves.
const getOrderTracking = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (order.orderType !== "delivery") {
      return res.status(400).json({ success: false, message: "Order is not a delivery order" });
    }

    const isAdminOrCashier = ["admin", "cashier"].includes(req.user.role);
    if (!isAdminOrCashier) {
      if (!order.assignedTo || order.assignedTo.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: "You are not assigned to this delivery" });
      }
    }

    let assignedTo = null;
    if (order.assignedTo) {
      const boy = await User.findById(order.assignedTo).select("name");
      if (boy) assignedTo = { _id: boy._id, name: boy.name };
    }

    const latest = await getLatestLocation(order._id);

    return res.status(200).json({
      success: true,
      tracking: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        orderStatus: order.orderStatus,
        orderType: order.orderType,
        assignedTo,
        destination: order.deliveryAddress || null,
        latestLocation: latest
          ? {
              _id: latest._id,
              lat: latest.lat,
              lng: latest.lng,
              status: latest.status,
              timestamp: latest.timestamp,
            }
          : null,
        estimatedDeliveryTime: order.estimatedDeliveryTime || null,
        actualDeliveryTime: order.actualDeliveryTime || null,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
    });
  } catch (error) {
    console.log("GET ORDER TRACKING ERROR:", error);
    return handleError(res, error);
  }
};

// GET /api/public/orders/:orderNumber/track?phone=...  (public)
// A customer can only track their own order: the order number and the phone
// number recorded on the order must match. Returns only what is needed to
// render a live map for that order. The delivery boy is exposed by name only;
// the customer's live GPS is never stored or returned - only the saved
// delivery destination that already belongs to the order.
const getPublicOrderTracking = async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const phone = String(req.query.phone || "").trim();

    if (!orderNumber || !phone) {
      return res.status(400).json({ success: false, message: "Order number and phone are required" });
    }

    const order = await Order.findOne({ orderNumber });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const orderPhone = String(order.customerPhone || "").trim();
    if (!orderPhone || orderPhone !== phone) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (order.orderType !== "delivery") {
      return res.status(400).json({ success: false, message: "This order is not a delivery order" });
    }

    let assignedTo = null;
    if (order.assignedTo) {
      const boy = await User.findById(order.assignedTo).select("name");
      if (boy) assignedTo = { name: boy.name };
    }

    const latest = await getLatestLocation(order._id);

    return res.status(200).json({
      success: true,
      tracking: {
        orderNumber: order.orderNumber,
        orderStatus: order.orderStatus,
        deliveryStatus: order.orderStatus,
        assignedTo,
        destination: order.deliveryAddress
          ? {
              latitude: order.deliveryAddress.latitude,
              longitude: order.deliveryAddress.longitude,
              line1: order.deliveryAddress.line1,
            }
          : null,
        latestLocation: latest
          ? {
              lat: latest.lat,
              lng: latest.lng,
              timestamp: latest.timestamp,
            }
          : null,
        estimatedDeliveryTime: order.estimatedDeliveryTime || null,
        actualDeliveryTime: order.actualDeliveryTime || null,
      },
    });
  } catch (error) {
    console.log("PUBLIC ORDER TRACKING ERROR:", error);
    return handleError(res, error);
  }
};

module.exports = {
  assignDeliveryBoy,
  getAssignedOrders,
  reportLocation,
  getOrderTracking,
  getPublicOrderTracking,
};
