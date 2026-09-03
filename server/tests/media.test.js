const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

require("dotenv").config();
const Settings = require("../models/Settings");
const storage = require("../storage/storageAdapter");
const { uploadMedia, removeMedia, getHeroMedia } = require("../controllers/mediaController");
const { getHeroMediaBucket } = require("../utils/gridfs");

// Throwaway database (separate name on the same cluster) — production untouched.
const BASE = process.env.MONGO_URI;
const THROWAWAY = BASE
  ? BASE.replace(/\/([?]|$)/, "/throwaway_media_test$1")
  : "mongodb://localhost:27017/throwaway_media_test";
process.env.MONGO_URI = THROWAWAY;

console.log("storage.isConfigured (expect true — GridFS):", storage.isConfigured);

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    set(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

async function uploadType(type, mime, name, sizeBytes, baseUrl) {
  const req = {
    file: { buffer: Buffer.alloc(sizeBytes, 7), mimetype: mime, originalname: name, size: sizeBytes },
    body: { type },
    get: (h) => (h.toLowerCase() === "host" ? "testhost:5000" : undefined),
    headers: { host: "testhost:5000" },
  };
  // Provide baseUrl implicitly via publicBaseUrl fallback if needed
  const res = mockRes();
  await uploadMedia(req, res);
  return res;
}

function extractHeroId(url) {
  const m = url && url.match(/\/api\/settings\/media\/hero\/([a-f0-9]{24})/i);
  return m ? m[1] : null;
}

async function heroFileExists(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  const bucket = getHeroMediaBucket();
  const files = await bucket.find({ _id: new mongoose.Types.ObjectId(id) }).toArray();
  return files && files.length > 0;
}

async function getHeroFileBuffer(id) {
  const bucket = getHeroMediaBucket();
  const fileId = new mongoose.Types.ObjectId(id);
  const chunks = [];
  await new Promise((resolve, reject) => {
    const stream = bucket.openDownloadStream(fileId);
    stream.on("data", (d) => chunks.push(d));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return Buffer.concat(chunks);
}

describe("media uploads (hero image / video) — GridFS persistent", { serial: true }, () => {
  before(async () => {
    await mongoose.connect(THROWAWAY);
    await Settings.initializeDefaults();
  });

  after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  test("image upload persists GridFS URL and is consumed by public settings", async () => {
    const res = await uploadType("hero_image", "image/png", "hero.png", 100);
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.success, "upload should succeed");
    assert.ok(res.body.url, "url should be returned");
    assert.match(res.body.url, /\/api\/settings\/media\/hero\/[a-f0-9]{24}/i, "url must be GridFS hero URL");
    const id = extractHeroId(res.body.url);
    assert.ok(id, "should extract hero id");
    assert.equal(await heroFileExists(id), true, "file must exist in GridFS");
    const pub = await Settings.getPublicSettings();
    assert.equal(pub.hero_image, res.body.url, "public settings must reflect uploaded url");
    // Verify content persisted correctly
    const buf = await getHeroFileBuffer(id);
    assert.equal(buf.length, 100, "stored buffer length must match");
  });

  test("video upload persists URL and is consumed by public settings", async () => {
    const res = await uploadType("hero_video", "video/mp4", "hero.mp4", 200);
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.success);
    assert.match(res.body.url, /\/api\/settings\/media\/hero\/[a-f0-9]{24}/i);
    const id = extractHeroId(res.body.url);
    assert.equal(await heroFileExists(id), true);
    const pub = await Settings.getPublicSettings();
    assert.equal(pub.hero_video, res.body.url);
  });

  test("GET hero media serves correct MIME, caching and 404 handling", async () => {
    const up = await uploadType("hero_image", "image/png", "cache.png", 50);
    const id = extractHeroId(up.body.url);
    const bucket = getHeroMediaBucket();
    const files = await bucket.find({ _id: new mongoose.Types.ObjectId(id) }).toArray();
    const ct = files[0].contentType || files[0].metadata?.contentType;
    assert.equal(ct, "image/png");
    // Handler pipes to writable; use PassThrough as res
    const { PassThrough } = require("stream");
    const req = { params: { id } };
    const pass = new PassThrough();
    const headers = {};
    pass.set = (k, v) => { headers[k.toLowerCase()] = v; return pass; };
    pass.status = function(c) { this.statusCode = c; return this; };
    pass.json = function(b) { this.body = b; return this; };
    // Drain the stream to avoid hanging
    pass.on("data", () => {});
    await getHeroMedia(req, pass);
    // Wait a tick for pipe to set headers
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(headers["content-type"], "image/png");
    assert.match(headers["cache-control"], /public.*max-age=31536000/);
    assert.equal(headers["cross-origin-resource-policy"], "cross-origin");

    // 404 for invalid id
    const badRes = mockRes();
    await getHeroMedia({ params: { id: "000000000000000000000000" } }, badRes);
    assert.equal(badRes.statusCode, 404);
    // 404 for malformed id
    const malformed = mockRes();
    await getHeroMedia({ params: { id: "not-an-id" } }, malformed);
    assert.equal(malformed.statusCode, 404);
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

  test("replacing an existing upload updates the setting and removes the old GridFS object", async () => {
    const first = await uploadType("hero_image", "image/png", "a.png", 100);
    const firstId = extractHeroId(first.body.url);
    assert.equal(await heroFileExists(firstId), true);
    const second = await uploadType("hero_image", "image/png", "b.png", 120);
    assert.notEqual(first.body.url, second.body.url, "urls should differ");
    const secondId = extractHeroId(second.body.url);
    assert.equal(await heroFileExists(secondId), true);

    const current = await Settings.getValue("hero_image", "");
    assert.equal(current, second.body.url, "setting must reflect the newest upload");

    // Old GridFS file must have been deleted
    assert.equal(await heroFileExists(firstId), false, "previous GridFS object should be removed on replace");
    // Old file buffer should be gone
    const bucket = getHeroMediaBucket();
    await assert.rejects(async () => {
      await getHeroFileBuffer(firstId);
    });
  });

  test("removing configured media restores the fallback (empty value) and deletes GridFS file", async () => {
    const up = await uploadType("hero_image", "image/png", "hero.png", 100);
    const id = extractHeroId(up.body.url);
    assert.equal(await heroFileExists(id), true);
    const res = mockRes();
    await removeMedia({ body: { type: "hero_image" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(await Settings.getValue("hero_image", ""), "", "value should be reset to empty");
    assert.equal(await heroFileExists(id), false, "GridFS file should be deleted on remove");
  });

  test("manually configured (non-managed) URL is preserved through a later replace", async () => {
    await Settings.setValue("hero_image", "https://example.com/existing.jpg");
    const res = await uploadType("hero_image", "image/png", "new.png", 100);
    assert.equal(res.statusCode, 200);
    assert.equal(await Settings.getValue("hero_image", ""), res.body.url);
    // External URL was not treated as managed, so no deletion attempted.
    const id = extractHeroId(res.body.url);
    assert.equal(await heroFileExists(id), true);
  });

  test("existing GridFS hero image survives simulated restart (reconnect)", async () => {
    const up = await uploadType("hero_image", "image/png", "persist.png", 80);
    const id = extractHeroId(up.body.url);
    const urlBefore = up.body.url;
    const bufBefore = await getHeroFileBuffer(id);
    // Simulate restart: disconnect and reconnect to same throwaway DB
    await mongoose.disconnect();
    await mongoose.connect(THROWAWAY);
    // Settings URL must still be there
    const persistedUrl = await Settings.getValue("hero_image", "");
    assert.equal(persistedUrl, urlBefore, "Settings URL survives reconnect");
    // GridFS file must still be readable after reconnect
    assert.equal(await heroFileExists(id), true, "GridFS file survives reconnect");
    const bufAfter = await getHeroFileBuffer(id);
    assert.deepEqual(bufAfter, bufBefore, "file content survives reconnect");
    // Refresh simulation: public settings still returns URL
    const pub = await Settings.getPublicSettings();
    assert.equal(pub.hero_image, urlBefore);
  });

  test("legacy /uploads and R2 URLs are still recognized as managed but not deleted from GridFS", () => {
    assert.equal(storage.isManagedUrl("https://cdn.example.com/uploads/hero/image/abc.png"), true);
    assert.equal(storage.isManagedUrl("https://my-bucket.r2.dev/hero/image/old.png"), false, "R2 without env publicUrl not managed — external handled");
    // Hero GridFS URL is managed
    assert.equal(storage.isManagedUrl("https://testhost:5000/api/settings/media/hero/123456789012345678901234"), true);
    assert.equal(storage.isManagedUrl("https://example.com/existing.jpg"), false);
    // keyFromUrl for hero GridFS
    assert.equal(storage.keyFromUrl("https://testhost:5000/api/settings/media/hero/abc1234567890123456789012"), "abc1234567890123456789012");
  });
});
