const User = require("../models/User");
const Notification = require("../models/Notification");

const createNotificationForAdmins = async ({ type, title, message, link = "/", entityId = null }) => {
  try {
    const admins = await User.find({ role: "admin", isActive: true }).select("_id").lean();
    if (!admins.length) return;

    const docs = admins.map((u) => ({
      user: u._id,
      type,
      title,
      message: message || "",
      link,
      entityId: entityId || null,
    }));

    await Notification.insertMany(docs);
  } catch (error) {
    console.error("NOTIFICATION CREATE ERROR:", error.message);
  }
};

module.exports = { createNotificationForAdmins };
