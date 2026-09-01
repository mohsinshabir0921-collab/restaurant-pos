const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");

// Provider-agnostic storage adapter.
// Implementation: Cloudflare R2 (S3-compatible) when all R2_* env vars are
// configured. Without R2 credentials the adapter uses server-backed storage:
// uploaded files are written to server/.uploads-mock and served over HTTPS by
// the Express /uploads static route (see index.js). The URL persisted in the
// database is derived from the incoming request (X-Forwarded-Proto + Host) so
// production stores a real public HTTPS URL — never localhost. STORAGE_PUBLIC_URL
// overrides the public origin when the API is reachable on a different host.

const cfg = {
  accountId: process.env.R2_ACCOUNT_ID,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
  publicUrl: (process.env.R2_PUBLIC_URL || "").replace(/\/$/, ""),
};

const isConfigured = Boolean(cfg.accountId && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucket && cfg.publicUrl);

let s3 = null;
if (isConfigured) {
  s3 = new S3Client({
    region: "auto",
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

const MOCK_DIR = path.join(__dirname, "..", ".uploads-mock");

// Fallback origin used only when the request context is unavailable (e.g.
// tests that call uploadMedia directly) and STORAGE_PUBLIC_URL is not set.
const DEFAULT_ORIGIN = `http://localhost:${process.env.PORT || 5000}`;

// In server-backed mode the adapter only manages URLs this app created, i.e.
// any http(s) origin that serves its /uploads path.
const SERVER_UPLOAD_URL_RE = /^https?:\/\/[^/]+\/uploads\//;

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
  if (isConfigured) {
    await s3.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );
    return { url: `${cfg.publicUrl}/${key}` };
  }
  // Server-backed storage (no R2 credentials configured): write the file to
  // disk and publish it under the public /uploads route of the API server.
  const fp = path.join(MOCK_DIR, key);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, buffer);
  const origin = (baseUrl || process.env.STORAGE_PUBLIC_URL || DEFAULT_ORIGIN).replace(/\/$/, "");
  return { url: `${origin}/uploads/${key}` };
}

async function remove(key) {
  if (isConfigured) {
    await s3.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    return;
  }
  const fp = path.join(MOCK_DIR, key);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

function isManagedUrl(url) {
  if (!url || typeof url !== "string") return false;
  if (isConfigured) return url.startsWith(cfg.publicUrl);
  return SERVER_UPLOAD_URL_RE.test(url);
}

function keyFromUrl(url) {
  if (isConfigured) return url.slice(cfg.publicUrl.length + 1);
  const i = url.indexOf("/uploads/");
  return i === -1 ? url : url.slice(i + "/uploads/".length);
}

function newKey(kind, mime, originalName) {
  const ext = originalName && originalName.includes(".")
    ? originalName.split(".").pop().toLowerCase()
    : extFromMime(mime, kind === "image" ? "png" : "mp4");
  return `hero/${kind}/${crypto.randomUUID()}.${ext}`;
}

module.exports = {
  upload,
  remove,
  isManagedUrl,
  keyFromUrl,
  newKey,
  isConfigured,
  MOCK_DIR,
};
