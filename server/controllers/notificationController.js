const Notification = require("../models/Notification");
const { handleError } = require("../utils/httpError");

const getMyNotifications = async (req, res) => {
  try {
    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).lean(),
      Notification.countDocuments({ user: req.user._id, read: false }),
    ]);

    return res.json({ success: true, notifications, unreadCount });
  } catch (error) {
    console.log("GET NOTIFICATIONS ERROR:", error.message);
    return handleError(res, error);
  }
};

const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await Notification.findOneAndUpdate(
      { _id: id, user: req.user._id },
      { read: true, readAt: new Date() },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    return res.json({ success: true, notification: updated });
  } catch (error) {
    console.log("MARK READ ERROR:", error.message);
    return handleError(res, error);
  }
};

const markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, read: false },
      { read: true, readAt: new Date() }
    );

    return res.json({ success: true });
  } catch (error) {
    console.log("MARK ALL READ ERROR:", error.message);
    return handleError(res, error);
  }
};

module.exports = { getMyNotifications, markAsRead, markAllAsRead };
