const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");

// Provider-agnostic storage adapter.
// Implementation: Cloudflare R2 (S3-compatible).
// If R2 credentials are not configured, a local mock backend is used so the
// app (and automated tests) can run without production credentials. The mock
// never touches production storage.

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

// In the local/mock backend the uploaded files are served over HTTP by the
// Express app (see index.js -> app.use("/uploads", express.static(MOCK_DIR))),
// so the stored URL must be a normal browser-loadable origin, not a bespoke
// scheme. Defaults to the API server's own origin on the configured port.
// Override with STORAGE_PUBLIC_URL when the API is reachable on a different
// host/port in a local setup.
const MOCK_ORIGIN =
  (process.env.STORAGE_PUBLIC_URL ||
    `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, "");
const MOCK_PREFIX = `${MOCK_ORIGIN}/uploads/`;

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

async function upload({ key, buffer, contentType }) {
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
  // Mock backend (no credentials configured)
  const fp = path.join(MOCK_DIR, key);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, buffer);
  return { url: `${MOCK_PREFIX}${key}` };
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
  return isConfigured ? url.startsWith(cfg.publicUrl) : url.startsWith(MOCK_PREFIX);
}

function keyFromUrl(url) {
  if (isConfigured) return url.slice(cfg.publicUrl.length + 1);
  return url.slice(MOCK_PREFIX.length);
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
