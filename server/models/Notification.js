const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      required: true,
      enum: ["order", "inventory", "customer", "staff", "payment", "system"],
      default: "system",
    },
    title: { type: String, required: true, trim: true },
    message: { type: String, trim: true },
    link: { type: String, default: "/" },
    entityId: { type: mongoose.Schema.Types.ObjectId },
    read: { type: Boolean, default: false },
    readAt: { type: Date },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
