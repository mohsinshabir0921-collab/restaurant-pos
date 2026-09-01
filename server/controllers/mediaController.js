const Settings = require("../models/Settings");
const storage = require("../storage/storageAdapter");
const { handleError } = require("../utils/httpError");

// Public origin for the stored media URL. In production (Render behind a TLS
// proxy) Express sees X-Forwarded-Proto: https and the Host header, so the URL
// persisted in MongoDB is a real public HTTPS URL — never localhost. Falls back
// to the local API origin for tests / exact-listeners that omit these headers.
function publicBaseUrl(req) {
  const get = (header) => (typeof req?.get === "function" ? req.get(header) : req?.[header]);
  const proto = ((get("x-forwarded-proto") || "").split(",")[0] || "http").trim();
  const host = (get("host") || "").trim() || `localhost:${process.env.PORT || 5000}`;
  return `${proto}://${host}`.replace(/\/$/, "");
}

const ALLOWED = {
  hero_image: {
    kind: "image",
    mimes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    maxBytes: 5 * 1024 * 1024,
    maxLabel: "5 MB",
  },
  hero_video: {
    kind: "video",
    mimes: ["video/mp4", "video/webm"],
    maxBytes: 50 * 1024 * 1024,
    maxLabel: "50 MB",
  },
};

const uploadMedia = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file provided" });
    }
    const type = req.body.type;
    const def = ALLOWED[type];
    if (!def) {
      return res.status(400).json({ success: false, message: "Invalid media type" });
    }
    if (!def.mimes.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported file type for ${type}. Allowed: ${def.mimes.join(", ")}`,
      });
    }
    if (req.file.size > def.maxBytes) {
      return res.status(400).json({
        success: false,
        message: `File too large for ${type} (max ${def.maxLabel})`,
      });
    }

    const key = storage.newKey(def.kind, req.file.mimetype, req.file.originalname);

    // Replace: delete the previously stored object if we manage it.
    const existing = await Settings.getValue(type, "");
    if (existing && storage.isManagedUrl(existing)) {
      try {
        await storage.remove(storage.keyFromUrl(existing));
      } catch (e) {
        console.warn("media: failed to remove previous object", e.message);
      }
    }

    const { url } = await storage.upload({
      key,
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
      baseUrl: publicBaseUrl(req),
    });

    await Settings.setValue(type, url);

    return res.status(200).json({ success: true, url });
  } catch (error) {
    console.log("UPLOAD MEDIA ERROR:", error);
    return handleError(res, error, "Upload failed");
  }
};

const removeMedia = async (req, res) => {
  try {
    const type = req.body.type;
    if (!ALLOWED[type]) {
      return res.status(400).json({ success: false, message: "Invalid media type" });
    }
    const existing = await Settings.getValue(type, "");
    if (existing && storage.isManagedUrl(existing)) {
      try {
        await storage.remove(storage.keyFromUrl(existing));
      } catch (e) {
        console.warn("media: failed to remove object", e.message);
      }
    }
    await Settings.setValue(type, "");
    return res.status(200).json({ success: true, message: "Media removed" });
  } catch (error) {
    console.log("REMOVE MEDIA ERROR:", error);
    return handleError(res, error, "Remove failed");
  }
};

module.exports = { uploadMedia, removeMedia, ALLOWED };
