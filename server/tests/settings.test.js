const { test } = require("node:test");
const assert = require("node:assert/strict");

const Settings = require("../models/Settings");

// Guards the Settings → Restaurant admin save flow: bulkUpdateSettings sends
// every key in the group and Settings.setValue runs validators, so the default
// value for restaurant_latitude/longitude must pass the Mixed `required`
// validation. `null` would break saving the whole Restaurant tab; `""` is the
// "not configured yet" sentinel and passes.
test("settings accept empty-string and decimal-string coordinate values", () => {
  for (const value of ["", "28.6139", "77.209", "0", 0, false]) {
    const doc = new Settings({ key: `test_key_${String(value)}`, value });
    const err = doc.validateSync();
    assert.ok(!err, `value ${JSON.stringify(value)} must be valid`);
  }
});

test("settings reject null/undefined required values", () => {
  for (const value of [null, undefined]) {
    const doc = new Settings({ key: `test_key_${String(value)}`, value });
    const err = doc.validateSync();
    assert.ok(err && err.errors && err.errors.value, `value ${String(value)} must be invalid`);
  }
});