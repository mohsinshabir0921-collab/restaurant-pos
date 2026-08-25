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
const { buildPlan, baseName } = require("../menuMigrate");
const { runMigration } = require("../migrationRunner");

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

// POST /api/migration/apply  —  WRITE operation (gated).
// Requires admin auth AND an explicit `confirm: true` body flag. Creates a
// timestamped in-DB backup FIRST and aborts entirely if the backup fails.
// Never uses deleteMany({}); obsolete items are deleted one-by-one by exact _id.
router.post("/apply", protect, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.confirm) {
      return res.status(400).json({ success: false, message: "Refusing to migrate: 'confirm: true' is required." });
    }
    const result = await runMigration({ repairOrders: !!body.repairOrders });
    res.json({ success: true, result });
  } catch (err) {
    console.error("Migration apply error:", err && err.stack ? err.stack : err);
    res.status(500).json({ success: false, message: "Migration aborted — database left unchanged.", error: err && err.message ? err.message : String(err) });
  }
});

// GET /api/migration/verify  —  read-only post-migration checks against LIVE DB.
router.get("/verify", protect, requireAdmin, async (req, res) => {
  try {
    const [cats, items, recipes, coupons, orders] = await Promise.all([
      Category.find({}).lean(),
      MenuItem.find({}).lean(),
      Recipe.find({}).lean(),
      Coupon.find({}).lean(),
      Order.find({}).lean(),
    ]);

    const itemIds = new Set(items.map((i) => String(i._id)));
    const catIds = new Set(cats.map((c) => String(c._id)));

    const nameCount = {};
    items.forEach((i) => (nameCount[i.name] = (nameCount[i.name] || 0) + 1));
    const duplicateNames = Object.keys(nameCount).filter((n) => nameCount[n] > 1);

    const kNon = items.find((i) => i.name === "Khyenn Chyenn Special");
    const kVeg = items.find((i) => i.name === "Khyenn Chyenn Special (Veg)");
    const bothKhyenn = !!(kNon && kVeg && String(kNon._id) !== String(kVeg._id));

    const recipeOrphans = recipes
      .filter((r) => !itemIds.has(String(r.menuItem)))
      .map((r) => ({ recipeId: String(r._id), menuItem: String(r.menuItem) }));

    const couponIssues = coupons
      .map((c) => {
        const issue = { code: c.code };
        const badItems = (c.applicableItems || []).concat(c.excludedItems || []).filter((id) => !itemIds.has(String(id)));
        const badCats = (c.applicableCategories || []).concat(c.excludedCategories || []).filter((id) => !catIds.has(String(id)));
        if (badItems.length) issue.badItemRefs = badItems;
        if (badCats.length) issue.badCategoryRefs = badCats;
        return issue;
      })
      .filter((x) => x.badItemRefs || x.badCategoryRefs);

    let dangling = 0;
    const danglingLines = [];
    orders.forEach((o) => {
      (o.items || []).forEach((it) => {
        const mid = it.menuItemId ? String(it.menuItemId) : null;
        if (mid && !itemIds.has(mid)) {
          dangling += 1;
          danglingLines.push({ orderId: String(o._id), menuItemId: mid, name: it.name });
        }
      });
    });

    const sizeMismatches = [];
    const itemByName = {};
    items.forEach((i) => (itemByName[i.name] = i));
    for (const m of menuItems) {
      if (!m.sizes || !m.sizes.length) continue;
      const doc = itemByName[m.name];
      if (!doc) { sizeMismatches.push({ name: m.name, issue: "missing migrated doc" }); continue; }
      if (!Array.isArray(doc.modifiers)) { sizeMismatches.push({ name: m.name, issue: "no modifiers array" }); continue; }
      const sizeMod = doc.modifiers.find((x) => x.name === "Size");
      if (!sizeMod) { sizeMismatches.push({ name: m.name, issue: "no Size modifier" }); continue; }
      if (sizeMod.options.length !== m.sizes.length) {
        sizeMismatches.push({ name: m.name, issue: `option count ${sizeMod.options.length} != ${m.sizes.length}` });
        continue;
      }
      for (const s of m.sizes) {
        const opt = sizeMod.options.find((o) => o.name === s.label);
        if (!opt) { sizeMismatches.push({ name: m.name, issue: `missing option ${s.label}` }); continue; }
        const expected = Math.round((s.price - doc.price) * 100) / 100;
        if (Math.round(opt.price * 100) / 100 !== expected) {
          sizeMismatches.push({ name: m.name, issue: `option ${s.label} price ${opt.price} != ${expected}` });
        }
      }
    }

    const checks = {
      categories: { actual: cats.length, expected: 13, pass: cats.length === 13 },
      menuItems: { actual: items.length, expected: 87, pass: items.length === 87 },
      recipes: { actual: recipes.length, expected: 1, pass: recipes.length === 1 && recipeOrphans.length === 0, orphans: recipeOrphans.length },
      coupons: { actual: coupons.length, expected: 1, pass: coupons.length === 1 && couponIssues.length === 0, issues: couponIssues.length },
      orders: { actual: orders.length, expected: 138, pass: orders.length === 138, dangling },
      bothKhyennDishes: { pass: bothKhyenn },
      duplicateNames: { pass: duplicateNames.length === 0, duplicates: duplicateNames },
      sizeModifiers: { pass: sizeMismatches.length === 0, mismatches: sizeMismatches },
    };
    const allPass = Object.values(checks).every((c) => c.pass);

    res.json({ success: true, allPass, counts: { categories: cats.length, menuItems: items.length, recipes: recipes.length, coupons: coupons.length, orders: orders.length }, checks, danglingLines });
  } catch (err) {
    console.error("Migration verify error:", err && err.stack ? err.stack : err);
    res.status(500).json({ success: false, message: "Verify failed", error: err && err.message ? err.message : String(err) });
  }
});

// POST /api/migration/cleanup-orders  —  WRITE (gated). Nulls any order line
// menuItemId that no longer references an existing MenuItem (preserves the
// denormalized name/price). Used to satisfy referential integrity after the
// obsolete items are deleted. Requires explicit confirm.
router.post("/cleanup-orders", protect, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.confirm) {
      return res.status(400).json({ success: false, message: "Refusing: 'confirm: true' is required." });
    }
    const items = await MenuItem.find({}, { _id: 1 }).lean();
    const ids = new Set(items.map((i) => String(i._id)));
    const orders = await Order.find({}).lean();
    let nulled = 0;
    for (const o of orders) {
      let changed = false;
      const newItems = (o.items || []).map((it) => {
        const mid = it.menuItemId ? String(it.menuItemId) : null;
        if (mid && !ids.has(mid)) {
          changed = true;
          return { ...it, menuItemId: null };
        }
        return it;
      });
      if (changed) {
        await Order.updateOne({ _id: o._id }, { $set: { items: newItems } });
        nulled += 1;
      }
    }
    res.json({ success: true, ordersUpdated: nulled });
  } catch (err) {
    console.error("cleanup error:", err && err.stack ? err.stack : err);
    res.status(500).json({ success: false, message: "cleanup failed", error: err && err.message ? err.message : String(err) });
  }
});

module.exports = router;
