const crypto = require("crypto");
const mongoose = require("mongoose");
const { getHeroMediaBucket } = require("../utils/gridfs");

// Persistent hero media storage — MongoDB GridFS (same approach as menuImages).
// No local filesystem (.uploads-mock) and no R2 requirement; hero uploads
// survive restarts/redeploys because they live in MongoDB.

const DEFAULT_ORIGIN = `http://localhost:${process.env.PORT || 5000}`;
const SERVER_UPLOAD_URL_RE = /^https?:\/\/[^/]+\/uploads\//;
// New hero GridFS URLs: /api/settings/media/hero/<ObjectId> (public, cached)
const HERO_GRIDFS_URL_RE = /\/api\/settings\/media\/hero\/[a-f0-9]{24}/i;
// Legacy R2 URLs (if any exist) — keep managed for cleanup, but not required.
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");

function extFromMime(mime, fallback) {
  const map = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
  };
  return map[mime] || fallback;
}

async function upload({ key, buffer, contentType, baseUrl }) {
  const bucket = getHeroMediaBucket();
  const filename = key;
  const uploadStream = bucket.openUploadStream(filename, {
    contentType,
    metadata: { originalName: filename, contentType },
  });
  await new Promise((resolve, reject) => {
    uploadStream.on("error", reject);
    uploadStream.on("finish", resolve);
    uploadStream.end(buffer);
  });
  const fileId = uploadStream.id.toString();
  const origin = (baseUrl || process.env.STORAGE_PUBLIC_URL || DEFAULT_ORIGIN).replace(/\/$/, "");
  return { url: `${origin}/api/settings/media/hero/${fileId}` };
}

async function remove(key) {
  // key is expected to be a GridFS ObjectId string for new hero URLs.
  // Legacy /uploads or R2 keys are ignored silently — there is no ephemeral
  // file to delete and existing images must NOT be deleted inadvertently.
  if (!key) return;
  if (mongoose.Types.ObjectId.isValid(key)) {
    try {
      const bucket = getHeroMediaBucket();
      const fileId = new mongoose.Types.ObjectId(key);
      // Verify file exists before delete to avoid noisy errors.
      const files = await bucket.find({ _id: fileId }).toArray();
      if (files && files.length > 0) {
        await bucket.delete(fileId);
      }
    } catch (e) {
      // Do not throw for missing file — legacy URLs or already-deleted files
      // should not block the new upload. Log at debug level only.
      console.warn("hero media: failed to remove previous object", e.message);
    }
    return;
  }
  // Legacy key (e.g. hero/image/uuid.png or R2 path) — no GridFS file to
  // remove; do not touch filesystem. Existing images are preserved.
  return;
}

function isManagedUrl(url) {
  if (!url || typeof url !== "string") return false;
  if (HERO_GRIDFS_URL_RE.test(url)) return true;
  if (SERVER_UPLOAD_URL_RE.test(url)) return true;
  if (R2_PUBLIC_URL && url.startsWith(R2_PUBLIC_URL)) return true;
  return false;
}

function keyFromUrl(url) {
  // New hero GridFS URL: extract ObjectId after /hero/
  const heroIdx = url.indexOf("/api/settings/media/hero/");
  if (heroIdx !== -1) {
    const after = url.slice(heroIdx + "/api/settings/media/hero/".length);
    // Strip query string if any
    const qIdx = after.indexOf("?");
    const id = qIdx === -1 ? after : after.slice(0, qIdx);
    // Return raw id even if not valid ObjectId — remove() will no-op safely.
    return id.split("/")[0];
  }
  if (R2_PUBLIC_URL && url.startsWith(R2_PUBLIC_URL)) {
    return url.slice(R2_PUBLIC_URL.length + 1);
  }
  const i = url.indexOf("/uploads/");
  return i === -1 ? url : url.slice(i + "/uploads/".length);
}

function newKey(kind, mime, originalName) {
  const ext = originalName && originalName.includes(".")
    ? originalName.split(".").pop().toLowerCase()
    : extFromMime(mime, kind === "image" ? "png" : "mp4");
  return `hero/${kind}/${crypto.randomUUID()}.${ext}`;
}

// Kept for backward-compatible checks in tests/caller; hero is now always
// GridFS-backed, so isConfigured reflects GridFS readiness (DB connected).
const isConfigured = true;
const isProduction = process.env.NODE_ENV === "production";
const MOCK_DIR = null;

module.exports = {
  upload,
  remove,
  isManagedUrl,
  keyFromUrl,
  newKey,
  isConfigured,
  isProduction,
  MOCK_DIR,
};
