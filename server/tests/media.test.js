const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

require("dotenv").config();
const Settings = require("../models/Settings");
const storage = require("../storage/storageAdapter");
const { uploadMedia, removeMedia } = require("../controllers/mediaController");

// Throwaway database (separate name on the same cluster) — production untouched.
const BASE = process.env.MONGO_URI;
const THROWAWAY = BASE
  ? BASE.replace(/\/([?]|$)/, "/throwaway_media_test$1")
  : "mongodb://localhost:27017/throwaway_media_test";
process.env.MONGO_URI = THROWAWAY;

console.log("storage.isConfigured (expect false in CI/test):", storage.isConfigured);

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

async function uploadType(type, mime, name, sizeBytes) {
  const req = {
    file: { buffer: Buffer.alloc(sizeBytes, 7), mimetype: mime, originalname: name, size: sizeBytes },
    body: { type },
  };
  const res = mockRes();
  await uploadMedia(req, res);
  return res;
}

describe("media uploads (hero image / video)", { serial: true }, () => {
  before(async () => {
    await mongoose.connect(THROWAWAY);
    // Seed default settings so hero_image/hero_video exist with isPublic:true,
    // mirroring production (initializeDefaults runs on server boot).
    await Settings.initializeDefaults();
  });

  after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (fs.existsSync(storage.MOCK_DIR)) {
      fs.rmSync(storage.MOCK_DIR, { recursive: true, force: true });
    }
  });

  test("image upload persists URL and is consumed by public settings", async () => {
    const res = await uploadType("hero_image", "image/png", "hero.png", 100);
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.success, "upload should succeed");
    assert.ok(res.body.url, "url should be returned");
    const pub = await Settings.getPublicSettings();
    assert.equal(pub.hero_image, res.body.url, "public settings must reflect uploaded url");
  });

  test("video upload persists URL and is consumed by public settings", async () => {
    const res = await uploadType("hero_video", "video/mp4", "hero.mp4", 200);
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.success);
    const pub = await Settings.getPublicSettings();
    assert.equal(pub.hero_video, res.body.url);
  });

  test("wrong file type for hero_video is rejected", async () => {
    const res = await uploadType("hero_video", "image/png", "x.png", 10);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
  });

  test("oversized image is rejected", async () => {
    const res = await uploadType("hero_image", "image/png", "big.png", 6 * 1024 * 1024);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
  });

  test("replacing an existing upload updates the setting and removes the old object", async () => {
    const first = await uploadType("hero_image", "image/png", "a.png", 100);
    const second = await uploadType("hero_image", "image/png", "b.png", 120);
    assert.notEqual(first.body.url, second.body.url, "urls should differ");

    const current = await Settings.getValue("hero_image", "");
    assert.equal(current, second.body.url, "setting must reflect the newest upload");

    const oldKey = storage.keyFromUrl(first.body.url);
    const oldPath = path.join(storage.MOCK_DIR, oldKey);
    assert.equal(fs.existsSync(oldPath), false, "previous object should be removed on replace");
  });

  test("removing configured media restores the fallback (empty value)", async () => {
    await uploadType("hero_image", "image/png", "hero.png", 100);
    const res = mockRes();
    await removeMedia({ body: { type: "hero_image" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(await Settings.getValue("hero_image", ""), "", "value should be reset to empty");
  });

  test("manually configured (non-managed) URL is preserved through a later replace", async () => {
    await Settings.setValue("hero_image", "https://example.com/existing.jpg");
    const res = await uploadType("hero_image", "image/png", "new.png", 100);
    assert.equal(res.statusCode, 200);
    assert.equal(await Settings.getValue("hero_image", ""), res.body.url);
  });
});
