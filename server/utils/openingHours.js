// Server-side interpretation of restaurant opening hours.
//
// The opening hours value is stored as a JSON string (or already-parsed
// object) keyed by weekday with { open, close } "HH:MM" strings. This module
// is pure except for reading the current time; it deliberately fails open
// (returns true) when the data is missing or malformed so a broken
// configuration never silently shuts down ordering.

// The restaurant operates in India (Delhi coordinates, INR). Opening hours are
// interpreted in IST (UTC+5:30) regardless of where the server is hosted, so
// the closed-state matches the restaurant's local day/time. If a timezone
// setting is added later, this is the single place to adjust.
const getNowInRestaurantTz = () => {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 5.5 * 60 * 60000);
};

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const parseOpeningHours = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // fall through to null
    }
  }
  return null;
};

const toMinutes = (time) => {
  if (!time || typeof time !== "string") return null;
  const parts = time.split(":").map(Number);
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
  return parts[0] * 60 + parts[1];
};

// TEMPORARY BYPASS: when BYPASS_ORDERING_HOURS=true, ordering is allowed regardless of schedule.
// Easy to remove later: delete this check and the env flag.
// Usage: set BYPASS_ORDERING_HOURS=true in server/.env to bypass closed-hours guard.
const isOrderingHoursBypassEnabled = () => String(process.env.BYPASS_ORDERING_HOURS || "").toLowerCase() === "true";

const isOpeningHoursBypassEnabled = isOrderingHoursBypassEnabled;

// Returns true when the restaurant is open for orders right now.
const isRestaurantOpenNow = (openingHoursValue) => {
  if (isOrderingHoursBypassEnabled()) return true;
  const hours = parseOpeningHours(openingHoursValue);
  if (!hours) return true; // graceful: unknown schedule → allow

  const now = getNowInRestaurantTz();
  const dayKey = DAY_KEYS[now.getDay()];
  const today = hours[dayKey];
  if (!today) return true; // graceful: no entry for today → allow

  const open = toMinutes(today.open);
  const close = toMinutes(today.close);
  if (open == null || close == null) return true; // graceful: malformed → allow
  if (open === close) return false; // explicitly closed (no window set)

  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= open && nowMin < close;
};

module.exports = { isRestaurantOpenNow, parseOpeningHours, isOrderingHoursBypassEnabled, isOpeningHoursBypassEnabled };
