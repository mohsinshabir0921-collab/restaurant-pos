// TEMPORARY READ-ONLY migration inspection endpoint.
//
// This route ONLY reads from the database to produce the migration dry-run
// mapping (categories / items / recipes / coupons / orders). It never writes,
// never calls seedMenu/migrateMenuSafe, and never exposes MONGO_URI or any
// credentials. It is protected by the standard `protect` auth middleware plus
// an admin-role check. Remove this file (and its mount in index.js) before
// shipping the real migration endpoint.

const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const Category = require("../models/Category");
const MenuItem = require("../models/MenuItem");
const Recipe = require("../models/Recipe");
const Coupon = require("../models/Coupon");
const Order = require("../models/Order");
const { categories, menuItems } = require("../menuSeedData");
const { buildPlan } = require("../menuMigrate");

const router = express.Router();

// Reject non-admins with a clear 403.
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }
  next();
}

// GET /api/migration/inspect
// Produces the migration dry-run summary against the LIVE database.
// Strictly read-only: uses .lean() reads only. No writes of any kind.
router.get("/inspect", protect, requireAdmin, async (req, res) => {
  try {
    const [oldCategories, oldItems, oldRecipes, oldCoupons, oldOrders, orderCount] = await Promise.all([
      Category.find({}).lean(),
      MenuItem.find({}).lean(),
      Recipe.find({}).lean(),
      Coupon.find({}).lean(),
      Order.find({}, { "items.menuItemId": 1 }).lean(),
      Order.estimatedDocumentCount(),
    ]);

    const plan = buildPlan({
      oldCategories,
      oldItems,
      oldRecipes,
      oldCoupons,
      oldOrders,
      newCategories: categories,
      newItems: menuItems,
    });

    const oldNameById = {};
    oldItems.forEach((it) => (oldNameById[String(it._id)] = it.name));

    // Shape a concise, review-friendly mapping (no credentials, no raw docs).
    const categoryList = plan.categoryPlan.map((c) => ({
      name: c.name,
      action: c.action,
      keepId: c.existingId,
    }));

    const items = plan.itemPlan.map((p) => ({
      name: p.name,
      action: p.action,
      reuseId: p.reuseId,
      matchedOld: p.matchedOldIds.map((id) => ({ id, name: oldNameById[id] })),
      deleteOld: p.deleteOldIds.map((id) => ({ id, name: oldNameById[id] })),
    }));

    const newByName = {};
    menuItems.forEach((m) => (newByName[m.name] = m.name));

    const recipeOrphans = plan.recipePlan
      .filter((r) => r.action !== "relink")
      .map((r) => ({ recipeId: r.recipeId, oldItemName: r.oldItemName, targetNewName: r.targetNewName }));

    const couponsChanged = plan.couponPlan
      .filter((c) => c.changed)
      .map((c) => ({
        couponId: c.couponId,
        code: c.code,
        applicableBefore: c.applicableBefore,
        applicableAfter: c.applicableMapped,
        excludedBefore: c.excludedBefore,
        excludedAfter: c.excludedMapped,
      }));

    // Items with no prior match (true inserts) are the review focus.
    const unmatchedInserts = items.filter((i) => i.action === "insert").map((i) => i.name);

    const response = {
      success: true,
      mode: "dry-run (read-only, no writes performed)",
      liveCounts: {
        categories: oldCategories.length,
        menuItems: oldItems.length,
        recipes: oldRecipes.length,
        coupons: oldCoupons.length,
        orders: orderCount,
      },
      summary: plan.summary,
      categories: categoryList,
      items,
      unmatchedInserts,
      recipes: {
        relink: plan.summary.recipesRelink,
        orphan: plan.summary.recipesOrphan,
        orphans: recipeOrphans,
      },
      coupons: {
        changed: plan.summary.couponsChanged,
        changedList: couponsChanged,
      },
      orders: {
        affected: plan.orderImpact.ordersAffected,
        repairableLines: plan.orderImpact.orderItemRepairs,
        note: "Orders are never modified by the inspection. --repair-orders would only repair dangling menuItemId with an unambiguous match.",
      },
    };

    res.json(response);
  } catch (err) {
    console.error("Migration inspection error:", err && err.stack ? err.stack : err);
    res.status(500).json({ success: false, message: "Inspection failed", error: err && err.message ? err.message : String(err) });
  }
});

module.exports = router;
