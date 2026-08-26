// Shared helpers for rendering order items consistently across the POS,
// Kitchen/KOT screen, admin order views and the public website. Both the POS
// and the public website send a size/variant inside `modifiers` (the POS uses a
// hardcoded "Size" group, the website uses the real menu group name). The
// backend normalizes that into an explicit `size` field, but these helpers fall
// back to scanning `modifiers` so older orders still render correctly.

const SIZE_MODIFIER_PATTERN = /size|variant/i;

export function getOrderItemSize(item) {
  if (item && item.size && String(item.size).trim()) {
    return String(item.size).trim();
  }
  const modifiers = (item && item.modifiers) || [];
  const sizeMod = modifiers.find((m) => m && SIZE_MODIFIER_PATTERN.test(m.name || ""));
  return sizeMod && sizeMod.option ? sizeMod.option : "";
}

export function getOrderItemAddons(item) {
  const modifiers = (item && item.modifiers) || [];
  return modifiers
    .filter((m) => m && m.option && !SIZE_MODIFIER_PATTERN.test(m.name || ""))
    .map((m) => m.option);
}
