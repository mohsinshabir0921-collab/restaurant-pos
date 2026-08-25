// Pure, dependency-free migration planning for the menu reseed.
// This module never connects to a database and never performs writes.
// Both inspectMenuDeps.js (read-only) and migrateMenuSafe.js (gated writes)
// build their plan here so the two can never drift apart.

const { baseName, buildSizeModifier, PREP } = require("./menuSeedData");
const { imagePathForName } = require("./menuImages");

// Build the MenuItem document fields for a given source item + resolved category id.
function toMenuItemDoc(item, categoryId) {
  const basePrice = item.sizes ? item.sizes[0].price : item.price;
  return {
    name: item.name,
    description: item.description || "",
    price: basePrice,
    category: categoryId,
    isVeg: item.isVeg !== undefined ? item.isVeg : true,
    prepTime: PREP[item.category] || 15,
    isAvailable: true,
    taxRate: 0,
    displayOrder: 0,
    image: imagePathForName(item.name),
    modifiers: buildSizeModifier(item),
  };
}

// Build a complete migration plan from already-loaded collections.
// All inputs are plain arrays of documents (or plain objects).
function buildPlan({ oldCategories, oldItems, oldRecipes, oldCoupons, oldOrders, newCategories, newItems }) {
  // ---- Categories ----
  const oldCatByName = {};
  (oldCategories || []).forEach((c) => {
    oldCatByName[c.name] = c;
  });
  const categoryPlan = (newCategories || []).map((nc) => {
    const existing = oldCatByName[nc.name];
    return {
      name: nc.name,
      action: existing ? "update" : "insert",
      existingId: existing ? String(existing._id) : null,
    };
  });

  // ---- Items ----
  const oldByBase = {};
  (oldItems || []).forEach((it) => {
    const bn = baseName(it.name);
    if (!oldByBase[bn]) oldByBase[bn] = [];
    oldByBase[bn].push(it);
  });

  const itemPlan = [];
  const keptOldIds = new Set();

  (newItems || []).forEach((ni) => {
    const bn = baseName(ni.name);
    const matches = oldByBase[bn] || [];
    if (matches.length === 0) {
      itemPlan.push({
        name: ni.name,
        baseName: bn,
        action: "insert",
        reuseId: null,
        matchedOldIds: [],
        deleteOldIds: [],
        source: ni,
      });
      return;
    }
    // Reuse the lowest-priced old variant (the base size) as the consolidated doc.
    const reuse = matches.reduce((a, b) => ((a.price || 0) <= (b.price || 0) ? a : b));
    const deleteOldIds = matches.filter((m) => String(m._id) !== String(reuse._id)).map((m) => String(m._id));
    keptOldIds.add(String(reuse._id));
    itemPlan.push({
      name: ni.name,
      baseName: bn,
      action: "update",
      reuseId: String(reuse._id),
      matchedOldIds: matches.map((m) => String(m._id)),
      deleteOldIds,
      source: ni,
    });
  });

  // Any old item not kept becomes obsolete (extra size variant or removed dish).
  const deleteOldItemIds = (oldItems || [])
    .map((it) => String(it._id))
    .filter((id) => !keptOldIds.has(id));

  // ---- Recipes ----
  const oldItemById = {};
  (oldItems || []).forEach((it) => {
    oldItemById[String(it._id)] = it;
  });
  const newItemByBase = {};
  itemPlan.forEach((p) => {
    newItemByBase[p.baseName] = p.name;
  });

  const recipePlan = (oldRecipes || []).map((r) => {
    const oldItem = oldItemById[String(r.menuItem)];
    if (!oldItem) {
      return { recipeId: String(r._id), oldItemName: null, targetNewName: null, action: "orphan-already" };
    }
    const bn = baseName(oldItem.name);
    const target = newItemByBase[bn];
    return {
      recipeId: String(r._id),
      oldItemName: oldItem.name,
      targetNewName: target || null,
      action: target ? "relink" : "orphan",
    };
  });

  // ---- Coupons ----
  // Categories are preserved by name (same _id), so category refs stay valid.
  // Item refs are remapped old _id -> consolidated new _id by base name.
  const oldToNewByBase = {};
  itemPlan.forEach((p) => {
    p.matchedOldIds.forEach((oid) => {
      oldToNewByBase[oid] = p.baseName; // maps to a base name; resolved later to an _id
    });
  });
  const newIdByBase = {}; // filled during execution; for planning we use names

  const couponPlan = (oldCoupons || []).map((c) => {
    const remap = (ids) =>
      (ids || [])
        .map((id) => {
          const bn = oldToNewByBase[String(id)];
          return bn ? { oldId: String(id), targetBase: bn } : null;
        })
        .filter(Boolean);
    const appBefore = c.applicableItems || [];
    const exBefore = c.excludedItems || [];
    const appMapped = remap(appBefore);
    const exMapped = remap(exBefore);
    const changed =
      appMapped.length !== appBefore.length || exMapped.length !== exBefore.length;
    return {
      couponId: String(c._id),
      code: c.code || null,
      applicableBefore: appBefore.length,
      excludedBefore: exBefore.length,
      applicableMapped: appMapped.length,
      excludedMapped: exMapped.length,
      changed,
    };
  });

  // ---- Orders (optional repair impact) ----
  let ordersAffected = 0;
  let orderItemRepairs = 0;
  (oldOrders || []).forEach((o) => {
    const items = o.items || [];
    let touched = false;
    items.forEach((it) => {
      const mid = it.menuItemId ? String(it.menuItemId) : null;
      if (!mid) return;
      if (keptOldIds.has(mid)) return; // still valid (preserved)
      const oldItem = oldItemById[mid];
      if (!oldItem) return; // already dangling
      const bn = baseName(oldItem.name);
      if (newItemByBase[bn]) {
        touched = true;
        orderItemRepairs += 1;
      }
    });
    if (touched) ordersAffected += 1;
  });

  return {
    categoryPlan,
    itemPlan,
    deleteOldItemIds,
    recipePlan,
    couponPlan,
    orderImpact: { ordersAffected, orderItemRepairs },
    summary: {
      categories: categoryPlan.length,
      categoriesInsert: categoryPlan.filter((c) => c.action === "insert").length,
      categoriesUpdate: categoryPlan.filter((c) => c.action === "update").length,
      items: itemPlan.length,
      itemsInsert: itemPlan.filter((i) => i.action === "insert").length,
      itemsUpdate: itemPlan.filter((i) => i.action === "update").length,
      itemsToDelete: deleteOldItemIds.length,
      recipes: recipePlan.length,
      recipesRelink: recipePlan.filter((r) => r.action === "relink").length,
      recipesOrphan: recipePlan.filter((r) => r.action !== "relink").length,
      coupons: couponPlan.length,
      couponsChanged: couponPlan.filter((c) => c.changed).length,
      ordersAffected,
      orderItemRepairs,
    },
  };
}

module.exports = { buildPlan, toMenuItemDoc, baseName };
