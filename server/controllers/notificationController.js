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

// Delete a validated set of the current user's own notifications. A user can
// only delete their own notifications; notifications belonging to other users
// (e.g. staff/system notifications) are never touched. IDs from other users
// are silently ignored rather than erroring, so a stale selection cannot
// delete someone else's records.
const bulkDeleteNotifications = async (req, res) => {
  try {
    const { parseIds } = require("../utils/bulkDelete");
    let ids;
    try {
      ids = parseIds(req.body?.ids);
    } catch (err) {
      return res.status(err.status || 400).json({ success: false, message: err.message });
    }

    const { deletedCount } = await Notification.deleteMany({
      _id: { $in: ids },
      user: req.user._id,
    });

    return res.status(200).json({
      success: true,
      message: `${deletedCount} notification${deletedCount === 1 ? "" : "s"} deleted.`,
      deletedCount,
    });
  } catch (error) {
    console.log("BULK DELETE NOTIFICATIONS ERROR:", error.message);
    return handleError(res, error);
  }
};

// Delete all of the current user's own notifications (their personal scope).
// Staff/system notifications assigned to other users are preserved.
const clearAllNotifications = async (req, res) => {
  try {
    const { deletedCount } = await Notification.deleteMany({ user: req.user._id });
    return res.status(200).json({
      success: true,
      message: `${deletedCount} notification${deletedCount === 1 ? "" : "s"} deleted.`,
      deletedCount,
    });
  } catch (error) {
    console.log("CLEAR ALL NOTIFICATIONS ERROR:", error.message);
    return handleError(res, error);
  }
};

module.exports = { getMyNotifications, markAsRead, markAllAsRead, bulkDeleteNotifications, clearAllNotifications };
