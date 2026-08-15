const mongoose = require("mongoose");

const tableSchema = new mongoose.Schema(
  {
    number: {
      type: Number,
      required: true,
      unique: true,
      min: 1,
    },
    name: {
      type: String,
      trim: true,
    },
    capacity: {
      type: Number,
      required: true,
      min: 1,
      default: 4,
    },
    status: {
      type: String,
      enum: ["free", "occupied", "reserved", "cleaning", "maintenance"],
      default: "free",
    },
    zone: {
      type: String,
      trim: true,
      default: "Main Hall",
    },
    shape: {
      type: String,
      enum: ["rectangle", "circle", "square"],
      default: "rectangle",
    },
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
    },
    dimensions: {
      width: { type: Number, default: 80 },
      height: { type: Number, default: 80 },
    },
    rotation: {
      type: Number,
      default: 0,
    },
    currentOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

tableSchema.index({ zone: 1, number: 1 });
tableSchema.index({ status: 1 });

tableSchema.statics.getFloorPlan = async function () {
  const tables = await this.find({ isActive: true })
    .populate("currentOrder", "customerName orderStatus total createdAt")
    .sort({ zone: 1, number: 1 })
    .lean();
  
  const zones = {};
  tables.forEach(table => {
    if (!zones[table.zone]) zones[table.zone] = [];
    zones[table.zone].push(table);
  });
  
  return { zones, tables };
};

tableSchema.statics.getByStatus = async function (status) {
  return this.find({ status, isActive: true })
    .populate("currentOrder", "customerName orderStatus total createdAt")
    .sort({ zone: 1, number: 1 });
};

tableSchema.methods.occupy = async function (orderId) {
  this.status = "occupied";
  this.currentOrder = orderId;
  return this.save();
};

tableSchema.methods.free = async function () {
  this.status = "free";
  this.currentOrder = null;
  return this.save();
};

tableSchema.methods.reserve = async function () {
  this.status = "reserved";
  return this.save();
};

tableSchema.methods.setCleaning = async function () {
  this.status = "cleaning";
  return this.save();
};

module.exports = mongoose.model("Table", tableSchema);