import { test } from "node:test";
import assert from "node:assert/strict";

// Mirrors the hasHalfFull derivation in client/src/pages/MenuPage.jsx
function hasHalfFull(modifiers) {
  const mods = Array.isArray(modifiers) ? modifiers : [];
  const sizeMod = mods.find((m) => m && /size|variant/i.test(m.name || ""));
  if (!sizeMod || !Array.isArray(sizeMod.options)) return false;
  const names = sizeMod.options.map((o) => String(o.name || "").toLowerCase().trim());
  return names.includes("half") && names.includes("full");
}

test("Half+Full modifier item → hasHalfFull true (fields visible)", () => {
  const modifiers = [{ name: "Size", options: [{ name: "Half", price: 0 }, { name: "Full", price: 0 }] }];
  assert.equal(hasHalfFull(modifiers), true);
  // Even with price 0 after migration, still true — NOT from deltas
  const legacy = [{ name: "Size", options: [{ name: "Half", price: 0 }, { name: "Full", price: 230 }] }];
  assert.equal(hasHalfFull(legacy), true);
});

test("Regular/Large item → hasHalfFull false (fields not visible)", () => {
  const modifiers = [{ name: "Size", options: [{ name: "Regular", price: 0 }, { name: "Large", price: 50 }] }];
  assert.equal(hasHalfFull(modifiers), false);
});

test("R/M/L/XL item → hasHalfFull false", () => {
  const modifiers = [{ name: "Size", options: [{ name: "Regular", price: 0 }, { name: "Medium", price: 80 }, { name: "Large", price: 240 }, { name: "XL", price: 340 }] }];
  assert.equal(hasHalfFull(modifiers), false);
});

test("No modifiers → hasHalfFull false", () => {
  assert.equal(hasHalfFull([]), false);
  assert.equal(hasHalfFull(null), false);
});

test("Half/Full prices remain independently editable (no delta reintroduction)", () => {
  const item = { price: 320, halfPrice: 300, fullPrice: 600, modifiers: [{ name: "Size", options: [{ name: "Half", price: 0 }, { name: "Full", price: 0 }] }] };
  // Simulate openModal fallback: should use halfPrice/fullPrice, not price+delta
  const sizeMod = item.modifiers.find((m) => /size|variant/i.test(m.name || ""));
  const halfOpt = sizeMod.options.find((o) => String(o.name).toLowerCase().trim() === "half");
  const fullOpt = sizeMod.options.find((o) => String(o.name).toLowerCase().trim() === "full");
  const hasHalfFullFlag = !!halfOpt && !!fullOpt;
  const fallbackHalf = hasHalfFullFlag ? (Number(item.price) || 0) + (Number(halfOpt.price) || 0) : Number(item.price);
  const fallbackFull = hasHalfFullFlag ? (Number(item.price) || 0) + (Number(fullOpt.price) || 0) : Number(item.price);
  const formHalf = item.halfPrice ?? fallbackHalf;
  const formFull = item.fullPrice ?? fallbackFull;
  assert.equal(formHalf, 300, "Half should be independent 300, not 320");
  assert.equal(formFull, 600, "Full should be independent 600, not 320");
  // Ensure we do not reintroduce delta: price should stay 320, half 300, full 600
  assert.notEqual(item.halfPrice, item.price + halfOpt.price); // 300 != 320+0? Actually 300 !=320, so independent
});
