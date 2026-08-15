const Table = require("../models/Table");
const Order = require("../models/Order");
const { handleError } = require("../utils/httpError");

const getTables = async (req, res) => {
  try {
    const { activeOnly = "true", zone } = req.query;
    const query = {};
    
    if (activeOnly === "true") query.isActive = true;
    if (zone) query.zone = zone;

    const tables = await Table.find(query)
      .populate("currentOrder", "customerName orderStatus total createdAt")
      .sort({ zone: 1, number: 1 })
      .lean();

    const zones = {};
    tables.forEach(table => {
      if (!zones[table.zone]) zones[table.zone] = [];
      zones[table.zone].push(table);
    });

    return res.status(200).json({
      success: true,
      tables,
      zones: Object.keys(zones).map(z => ({ name: z, tables: zones[z] })),
    });
  } catch (error) {
    console.log("GET TABLES ERROR:", error);
    return handleError(res, error);
  }
};

const getFloorPlan = async (req, res) => {
  try {
    const { zones, tables } = await Table.getFloorPlan();
    return res.status(200).json({
      success: true,
      zones,
      tables,
    });
  } catch (error) {
    console.log("GET FLOOR PLAN ERROR:", error);
    return handleError(res, error);
  }
};

const getTableById = async (req, res) => {
  try {
    const { id } = req.params;
    const table = await Table.findById(id)
      .populate("currentOrder", "customerName orderStatus total createdAt items")
      .lean();

    if (!table) {
      return res.status(404).json({
        success: false,
        message: "Table not found",
      });
    }

    return res.status(200).json({
      success: true,
      table,
    });
  } catch (error) {
    console.log("GET TABLE ERROR:", error);
    return handleError(res, error);
  }
};

const createTable = async (req, res) => {
  try {
    const { number, name, capacity, zone, shape, position, dimensions, rotation, isActive } = req.body;

    if (!number) {
      return res.status(400).json({
        success: false,
        message: "Table number is required",
      });
    }

    const existingTable = await Table.findOne({ number });
    if (existingTable) {
      return res.status(400).json({
        success: false,
        message: "Table with this number already exists",
      });
    }

    const table = await Table.create({
      number: Number(number),
      name: name?.trim() || "",
      capacity: Number(capacity) || 4,
      zone: zone?.trim() || "Main Hall",
      shape: shape || "rectangle",
      position: position || { x: 0, y: 0 },
      dimensions: dimensions || { width: 80, height: 80 },
      rotation: rotation || 0,
      isActive: isActive !== undefined ? isActive : true,
    });

    return res.status(201).json({
      success: true,
      message: "Table created successfully",
      table,
    });
  } catch (error) {
    console.log("CREATE TABLE ERROR:", error);
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Table with this number already exists" });
    }
    if (error.name === "ValidationError") {
      return handleError(res, error);
    }
    if (error.name === "CastError" || error.name === "BSONError") {
      return handleError(res, error);
    }
    return handleError(res, error);
  }
};

const updateTable = async (req, res) => {
  try {
    const { id } = req.params;
    const { number, name, capacity, zone, status, shape, position, dimensions, rotation, isActive, notes } = req.body;

    const table = await Table.findById(id);
    if (!table) {
      return res.status(404).json({
        success: false,
        message: "Table not found",
      });
    }

    if (number !== undefined) {
      const numericNumber = Number(number);
      if (!Number.isFinite(numericNumber) || numericNumber < 1) {
        return res.status(400).json({ success: false, message: "Table number must be a valid positive number" });
      }
      if (numericNumber !== table.number) {
        const existingTable = await Table.findOne({ number: numericNumber, _id: { $ne: id } });
        if (existingTable) {
          return res.status(400).json({
            success: false,
            message: "Table with this number already exists",
          });
        }
        table.number = numericNumber;
      }
    }

    if (name !== undefined) table.name = name.trim();
    if (capacity !== undefined) {
      const numericCapacity = Number(capacity);
      if (!Number.isFinite(numericCapacity)) {
        return res.status(400).json({ success: false, message: "Capacity must be a valid number" });
      }
      table.capacity = numericCapacity;
    }
    if (zone !== undefined) table.zone = zone.trim();
    if (status !== undefined) table.status = status;
    if (shape !== undefined) table.shape = shape;
    if (position !== undefined) table.position = position;
    if (dimensions !== undefined) table.dimensions = dimensions;
    if (rotation !== undefined) {
      const numericRotation = Number(rotation);
      if (!Number.isFinite(numericRotation)) {
        return res.status(400).json({ success: false, message: "Rotation must be a valid number" });
      }
      table.rotation = numericRotation;
    }
    if (isActive !== undefined) table.isActive = isActive;
    if (notes !== undefined) table.notes = notes.trim();

    await table.save();

    const populatedTable = await Table.findById(table._id)
      .populate("currentOrder", "customerName orderStatus total createdAt")
      .lean();

    return res.status(200).json({
      success: true,
      message: "Table updated successfully",
      table: populatedTable,
    });
  } catch (error) {
    console.log("UPDATE TABLE ERROR:", error);
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Table with this number already exists" });
    }
    if (error.name === "ValidationError") {
      return handleError(res, error);
    }
    if (error.name === "CastError" || error.name === "BSONError") {
      return handleError(res, error);
    }
    return handleError(res, error);
  }
};

const deleteTable = async (req, res) => {
  try {
    const { id } = req.params;

    const table = await Table.findById(id);
    if (!table) {
      return res.status(404).json({
        success: false,
        message: "Table not found",
      });
    }

    if (table.currentOrder) {
      const order = await Order.findById(table.currentOrder);
      if (order && !["paid", "completed", "cancelled", "refunded"].includes(order.orderStatus)) {
        return res.status(400).json({
          success: false,
          message: "Cannot delete table with active order",
        });
      }
    }

    await Table.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: "Table deleted successfully",
    });
  } catch (error) {
    console.log("DELETE TABLE ERROR:", error);
    return handleError(res, error);
  }
};

const updateTableStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ["free", "occupied", "reserved", "cleaning", "maintenance"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    const table = await Table.findById(id);
    if (!table) {
      return res.status(404).json({
        success: false,
        message: "Table not found",
      });
    }

    if (status === "occupied" && !table.currentOrder) {
      return res.status(400).json({
        success: false,
        message: "Cannot set occupied without an active order",
      });
    }

    if (status === "free" && table.currentOrder) {
      return res.status(400).json({
        success: false,
        message: "Cannot free table with active order. Complete or cancel order first.",
      });
    }

    table.status = status;
    await table.save();

    const populatedTable = await Table.findById(table._id)
      .populate("currentOrder", "customerName orderStatus total createdAt")
      .lean();

    return res.status(200).json({
      success: true,
      message: `Table status updated to ${status}`,
      table: populatedTable,
    });
  } catch (error) {
    console.log("UPDATE TABLE STATUS ERROR:", error);
    return handleError(res, error);
  }
};

const mergeTables = async (req, res) => {
  try {
    const { primaryTableId, secondaryTableIds } = req.body;

    if (!primaryTableId || !Array.isArray(secondaryTableIds) || secondaryTableIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Primary table and secondary tables are required",
      });
    }

    const primaryTable = await Table.findById(primaryTableId);
    if (!primaryTable) {
      return res.status(404).json({
        success: false,
        message: "Primary table not found",
      });
    }

    const secondaryTables = await Table.find({ _id: { $in: secondaryTableIds } });
    if (secondaryTables.length !== secondaryTableIds.length) {
      return res.status(404).json({
        success: false,
        message: "One or more secondary tables not found",
      });
    }

    const activeOrders = secondaryTables.filter(t => t.currentOrder);
    if (activeOrders.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot merge tables with active orders",
      });
    }

    const totalCapacity = secondaryTables.reduce((sum, t) => sum + t.capacity, primaryTable.capacity);
    primaryTable.capacity = totalCapacity;
    primaryTable.notes = `Merged with tables: ${secondaryTables.map(t => t.number).join(", ")}`;
    await primaryTable.save();

    await Table.updateMany(
      { _id: { $in: secondaryTableIds } },
      { isActive: false, status: "maintenance", notes: `Merged into table ${primaryTable.number}` }
    );

    return res.status(200).json({
      success: true,
      message: "Tables merged successfully",
      table: primaryTable,
    });
  } catch (error) {
    console.log("MERGE TABLES ERROR:", error);
    return handleError(res, error);
  }
};

const getTablesByStatus = async (req, res) => {
  try {
    const { status } = req.params;
    const tables = await Table.getByStatus(status);
    return res.status(200).json({
      success: true,
      tables,
    });
  } catch (error) {
    console.log("GET TABLES BY STATUS ERROR:", error);
    return handleError(res, error);
  }
};

module.exports = {
  getTables,
  getFloorPlan,
  getTableById,
  createTable,
  updateTable,
  deleteTable,
  updateTableStatus,
  mergeTables,
  getTablesByStatus,
};