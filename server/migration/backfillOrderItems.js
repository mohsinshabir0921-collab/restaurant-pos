/**
 * One-time migration to backfill malformed order items.
 * Finds orders where any item is missing required fields name/price/qty
 * and backfills from MenuItem (via menuItemId) where safely available.
 * Uses updateOne/$set (not document.save) because malformed docs fail validation.
 * Idempotent: only touches items where name/price/qty is missing, never overwrites valid fields.
 * Safe to run twice.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');
const Category = require('../models/Category');

async function backfillOrderItems() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }

  // Find orders where items array has an element missing name or price or qty
  // Using $elemMatch to detect at least one malformed item
  const malformedOrders = await Order.find({
    $or: [
      { "items.name": { $exists: false } },
      { "items.name": null },
      { "items.name": "" },
      { "items.price": { $exists: false } },
      { "items.price": null },
      { "items.qty": { $exists: false } },
      { "items.qty": null },
    ],
  }).lean();

  // Also catch orders where items were saved as lean objects missing those keys
  // The above query may not catch all due to sparse; fallback to scanning all kitchen-relevant orders
  let ordersToCheck = malformedOrders;
  if (ordersToCheck.length === 0) {
    // Fallback scan: fetch all with items and filter in JS for missing fields (handles case where query misses due to schema)
    const all = await Order.find({}).lean();
    ordersToCheck = all.filter(o => (o.items || []).some(it => !it.name || it.price == null || it.qty == null));
    if (ordersToCheck.length > 0) {
      console.log(`Fallback scan found ${ordersToCheck.length} malformed orders`);
    }
  }

  console.log(`Found ${ordersToCheck.length} orders with malformed items`);

  let totalOrdersFixed = 0;
  let totalItemsFixed = 0;
  let totalSkipped = 0;

  for (const order of ordersToCheck) {
    console.log(`\nOrder ${order.orderNumber} (${order._id}) status=${order.orderStatus} items=${order.items.length}`);
    let orderNeedsUpdate = false;
    const setOps = {};

    for (let idx = 0; idx < order.items.length; idx++) {
      const item = order.items[idx];
      const missingName = !item.name || String(item.name).trim() === "";
      const missingPrice = item.price == null;
      const missingQty = item.qty == null;
      const missingCategory = !item.category || String(item.category).trim() === "";

      if (!missingName && !missingPrice && !missingQty && !missingCategory) {
        continue; // already valid
      }

      console.log(`  Item[${idx}] malformed: missingName=${missingName} missingPrice=${missingPrice} missingQty=${missingQty} missingCategory=${missingCategory} menuItemId=${item.menuItemId}`);

      if (!item.menuItemId) {
        console.log(`    -> SKIP: no menuItemId, cannot backfill safely`);
        totalSkipped++;
        continue;
      }

      let menuItem = null;
      try {
        menuItem = await MenuItem.findById(item.menuItemId).lean();
      } catch (e) {
        console.log(`    -> SKIP: MenuItem lookup failed ${e.message}`);
        totalSkipped++;
        continue;
      }

      if (!menuItem) {
        console.log(`    -> SKIP: MenuItem ${item.menuItemId} not found (deleted)`);
        totalSkipped++;
        continue;
      }

      // Only backfill where missing, never overwrite valid existing fields
      if (missingName) {
        const name = String(menuItem.name).trim();
        if (name) {
          setOps[`items.${idx}.name`] = name;
          console.log(`    -> backfill name="${name}"`);
        }
      }
      if (missingPrice) {
        // Price = base price + modifier deltas already stored? For legacy items modifiers=[] so base price is correct
        // If item has modifiers with price, add them (though legacy had none)
        let price = Number(menuItem.price);
        if (Array.isArray(item.modifiers) && item.modifiers.length > 0) {
          // modifiers already stored with price, but menuItem price may have changed; sum deltas
          const modDelta = item.modifiers.reduce((s, m) => s + (Number(m.price) || 0), 0);
          price += modDelta;
        }
        setOps[`items.${idx}.price`] = price;
        console.log(`    -> backfill price=${price} (menuItem base ${menuItem.price})`);
      }
      if (missingQty) {
        // Do not guess blindly. Try to infer from order subtotal if single item and price known.
        // For legacy orders, subtotal and single item suggests qty=1 is safe, but we log inference.
        let inferredQty = 1;
        let reliable = true;
        if (order.items.length === 1 && menuItem.price && order.subtotal) {
          const expectedPrice = Number(menuItem.price);
          if (Number.isFinite(expectedPrice) && expectedPrice > 0) {
            const calcQty = Math.round(order.subtotal / expectedPrice);
            if (calcQty >= 1 && Math.abs(order.subtotal - calcQty * expectedPrice) < 0.01) {
              inferredQty = calcQty;
              console.log(`    -> inferred qty=${inferredQty} from subtotal ${order.subtotal}/price ${expectedPrice} (reliable)`);
            } else {
              console.log(`    -> inferred qty=${inferredQty} default (subtotal ${order.subtotal} not divisible by price ${expectedPrice}, using 1)`);
              reliable = false;
            }
          }
        } else if (order.items.length > 1) {
          console.log(`    -> multi-item order, qty inference unreliable, using qty=1 as safe default`);
          reliable = false;
        }
        if (!reliable) {
          console.log(`    -> WARNING: qty backfilled as ${inferredQty} (guess), manual review recommended for ${order.orderNumber}`);
        }
        setOps[`items.${idx}.qty`] = inferredQty;
        console.log(`    -> backfill qty=${inferredQty}`);
      }
      if (missingCategory && menuItem.category) {
        try {
          let catName = null;
          if (typeof menuItem.category === 'object' && menuItem.category.name) {
            catName = menuItem.category.name;
          } else if (mongoose.Types.ObjectId.isValid(menuItem.category)) {
            const cat = await Category.findById(menuItem.category).lean();
            catName = cat ? cat.name : null;
          } else {
            catName = String(menuItem.category);
          }
          if (catName) {
            setOps[`items.${idx}.category`] = String(catName).trim();
            console.log(`    -> backfill category="${catName}"`);
          }
        } catch (e) {
          console.log(`    -> category backfill skipped: ${e.message}`);
        }
      }
      // Backfill isVeg/taxRate if missing? They already exist in legacy, but ensure
      if (item.isVeg == null && menuItem.isVeg != null) {
        setOps[`items.${idx}.isVeg`] = menuItem.isVeg;
        console.log(`    -> backfill isVeg=${menuItem.isVeg}`);
      }
      if ((item.taxRate == null) && menuItem.taxRate != null) {
        setOps[`items.${idx}.taxRate`] = menuItem.taxRate;
        console.log(`    -> backfill taxRate=${menuItem.taxRate}`);
      }

      orderNeedsUpdate = true;
      totalItemsFixed++;
    }

    if (orderNeedsUpdate && Object.keys(setOps).length > 0) {
      console.log(`  Applying $set for ${order.orderNumber}:`, JSON.stringify(setOps, null, 2));
      // Use updateOne/$set to avoid validation of whole document via save()
      await Order.updateOne({ _id: order._id }, { $set: setOps });
      totalOrdersFixed++;
      console.log(`  -> Updated ${order.orderNumber}`);
    } else if (!orderNeedsUpdate) {
      console.log(`  -> No changes needed (all items already valid or skipped)`);
    } else {
      console.log(`  -> No $set ops generated, skipping`);
    }
  }

  console.log(`\n=== Backfill Summary ===`);
  console.log(`Orders scanned: ${ordersToCheck.length}`);
  console.log(`Orders fixed: ${totalOrdersFixed}`);
  console.log(`Items fixed: ${totalItemsFixed}`);
  console.log(`Items skipped (no menuItem): ${totalSkipped}`);
  console.log(`Idempotent: re-run will find 0 malformed if all fixed`);

  if (require.main === module) {
    await mongoose.disconnect();
    console.log('Disconnected');
  }

  return { totalOrdersFixed, totalItemsFixed, totalSkipped };
}

if (require.main === module) {
  backfillOrderItems().catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
}

module.exports = backfillOrderItems;
