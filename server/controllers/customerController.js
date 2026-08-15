const Customer = require("../models/Customer");
const Order = require("../models/Order");
const { handleError } = require("../utils/httpError");
const { parsePagination } = require("../utils/pagination");

const getCustomers = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      search = "", 
      sortBy = "createdAt",
      sortOrder = "desc",
      isActive,
      minVisits,
      minSpend,
    } = req.query;

    const query = {};
    
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [
        { name: regex },
        { phone: regex },
        { email: regex },
      ];
    }
    
    if (isActive !== undefined) query.isActive = isActive === "true";
    if (minVisits) query.visitCount = { $gte: Number(minVisits) };
    if (minSpend) query.totalSpent = { $gte: Number(minSpend) };

    const { page: safePage, limit: safeLimit, skip } = parsePagination(req.query, 20);
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const [customers, total] = await Promise.all([
      Customer.find(query)
        .select("-addresses")
        .sort(sort)
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      Customer.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      customers,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    });
  } catch (error) {
    console.log("GET CUSTOMERS ERROR:", error);
    return handleError(res, error);
  }
};

const searchCustomers = async (req, res) => {
  try {
    const { q = "", limit = 10 } = req.query;
    const { limit: safeLimit } = parsePagination(req.query, 10);
    
    if (!q || q.trim().length < 2) {
      return res.status(200).json({
        success: true,
        customers: [],
      });
    }

    const customers = await Customer.search(q.trim(), safeLimit);

    return res.status(200).json({
      success: true,
      customers,
    });
  } catch (error) {
    console.log("SEARCH CUSTOMERS ERROR:", error);
    return handleError(res, error);
  }
};

const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;
    const customer = await Customer.findById(id).lean();

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    return res.status(200).json({
      success: true,
      customer,
    });
  } catch (error) {
    console.log("GET CUSTOMER ERROR:", error);
    return handleError(res, error);
  }
};

const getCustomerByPhone = async (req, res) => {
  try {
    const { phone } = req.params;
    const customer = await Customer.getByPhone(phone);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    return res.status(200).json({
      success: true,
      customer,
    });
  } catch (error) {
    console.log("GET CUSTOMER BY PHONE ERROR:", error);
    return handleError(res, error);
  }
};

const createOrGetCustomer = async (req, res) => {
  try {
    const { phone, name, email } = req.body;

    if (!phone || !String(phone).trim()) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    const customer = await Customer.createOrGet(String(phone).trim(), name || "");

    if (email && !customer.email) {
      const normalizedEmail = String(email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({
          success: false,
          message: "Please enter a valid email address",
        });
      }
      customer.email = normalizedEmail;
      await customer.save();
    }

    return res.status(200).json({
      success: true,
      message: customer.createdAt === customer.updatedAt ? "Customer created" : "Customer found",
      customer,
      isNew: customer.createdAt === customer.updatedAt,
    });
  } catch (error) {
    console.log("CREATE OR GET CUSTOMER ERROR:", error);
    if (error.code === 11000) {
      const existing = await Customer.findOne({ phone: String(phone).trim() });
      if (existing) {
        return res.status(200).json({
          success: true,
          message: "Customer found",
          customer: existing,
          isNew: false,
        });
      }
      return res.status(400).json({ success: false, message: "Customer with this phone already exists" });
    }
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors || {})
        .map((e) => e.message)
        .join("; ");
      return res.status(400).json({
        success: false,
        message: messages ? `Validation failed: ${messages}` : "Validation failed",
      });
    }
    return handleError(res, error);
  }
};

const updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, gstin, preferredPaymentMethod, dietaryPreferences, allergies, birthday, anniversary, tags, notes, isActive } = req.body;

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName) {
        return res.status(400).json({ success: false, message: "Name is required" });
      }
      customer.name = trimmedName;
    }
    if (email !== undefined) {
      const normalizedEmail = String(email).trim().toLowerCase();
      if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ success: false, message: "Please enter a valid email address" });
      }
      customer.email = normalizedEmail;
    }
    if (gstin !== undefined) customer.gstin = String(gstin).toUpperCase().trim();
    if (preferredPaymentMethod !== undefined) customer.preferredPaymentMethod = preferredPaymentMethod;
    if (dietaryPreferences !== undefined) customer.dietaryPreferences = Array.isArray(dietaryPreferences) ? dietaryPreferences : [];
    if (allergies !== undefined) customer.allergies = Array.isArray(allergies) ? allergies : [];
    if (birthday !== undefined) customer.birthday = birthday ? new Date(birthday) : null;
    if (anniversary !== undefined) customer.anniversary = anniversary ? new Date(anniversary) : null;
    if (tags !== undefined) customer.tags = Array.isArray(tags) ? tags : [];
    if (notes !== undefined) customer.notes = String(notes).trim();
    if (isActive !== undefined) customer.isActive = isActive;

    await customer.save();

    return res.status(200).json({
      success: true,
      message: "Customer updated successfully",
      customer,
    });
  } catch (error) {
    console.log("UPDATE CUSTOMER ERROR:", error);
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Email already in use" });
    }
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors || {})
        .map((e) => e.message)
        .join("; ");
      return res.status(400).json({
        success: false,
        message: messages ? `Validation failed: ${messages}` : "Validation failed",
      });
    }
    if (error.name === "CastError" || error.name === "BSONError") {
      return handleError(res, error);
    }
    return handleError(res, error);
  }
};

const addAddress = async (req, res) => {
  try {
    const { id } = req.params;
    const { label, line1, line2, city, state, pincode, landmark, coordinates, isDefault } = req.body;

    if (!line1 || !city || !state || !pincode) {
      return res.status(400).json({
        success: false,
        message: "Address line1, city, state, and pincode are required",
      });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    await customer.addAddress({
      label: label?.trim() || "Home",
      line1: line1.trim(),
      line2: line2?.trim() || "",
      city: city.trim(),
      state: state.trim(),
      pincode: pincode.trim(),
      landmark: landmark?.trim() || "",
      coordinates,
      isDefault: isDefault || false,
    });

    return res.status(200).json({
      success: true,
      message: "Address added successfully",
      customer,
    });
  } catch (error) {
    console.log("ADD ADDRESS ERROR:", error);
    return handleError(res, error);
  }
};

const updateAddress = async (req, res) => {
  try {
    const { id, addressId } = req.params;
    const { label, line1, line2, city, state, pincode, landmark, coordinates, isDefault } = req.body;

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const address = customer.addresses.id(addressId);
    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found",
      });
    }

    if (label !== undefined) address.label = label.trim();
    if (line1 !== undefined) address.line1 = line1.trim();
    if (line2 !== undefined) address.line2 = line2.trim();
    if (city !== undefined) address.city = city.trim();
    if (state !== undefined) address.state = state.trim();
    if (pincode !== undefined) address.pincode = pincode.trim();
    if (landmark !== undefined) address.landmark = landmark.trim();
    if (coordinates !== undefined) address.coordinates = coordinates;
    if (isDefault !== undefined) address.isDefault = isDefault;

    if (isDefault) {
      await customer.setDefaultAddress(addressId);
    } else {
      await customer.save();
    }

    return res.status(200).json({
      success: true,
      message: "Address updated successfully",
      customer,
    });
  } catch (error) {
    console.log("UPDATE ADDRESS ERROR:", error);
    return handleError(res, error);
  }
};

const deleteAddress = async (req, res) => {
  try {
    const { id, addressId } = req.params;

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const address = customer.addresses.id(addressId);
    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found",
      });
    }

    address.deleteOne();
    await customer.save();

    return res.status(200).json({
      success: true,
      message: "Address deleted successfully",
      customer,
    });
  } catch (error) {
    console.log("DELETE ADDRESS ERROR:", error);
    return handleError(res, error);
  }
};

const setDefaultAddress = async (req, res) => {
  try {
    const { id, addressId } = req.params;

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    await customer.setDefaultAddress(addressId);

    return res.status(200).json({
      success: true,
      message: "Default address updated",
      customer,
    });
  } catch (error) {
    console.log("SET DEFAULT ADDRESS ERROR:", error);
    return handleError(res, error);
  }
};

const getCustomerOrders = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const { page: safePage, limit: safeLimit, skip } = parsePagination(req.query, 10);
    const [orders, total] = await Promise.all([
      Order.find({ customer: id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      Order.countDocuments({ customer: id }),
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
    console.log("GET CUSTOMER ORDERS ERROR:", error);
    return handleError(res, error);
  }
};

const getCustomerStats = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const stats = await Order.aggregate([
      { $match: { customer: customer._id, orderStatus: { $nin: ["cancelled", "refunded"] } } },
      { $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalSpent: { $sum: "$total" },
        avgOrderValue: { $avg: "$total" },
        lastOrderDate: { $max: "$createdAt" },
        favoriteItems: { $push: "$items.name" },
      }},
    ]);

    return res.status(200).json({
      success: true,
      stats: stats[0] || { totalOrders: 0, totalSpent: 0, avgOrderValue: 0, lastOrderDate: null, favoriteItems: [] },
    });
  } catch (error) {
    console.log("GET CUSTOMER STATS ERROR:", error);
    return handleError(res, error);
  }
};

const redeemLoyaltyPoints = async (req, res) => {
  try {
    const { id } = req.params;
    const { points } = req.body;

    const numericPoints = Number(points);
    if (!Number.isInteger(numericPoints) || numericPoints <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid points amount required",
      });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    await customer.redeemPoints(numericPoints);

    return res.status(200).json({
      success: true,
      message: `${numericPoints} loyalty points redeemed`,
      customer,
    });
  } catch (error) {
    console.log("REDEEM LOYALTY POINTS ERROR:", error);
    if (error.name === "CastError") {
      return handleError(res, error);
    }
    return res.status(400).json({
      success: false,
      message: "Invalid request",
    });
  }
};

module.exports = {
  getCustomers,
  searchCustomers,
  getCustomerById,
  getCustomerByPhone,
  createOrGetCustomer,
  updateCustomer,
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  getCustomerOrders,
  getCustomerStats,
  redeemLoyaltyPoints,
};