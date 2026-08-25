// migrationRunner.js — executes the menu migration INSIDE the running app's
// existing mongoose connection (no connect/disconnect, no process.exit).
//
// SAFETY:
//   * Creates timestamped in-DB backups of every affected collection BEFORE
//     any write. If the backup fails, it throws and NOTHING is changed.
//   * Never calls deleteMany({}). Obsolete items are removed ONE BY ONE by
//     their exact _id (from the live plan).
//   * Category _ids are preserved by name; MenuItem _ids are reused where safe.
//   * Recipes/Coupons are re-linked by normalized base name; orders optionally
//     repaired.

const mongoose = require("mongoose");
const Category = require("./models/Category");
const MenuItem = require("./models/MenuItem");
const Recipe = require("./models/Recipe");
const Coupon = require("./models/Coupon");
const Order = require("./models/Order");
const { categories: newCategories, menuItems: newItems } = require("./menuSeedData");
const { buildPlan, toMenuItemDoc, baseName } = require("./menuMigrate");

// Copy live collections into <coll>_backup_<ts>. Throws on any failure so the
// caller aborts before writing anything.
async function backup(db) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const sets = [
    ["categories", await Category.find({}).lean()],
    ["menuitems", await MenuItem.find({}).lean()],
    ["recipes", await Recipe.find({}).lean()],
    ["coupons", await Coupon.find({}).lean()],
    ["orders", await Order.find({}).lean()],
  ];
  for (const [name, docs] of sets) {
    if (!docs || docs.length === 0) continue; // insertMany([]) is invalid
    const dst = `${name}_backup_${ts}`;
    await db.collection(dst).insertMany(docs.map((d) => JSON.parse(JSON.stringify(d))));
  }
  return ts;
}

async function runMigration({ repairOrders = false } = {}) {
  const db = mongoose.connection.db;

  const [oldCategories, oldItems, oldRecipes, oldCoupons, oldOrders] = await Promise.all([
    Category.find({}).lean(),
    MenuItem.find({}).lean(),
    Recipe.find({}).lean(),
    Coupon.find({}).lean(),
    Order.find({}, { "items.menuItemId": 1 }).lean(),
  ]);

  const plan = buildPlan({
    oldCategories, oldItems, oldRecipes, oldCoupons, oldOrders,
    newCategories, newItems,
  });

  // 1) BACKUP — abort completely if this throws.
  const ts = await backup(db);

  // 2) CATEGORIES (preserve _id by name).
  const categoryNameToId = {};
  for (const c of plan.categoryPlan) {
    if (c.action === "update") {
      await Category.updateOne(
        { _id: c.existingId },
        { $set: { name: c.name, displayOrder: 0, description: "", isActive: true } }
      );
      categoryNameToId[c.name] = c.existingId;
    } else {
      const created = await Category.create({
        name: c.name, displayOrder: 0, description: "", isActive: true,
      });
      categoryNameToId[c.name] = String(created._id);
    }
  }

  // 3) ITEMS (reuse lowest-size variant _id; insert new; collect id maps).
  const newIdByBase = {};
  const oldToNew = {};
  for (const p of plan.itemPlan) {
    const doc = toMenuItemDoc(p.source, categoryNameToId[p.source.category]);
    let targetId;
    if (p.action === "update") {
      await MenuItem.updateOne({ _id: p.reuseId }, { $set: doc });
      targetId = p.reuseId;
    } else {
      const created = await MenuItem.create(doc);
      targetId = String(created._id);
    }
    newIdByBase[p.baseName] = targetId;
    p.matchedOldIds.forEach((oid) => (oldToNew[oid] = targetId));
  }

  // 4) DELETE obsolete old items — individually by exact _id (NEVER deleteMany({})).
  let deleted = 0;
  for (const id of plan.deleteOldItemIds) {
    const res = await MenuItem.deleteOne({ _id: id });
    deleted += res.deletedCount || 0;
  }

  // 5) RECIPES re-link by base name.
  let relinked = 0;
  for (const r of plan.recipePlan) {
    if (r.action !== "relink") continue;
    const targetId = newIdByBase[baseName(r.targetNewName)];
    if (!targetId) continue;
    await Recipe.updateOne({ _id: r.recipeId }, { $set: { menuItem: targetId } });
    relinked += 1;
  }

  // 6) COUPONS re-link item refs (categories preserved by _id).
  let couponChanged = 0;
  for (const c of plan.couponPlan) {
    if (!c.changed) continue;
    const oldCoupon = oldCoupons.find((x) => String(x._id) === c.couponId);
    const remap = (ids) =>
      Array.from(new Set((ids || []).map((id) => oldToNew[String(id)]).filter(Boolean)));
    await Coupon.updateOne(
      { _id: c.couponId },
      {
        $set: {
          applicableItems: remap(oldCoupon.applicableItems),
          excludedItems: remap(oldCoupon.excludedItems),
        },
      }
    );
    couponChanged += 1;
  }

  // 7) ORDERS optional repair (unambiguous name match only).
  let orderUpdates = 0;
  if (repairOrders) {
    for (const o of oldOrders) {
      let changed = false;
      const newItemsArr = (o.items || []).map((it) => {
        const mid = it.menuItemId ? String(it.menuItemId) : null;
        if (mid && oldToNew[mid]) {
          changed = true;
          return { ...it, menuItemId: oldToNew[mid] };
        }
        return it;
      });
      if (changed) {
        await Order.updateOne({ _id: o._id }, { $set: { items: newItemsArr } });
        orderUpdates += 1;
      }
    }
  }

  return {
    backupTimestamp: ts,
    planSummary: plan.summary,
    obsoleteDeleted: deleted,
    recipesRelinked: relinked,
    couponsChanged: couponChanged,
    ordersRepaired: orderUpdates,
    repairOrders,
  };
}

module.exports = { runMigration };
