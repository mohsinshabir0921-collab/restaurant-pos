/**
 * Backfill halfPrice/fullPrice for existing MenuItems.
 * - For items with a Size modifier containing Half/Full options, halfPrice = base price,
 *   fullPrice = base price + Full delta (so no price changes).
 * - For all other items, halfPrice = fullPrice = price.
 * - Also zeroes modifier deltas for Half/Full so future pricing uses independent fields.
 * Idempotent and safe to run multiple times.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const MenuItem = require("../models/MenuItem");

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI not set");
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log("Connected to MongoDB");

  const items = await MenuItem.find({});
  let updated = 0;
  for (const item of items) {
    const price = Number(item.price) || 0;
    let halfPrice = item.halfPrice;
    let fullPrice = item.fullPrice;
    let needsUpdate = false;

    // Detect Half/Full size modifier
    let sizeMod = null;
    if (Array.isArray(item.modifiers)) {
      sizeMod = item.modifiers.find((m) => m && /size|variant/i.test(m.name || ""));
    }
    const hasHalfFull = (() => {
      if (!sizeMod || !Array.isArray(sizeMod.options)) return false;
      const names = sizeMod.options.map((o) => String(o.name || "").toLowerCase().trim());
      return names.includes("half") && names.includes("full");
    })();

    if (hasHalfFull) {
      const halfOpt = sizeMod.options.find((o) => String(o.name).toLowerCase().trim() === "half");
      const fullOpt = sizeMod.options.find((o) => String(o.name).toLowerCase().trim() === "full");
      const halfDelta = Number(halfOpt?.price) || 0;
      const fullDelta = Number(fullOpt?.price) || 0;
      // If halfPrice/fullPrice not set or inconsistent with old delta model, recompute from price+delta.
      // But if they are already set correctly (halfPrice != null), preserve them.
      const expectedHalf = price + halfDelta;
      const expectedFull = price + fullDelta;
      if (halfPrice == null || !Number.isFinite(Number(halfPrice))) {
        halfPrice = expectedHalf;
        needsUpdate = true;
      }
      if (fullPrice == null || !Number.isFinite(Number(fullPrice))) {
        fullPrice = expectedFull;
        needsUpdate = true;
      }
      // Zero deltas for Half/Full so pricing uses independent fields
      let deltasZeroed = false;
      for (const opt of sizeMod.options) {
        const lower = String(opt.name).toLowerCase().trim();
        if ((lower === "half" || lower === "full") && Number(opt.price) !== 0) {
          opt.price = 0;
          deltasZeroed = true;
        }
      }
      if (deltasZeroed) {
        item.markModified("modifiers");
        needsUpdate = true;
      }
    } else {
      // No Half/Full: ensure half/full mirror price
      if (halfPrice == null || !Number.isFinite(Number(halfPrice))) {
        halfPrice = price;
        needsUpdate = true;
      }
      if (fullPrice == null || !Number.isFinite(Number(fullPrice))) {
        fullPrice = price;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      item.halfPrice = halfPrice;
      item.fullPrice = fullPrice;
      await item.save();
      updated += 1;
      console.log(`Updated ${item.name}: halfPrice=${halfPrice} fullPrice=${fullPrice} ${hasHalfFull ? "[Half/Full]" : ""}`);
    }
  }

  console.log(`Done. Updated ${updated}/${items.length} items`);
  await mongoose.connection.close();
}

if (require.main === module) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { run };
