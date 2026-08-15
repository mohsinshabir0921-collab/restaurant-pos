const Category = require("../models/Category");
const MenuItem = require("../models/MenuItem");
const { handleError } = require("../utils/httpError");

const getCategories = async (req, res) => {
  try {
    const { activeOnly = "false", includeItems = "false" } = req.query;
    const query = activeOnly === "true" ? { isActive: true } : {};

    let categories = await Category.find(query).sort({ displayOrder: 1, name: 1 }).lean();

    if (includeItems === "true") {
      for (let cat of categories) {
        cat.items = await MenuItem.find({ category: cat._id, isAvailable: true })
          .select("name price isVeg spiceLevel prepTime image")
          .sort({ displayOrder: 1, name: 1 })
          .lean();
      }
    }

    return res.status(200).json({
      success: true,
      categories,
    });
  } catch (error) {
    console.log("GET CATEGORIES ERROR:", error);
    return handleError(res, error);
  }
};

const getCategoryById = async (req, res) => {
  try {
    const { id } = req.params;
    const category = await Category.findById(id).lean();

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    return res.status(200).json({
      success: true,
      category,
    });
  } catch (error) {
    console.log("GET CATEGORY ERROR:", error);
    return handleError(res, error);
  }
};

const createCategory = async (req, res) => {
  try {
    const { name, description, displayOrder, isActive, image, parentCategory } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Category name is required",
      });
    }

    const existingCategory = await Category.findOne({ name: name.trim() });
    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: "Category with this name already exists",
      });
    }

    let orderValue = displayOrder;
    if (orderValue !== undefined && orderValue !== "") {
      orderValue = Number(orderValue);
      if (!Number.isFinite(orderValue)) {
        return res.status(400).json({ success: false, message: "Display order must be a valid number" });
      }
    }

    const maxOrder = await Category.findOne().sort({ displayOrder: -1 }).select("displayOrder").lean();
    const nextOrder = maxOrder ? maxOrder.displayOrder + 1 : 0;

    const category = await Category.create({
      name: name.trim(),
      description: description?.trim() || "",
      displayOrder: orderValue !== undefined ? orderValue : nextOrder,
      isActive: isActive !== undefined ? isActive : true,
      image: image || "",
      parentCategory: parentCategory || null,
    });

    return res.status(201).json({
      success: true,
      message: "Category created successfully",
      category,
    });
  } catch (error) {
    console.log("CREATE CATEGORY ERROR:", error);
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Category with this name already exists" });
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

const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, displayOrder, isActive, image, parentCategory } = req.body;

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName) {
        return res.status(400).json({
          success: false,
          message: "Category name is required",
        });
      }
      const existingCategory = await Category.findOne({ name: trimmedName, _id: { $ne: id } });
      if (existingCategory) {
        return res.status(400).json({
          success: false,
          message: "Category with this name already exists",
        });
      }
      category.name = trimmedName;
    }

    if (description !== undefined) category.description = description.trim();
    if (displayOrder !== undefined && displayOrder !== "") {
      const orderValue = Number(displayOrder);
      if (!Number.isFinite(orderValue)) {
        return res.status(400).json({ success: false, message: "Display order must be a valid number" });
      }
      category.displayOrder = orderValue;
    }
    if (isActive !== undefined) category.isActive = isActive;
    if (image !== undefined) category.image = image;
    if (parentCategory !== undefined) {
      if (parentCategory === id) {
        return res.status(400).json({
          success: false,
          message: "Category cannot be its own parent",
        });
      }
      category.parentCategory = parentCategory || null;
    }

    await category.save();

    return res.status(200).json({
      success: true,
      message: "Category updated successfully",
      category,
    });
  } catch (error) {
    console.log("UPDATE CATEGORY ERROR:", error);
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Category with this name already exists" });
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

const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const itemCount = await MenuItem.countDocuments({ category: id });
    if (itemCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category with ${itemCount} menu items. Move or delete items first.`,
      });
    }

    const category = await Category.findByIdAndDelete(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Category deleted successfully",
    });
  } catch (error) {
    console.log("DELETE CATEGORY ERROR:", error);
    return handleError(res, error);
  }
};

const reorderCategories = async (req, res) => {
  try {
    const { categoryOrders } = req.body;

    if (!Array.isArray(categoryOrders) || categoryOrders.length === 0) {
      return res.status(400).json({
        success: false,
        message: "categoryOrders array is required",
      });
    }

    const bulkOps = categoryOrders.map((item, index) => ({
      updateOne: {
        filter: { _id: item.id },
        update: { displayOrder: item.order !== undefined ? item.order : index },
      },
    }));

    await Category.bulkWrite(bulkOps);

    return res.status(200).json({
      success: true,
      message: "Categories reordered successfully",
    });
  } catch (error) {
    console.log("REORDER CATEGORIES ERROR:", error);
    return handleError(res, error);
  }
};

module.exports = {
  getCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
};