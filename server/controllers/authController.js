const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { handleError } = require("../utils/httpError");
const { parsePagination } = require("../utils/pagination");

const generateAccessToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    }
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "30d",
    }
  );
};

const registerUser = async (req, res) => {
  try {
    const { name, email, password, role = "cashier", isActive } = req.body;
    const ALLOWED_ROLES = ["admin", "cashier", "kitchen", "delivery", "waiter"];

    const trimmedName = String(name || "").trim();
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!trimmedName) {
      return res.status(400).json({ success: false, message: "Name is required" });
    }
    if (!normalizedEmail) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address" });
    }
    if (!password || typeof password !== "string") {
      return res.status(400).json({ success: false, message: "Password is required and must be a string" });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Must be one of: ${ALLOWED_ROLES.join(", ")}`,
      });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists with this email",
      });
    }

    const user = await User.create({
      name: trimmedName,
      email: normalizedEmail,
      password,
      role,
      isActive: isActive !== undefined ? isActive : true,
    });

    if (role !== "admin") {
      try {
        const { createNotificationForAdmins } = require("../utils/notificationService");
        await createNotificationForAdmins({
          type: "staff",
          title: "New Staff Member",
          message: `${trimmedName} (${role})`,
          link: "/staff",
          entityId: user._id,
        });
      } catch (notifyError) {
        console.error("STAFF NOTIFICATION ERROR:", notifyError.message);
      }
    }

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    console.log("REGISTER USER ERROR:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "User already exists with this email",
      });
    }

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors || {})
        .map((e) => e.message)
        .join("; ");
      return res.status(400).json({
        success: false,
        message: messages ? `Validation failed: ${messages}` : "User validation failed",
      });
    }

    return handleError(res, error);
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "User account is inactive",
      });
    }

    const isPasswordMatched = await user.comparePassword(password);

    if (!isPasswordMatched) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const token = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await user.addRefreshToken(refreshToken);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      accessToken: token,
      refreshToken,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.log("LOGIN USER ERROR:", error);

    return handleError(res, error);
  }
};

const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Refresh token is required",
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired refresh token",
      });
    }

    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "User account is inactive",
      });
    }

    const isValid = await user.isValidRefreshToken(token);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    await user.removeRefreshToken(token);
    const newRefreshToken = generateRefreshToken(user);
    await user.addRefreshToken(newRefreshToken);

    return res.status(200).json({
      success: true,
      accessToken: generateAccessToken(user),
      refreshToken: newRefreshToken,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.log("REFRESH TOKEN ERROR:", error);

    return handleError(res, error);
  }
};

const logoutUser = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Refresh token is required",
      });
    }

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    await user.removeRefreshToken(token);

    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.log("LOGOUT ERROR:", error);

    return handleError(res, error);
  }
};

const getMe = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      user: {
        _id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        isActive: req.user.isActive,
      },
    });
  } catch (error) {
    console.log("GET ME ERROR:", error);

    return handleError(res, error);
  }
};

const getAllStaff = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = "", role, isActive } = req.query;
    const query = {};

    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ name: regex }, { email: regex }];
    }
    if (role) query.role = role;
    if (isActive !== undefined) query.isActive = isActive === "true";

    const { page: safePage, limit: safeLimit, skip } = parsePagination(req.query, 20);
    const staff = await User.find(query)
      .select("-password -refreshTokens")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean();

    const total = await User.countDocuments(query);

    return res.status(200).json({
      success: true,
      staff,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    });
  } catch (error) {
    console.log("GET ALL STAFF ERROR:", error);
    return handleError(res, error);
  }
};

const getStaffById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select("-password -refreshTokens").lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Staff member not found",
      });
    }

    return res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.log("GET STAFF BY ID ERROR:", error);
    return handleError(res, error);
  }
};

const updateStaff = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const ALLOWED_ROLES = ["admin", "cashier", "kitchen", "delivery", "waiter"];

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Staff member not found",
      });
    }

    if (updates.name !== undefined) {
      const trimmedName = String(updates.name).trim();
      if (!trimmedName) {
        return res.status(400).json({ success: false, message: "Name cannot be empty" });
      }
      user.name = trimmedName;
    }

    if (updates.email !== undefined) {
      const normalizedEmail = String(updates.email).trim().toLowerCase();
      if (!normalizedEmail) {
        return res.status(400).json({ success: false, message: "Email is required" });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ success: false, message: "Please enter a valid email address" });
      }
      const existingUser = await User.findOne({ email: normalizedEmail, _id: { $ne: id } });
      if (existingUser) {
        return res.status(400).json({ success: false, message: "Email already in use" });
      }
      user.email = normalizedEmail;
    }

    if (updates.role !== undefined) {
      if (!ALLOWED_ROLES.includes(updates.role)) {
        return res.status(400).json({
          success: false,
          message: `Invalid role. Must be one of: ${ALLOWED_ROLES.join(", ")}`,
        });
      }
      user.role = updates.role;
    }

    if (updates.isActive !== undefined) {
      if (typeof updates.isActive !== "boolean") {
        return res.status(400).json({ success: false, message: "isActive must be a boolean" });
      }
      if (!updates.isActive && id === req.user._id.toString()) {
        return res.status(400).json({ success: false, message: "Cannot deactivate your own account" });
      }
      user.isActive = updates.isActive;
    }

    if (updates.password !== undefined && updates.password !== "") {
      if (typeof updates.password !== "string" || updates.password.length < 6) {
        return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
      }
      user.password = updates.password;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Staff updated successfully",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    console.log("UPDATE STAFF ERROR:", error);
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
    return handleError(res, error);
  }
};

const changePassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
      return res.status(400).json({
        success: false,
        message: "Current password and new password must be strings",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters",
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Staff member not found",
      });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    user.password = newPassword;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.log("CHANGE PASSWORD ERROR:", error);
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "New password is invalid",
      });
    }
    return handleError(res, error);
  }
};

const deactivateStaff = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (id === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "Cannot deactivate your own account",
      });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    ).select("-password -refreshTokens");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Staff member not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Staff deactivated successfully",
      user,
    });
  } catch (error) {
    console.log("DEACTIVATE STAFF ERROR:", error);
    return handleError(res, error);
  }
};

module.exports = {
  registerUser,
  loginUser,
  refreshToken,
  logoutUser,
  getMe,
  getAllStaff,
  getStaffById,
  updateStaff,
  changePassword,
  deactivateStaff,
};