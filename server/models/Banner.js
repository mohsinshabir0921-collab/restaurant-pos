const mongoose = require("mongoose");

const bannerSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    couponCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    ctaText: {
      type: String,
      trim: true,
      default: "",
    },
    ctaLink: {
      type: String,
      trim: true,
      default: "",
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

bannerSchema.index({ isActive: 1, startDate: 1, endDate: 1, sortOrder: 1 });

bannerSchema.path("endDate").validate(function (value) {
  return value && this.startDate && value > this.startDate;
}, "End date must be after start date");

// Pure date-window predicate so the "currently live" logic can be unit tested
// without a database connection. The server (not the client) decides which
// banners are shown to the public.
const isActiveAt = (banner, now = new Date()) => {
  const start = new Date(banner.startDate);
  const end = new Date(banner.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  return Boolean(banner.isActive) && start <= now && end >= now;
};
bannerSchema.statics.isActiveAt = isActiveAt;

// Active banners only: enabled, not yet started excluded, expired excluded.
bannerSchema.statics.findActive = async function () {
  const now = new Date();
  return this.find({
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
  })
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
};

module.exports = mongoose.model("Banner", bannerSchema);