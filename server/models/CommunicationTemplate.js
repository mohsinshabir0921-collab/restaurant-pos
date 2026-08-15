const mongoose = require("mongoose");

const communicationTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    type: { type: String, enum: ["sms", "whatsapp", "email", "push"], required: true, index: true },
    trigger: {
      type: String,
      enum: [
        "order_placed",
        "order_confirmed",
        "order_preparing",
        "order_ready",
        "order_served",
        "order_paid",
        "order_cancelled",
        "delivery_assigned",
        "delivery_picked",
        "delivery_delivered",
        "pickup_ready",
        "payment_received",
        "payment_failed",
        "refund_initiated",
        "refund_completed",
        "loyalty_points_earned",
        "loyalty_points_redeemed",
        "loyalty_tier_upgraded",
        "birthday_wish",
        "anniversary_wish",
        "welcome",
        "feedback_request",
        "promotional",
        "low_stock_alert",
        "waste_alert",
        "daily_summary",
        "shift_summary",
      ],
      required: true,
      index: true,
    },
    subject: { type: String, trim: true },
    content: { type: String, required: true },
    variables: [{
      name: { type: String, required: true },
      description: { type: String },
      example: { type: String },
      required: { type: Boolean, default: true },
    }],
    isActive: { type: Boolean, default: true, index: true },
    sendDelayMinutes: { type: Number, default: 0, min: 0 },
    conditions: [{
      field: { type: String, required: true },
      operator: { type: String, enum: ["equals", "not_equals", "greater_than", "less_than", "contains", "in"], required: true },
      value: { type: mongoose.Schema.Types.Mixed, required: true },
    }],
    priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
    fallbackTemplate: { type: mongoose.Schema.Types.ObjectId, ref: "CommunicationTemplate" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

communicationTemplateSchema.index({ trigger: 1, isActive: 1 });
communicationTemplateSchema.index({ type: 1, isActive: 1 });

communicationTemplateSchema.statics.getByTrigger = async function (trigger, type = null) {
  const query = { trigger, isActive: true };
  if (type) query.type = type;
  return this.find(query).sort({ priority: -1, createdAt: -1 });
};

communicationTemplateSchema.methods.render = function (data = {}) {
  let rendered = this.content;
  let renderedSubject = this.subject || "";

  this.variables.forEach(variable => {
    const value = data[variable.name] || variable.example || "";
    const placeholder = `{{${variable.name}}}`;
    rendered = rendered.replace(new RegExp(placeholder, "g"), value);
    renderedSubject = renderedSubject.replace(new RegExp(placeholder, "g"), value);
  });

  return { subject: renderedSubject, content: rendered };
};

module.exports = mongoose.model("CommunicationTemplate", communicationTemplateSchema);