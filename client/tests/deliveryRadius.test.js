import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getMaxDeliveryKm,
  getDeliveryDistanceValidation,
  calculateDeliveryFee,
  MIN_DELIVERY_ORDER_VALUE,
  MAX_DELIVERY_KM,
} from "../src/website/utils/deliveryRadius.js";

// --- Radius table (gated on final payable value, after discount) ---

test("₹480 order + 3 km is valid (max 3 km)", () => {
  const r = getDeliveryDistanceValidation(480, 3);
  assert.equal(r.valid, true);
  assert.equal(r.maxKm, 3);
});

test("₹480 order + 4 km is rejected", () => {
  const r = getDeliveryDistanceValidation(480, 4);
  assert.equal(r.valid, false);
  assert.match(r.message, /available only up to 3 km/);
});

test("₹700 order + 6 km is valid (max 6 km)", () => {
  const r = getDeliveryDistanceValidation(700, 6);
  assert.equal(r.valid, true);
  assert.equal(r.maxKm, 6);
});

test("₹700 order + 7 km is rejected", () => {
  const r = getDeliveryDistanceValidation(700, 7);
  assert.equal(r.valid, false);
  assert.match(r.message, /available only up to 6 km/);
});

test("₹1100 order + 10 km is valid (absolute cap 10 km)", () => {
  const r = getDeliveryDistanceValidation(1100, 10);
  assert.equal(r.valid, true);
  assert.equal(r.maxKm, 10);
});

test("₹1100 order + 10.1 km is rejected (absolute cap enforced)", () => {
  const r = getDeliveryDistanceValidation(1100, 10.1);
  assert.equal(r.valid, false);
  assert.match(r.message, /available only up to 10 km/);
});

test("₹480 order + 68 km is rejected (never shows a fee)", () => {
  const r = getDeliveryDistanceValidation(480, 68);
  assert.equal(r.valid, false);
  assert.match(r.message, /available only up to 3 km/);
});

test("order below ₹200 makes delivery unavailable", () => {
  assert.equal(getMaxDeliveryKm(199), 0);
  const r = getDeliveryDistanceValidation(150, 1);
  assert.equal(r.valid, false);
  assert.match(r.message, new RegExp(`minimum order value of ₹${MIN_DELIVERY_ORDER_VALUE}`));
});

test("radius table boundaries", () => {
  assert.equal(getMaxDeliveryKm(200), 1);
  assert.equal(getMaxDeliveryKm(299), 1);
  assert.equal(getMaxDeliveryKm(300), 2);
  assert.equal(getMaxDeliveryKm(399), 2);
  assert.equal(getMaxDeliveryKm(500), 4);
  assert.equal(getMaxDeliveryKm(900), 8);
  assert.equal(getMaxDeliveryKm(1099), 9);
  assert.equal(getMaxDeliveryKm(2000), MAX_DELIVERY_KM);
});

// --- Fee formula (unchanged schedule, capped at 10 km) ---

test("delivery fee schedule", () => {
  assert.equal(calculateDeliveryFee(1), 10);
  assert.equal(calculateDeliveryFee(5), 50);
  assert.equal(calculateDeliveryFee(6), 65);
  assert.equal(calculateDeliveryFee(8), 95);
  assert.equal(calculateDeliveryFee(10), 125);
});

test("delivery fee is capped at the absolute 10 km radius", () => {
  assert.equal(calculateDeliveryFee(11), 125);
  assert.equal(calculateDeliveryFee(68), 125);
});

test("non-positive distances yield zero fee", () => {
  assert.equal(calculateDeliveryFee(0), 0);
  assert.equal(calculateDeliveryFee(-5), 0);
  assert.equal(calculateDeliveryFee("abc"), 0);
});
