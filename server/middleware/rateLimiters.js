const rateLimit = require("express-rate-limit");

// Rate limit login attempts to blunt brute force while staying practical for POS staff.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: "Too many login attempts, please try again later",
  },
});

// Refresh token rotation is normally infrequent; the generous limit only blocks
// runaway/abusive clients while never locking out a legitimately refreshing session.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: "Too many refresh attempts, please try again later",
  },
});

// Registration is admin-only; every attempt counts so a compromised admin session
// cannot mass-provision accounts within the window.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many registration attempts, please try again later",
  },
});

module.exports = { loginLimiter, refreshLimiter, registerLimiter };
