const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    description: {
      type: String,
      trim: true,
    },
    group: {
      type: String,
      default: "general",
      enum: ["general", "restaurant", "tax", "printing", "notifications", "loyalty", "payment"],
    },
    isPublic: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const defaultSettings = [
  { key: "restaurant_name", value: "Khyenn Chyenn", description: "Restaurant name", group: "restaurant", isPublic: true },
  { key: "restaurant_address", value: "", description: "Restaurant address", group: "restaurant", isPublic: true },
  { key: "restaurant_latitude", value: "", description: "Restaurant latitude for delivery distance calculation", group: "restaurant" },
  { key: "restaurant_longitude", value: "", description: "Restaurant longitude for delivery distance calculation", group: "restaurant" },
  { key: "restaurant_phone", value: "", description: "Restaurant phone", group: "restaurant", isPublic: true },
  { key: "restaurant_email", value: "", description: "Restaurant email", group: "restaurant", isPublic: true },
  { key: "restaurant_tagline", value: "Experience the finest flavors crafted with passion", description: "Website hero tagline", group: "restaurant", isPublic: true },
  { key: "restaurant_description", value: "", description: "Short restaurant description used on the website", group: "restaurant", isPublic: true },
  { key: "about_content", value: "", description: "About section content for the public website", group: "restaurant", isPublic: true },
  { key: "hero_image", value: "", description: "Website hero image URL", group: "restaurant", isPublic: true },
  { key: "hero_video", value: "", description: "Website hero video URL", group: "restaurant", isPublic: true },
  { key: "about_image", value: "", description: "About section image URL", group: "restaurant", isPublic: true },
  { key: "opening_hours", value: JSON.stringify({
    monday: { open: "11:00", close: "23:00" },
    tuesday: { open: "11:00", close: "23:00" },
    wednesday: { open: "11:00", close: "23:00" },
    thursday: { open: "11:00", close: "23:00" },
    friday: { open: "11:00", close: "23:00" },
    saturday: { open: "11:00", close: "23:00" },
    sunday: { open: "12:00", close: "22:00" },
  }), description: "Opening hours for the website (JSON)", group: "restaurant", isPublic: true },
  { key: "takeaway_enabled", value: true, description: "Allow takeaway orders on the public website", group: "restaurant", isPublic: true },
  { key: "delivery_enabled", value: true, description: "Allow delivery orders on the public website", group: "restaurant", isPublic: true },
  { key: "cash_payment_enabled", value: true, description: "Allow cash/cash-on-delivery payment on the website", group: "restaurant", isPublic: true },
  { key: "online_payment_enabled", value: true, description: "Allow Cashfree online payments on the website", group: "restaurant", isPublic: true },
  { key: "website_enabled", value: true, description: "Enable the public website", group: "restaurant", isPublic: true },
  { key: "delivery_fee", value: 0, description: "Base/minimum delivery fee (₹). Applied as a floor to the distance-based fee; 0 = pure distance-based pricing", group: "restaurant" },
  { key: "min_promo_order_value", value: 700, description: "Minimum order value (₹) required to use a promo code on the public website (bulk-order promos)", group: "restaurant" },
  { key: "instagram_url", value: "", description: "Instagram URL", group: "restaurant", isPublic: true },
  { key: "facebook_url", value: "", description: "Facebook URL", group: "restaurant", isPublic: true },
  { key: "twitter_url", value: "", description: "Twitter/X URL", group: "restaurant", isPublic: true },
  { key: "whatsapp_number", value: "", description: "WhatsApp number for contact (with country code)", group: "restaurant", isPublic: true },
  { key: "gstin", value: "", description: "GSTIN number", group: "tax", isPublic: true },
  { key: "currency", value: "INR", description: "Currency code", group: "general", isPublic: true },
  { key: "tax_inclusive", value: false, description: "Prices include tax", group: "tax" },
  { key: "default_cgst", value: 2.5, description: "Default CGST %", group: "tax" },
  { key: "default_sgst", value: 2.5, description: "Default SGST %", group: "tax" },
  { key: "default_igst", value: 5, description: "Default IGST %", group: "tax" },
  { key: "service_charge_percent", value: 0, description: "Service charge %", group: "tax" },
  { key: "service_charge_enabled", value: false, description: "Enable service charge", group: "tax" },
  { key: "thermal_printer_enabled", value: true, description: "Enable thermal printing", group: "printing" },
  { key: "thermal_printer_port", value: "", description: "Printer port (COM3, /dev/usb/lp0)", group: "printing" },
  { key: "kot_auto_print", value: true, description: "Auto-print KOT on order", group: "printing" },
  { key: "receipt_header", value: "", description: "Receipt header text", group: "printing" },
  { key: "receipt_footer", value: "Thank you for visiting!", description: "Receipt footer text", group: "printing" },
  { key: "sms_enabled", value: false, description: "Enable SMS notifications", group: "notifications" },
  { key: "whatsapp_enabled", value: false, description: "Enable WhatsApp notifications", group: "notifications" },
  { key: "email_enabled", value: false, description: "Enable email notifications", group: "notifications" },
  { key: "cashfree_client_id", value: process.env.CASHFREE_CLIENT_ID || "", description: "Cashfree Client ID for online payments", group: "payment" },
  {
    key: "payment_methods",
    value: [
      { id: "cash", label: "Cash", description: "Pay by physical cash", enabled: true },
      { id: "upi", label: "UPI", description: "Pay online via UPI", enabled: true },
      { id: "card", label: "Card", description: "Pay online via card", enabled: true },
      { id: "wallet", label: "Wallet", description: "Pay via digital wallet", enabled: true },
      { id: "cod", label: "Cash on Delivery", description: "Pay cash on delivery", enabled: true },
    ],
    description: "Configurable payment methods available for the store (JSON array)",
    group: "payment",
    isPublic: true,
  },
];

settingsSchema.statics.initializeDefaults = async function () {
  for (const setting of defaultSettings) {
    const { group, isPublic, ...rest } = setting;
    await this.findOneAndUpdate(
      { key: setting.key },
      { $setOnInsert: rest, $set: { group, isPublic: isPublic ?? false } },
      { upsert: true, new: true }
    );
  }
};

settingsSchema.statics.getPublicSettings = async function () {
  const settings = await this.find({ isPublic: true }).lean();
  return settings.reduce((acc, s) => {
    acc[s.key] = s.value;
    return acc;
  }, {});
};

settingsSchema.statics.getGroup = async function (group) {
  const settings = await this.find({ group }).lean();
  return settings.reduce((acc, s) => {
    acc[s.key] = s.value;
    return acc;
  }, {});
};

settingsSchema.statics.getValue = async function (key, defaultValue = null) {
  const setting = await this.findOne({ key }).lean();
  return setting ? setting.value : defaultValue;
};

settingsSchema.statics.setValue = async function (key, value, description, group) {
  const update = { value };
  if (description !== undefined) update.description = description;
  if (group !== undefined) update.group = group;
  return this.findOneAndUpdate(
    { key },
    update,
    { upsert: true, new: true, runValidators: true }
  );
};

module.exports = mongoose.model("Settings", settingsSchema);