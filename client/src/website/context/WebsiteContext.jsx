import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { websiteAPI } from "../services/api";

const WebsiteContext = createContext(null);

const DEFAULT_OPENING_HOURS = {
  monday: { open: "11:00", close: "23:00" },
  tuesday: { open: "11:00", close: "23:00" },
  wednesday: { open: "11:00", close: "23:00" },
  thursday: { open: "11:00", close: "23:00" },
  friday: { open: "11:00", close: "23:00" },
  saturday: { open: "11:00", close: "23:00" },
  sunday: { open: "12:00", close: "22:00" },
};

const parseOpeningHours = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // fall through to defaults
    }
  }
  return DEFAULT_OPENING_HOURS;
};

// Client-side open/closed check – mirrors server openingHours.js but must use
// IST (Asia/Kolkata) like the server, not browser local time.
const getNowInIST = () => {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 5.5 * 60 * 60000);
};

const isRestaurantOpenNow = (hours) => {
  if (!hours || typeof hours !== "object") return true;
  const nowIST = getNowInIST();
  const dayKey = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][
    nowIST.getDay()
  ];
  const today = hours[dayKey];
  if (!today || !today.open || !today.close) return true;
  const toMinutes = (t) => {
    const [h, m] = String(t).split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const open = toMinutes(today.open);
  const close = toMinutes(today.close);
  if (open === close) return false;
  const nowMin = nowIST.getHours() * 60 + nowIST.getMinutes();
  return nowMin >= open && nowMin < close;
};

const CACHE_KEY = "website_public_settings_v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const isValidSettings = (s) =>
  s && typeof s === "object" && !Array.isArray(s) && typeof s.website_enabled === "boolean";

const readCachedSettings = () => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { settings: cachedSettings, timestamp } = parsed;
    if (!isValidSettings(cachedSettings)) return null;
    if (typeof timestamp !== "number") return null;
    if (Date.now() - timestamp > CACHE_TTL_MS) return null;
    return cachedSettings;
  } catch {
    return null;
  }
};

const writeCachedSettings = (freshSettings) => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ settings: freshSettings, timestamp: Date.now() })
    );
  } catch {
    // storage failure (quota, private browsing) must never break website
  }
};

const getFriendlyErrorMessage = (err) => {
  const raw =
    err?.response?.data?.message || err?.message || "Failed to load restaurant settings";
  const lower = String(raw).toLowerCase();
  if (err?.code === "ECONNABORTED" || lower.includes("timeout") || lower.includes("exceeded")) {
    return "Please check your connection and try again.";
  }
  return String(raw);
};

export const WebsiteProvider = ({ children }) => {
  // Single-read init: avoid double JSON.parse / TTL race between useState initializers and effect
  const initialCacheRef = useRef(undefined);
  const getInitialCached = () => {
    if (initialCacheRef.current !== undefined) return initialCacheRef.current;
    initialCacheRef.current = readCachedSettings();
    return initialCacheRef.current;
  };
  const [settings, setSettings] = useState(() => getInitialCached() || {});
  const [loading, setLoading] = useState(() => !getInitialCached());
  const [error, setError] = useState(null);
  const isFetchingRef = useRef(false);
  const mountedRef = useRef(true);

  const loadSettings = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await websiteAPI.getPublicSettings();
      if (!mountedRef.current) return;
      const fresh = response.data.settings || {};
      setSettings(fresh);
      setError(null);
      if (isValidSettings(fresh)) writeCachedSettings(fresh);
    } catch (err) {
      if (!mountedRef.current) return;
      console.error("Failed to load settings:", err);
      const message = getFriendlyErrorMessage(err);
      setError(message);
    } finally {
      if (mountedRef.current) setLoading(false);
      isFetchingRef.current = false;
    }
  }, []);

  const backgroundRefresh = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const response = await websiteAPI.getPublicSettings();
      if (!mountedRef.current) return;
      const fresh = response.data.settings || {};
      setSettings(fresh);
      setError(null);
      if (isValidSettings(fresh)) writeCachedSettings(fresh);
    } catch (err) {
      if (!mountedRef.current) return;
      if (import.meta.env.DEV) {
        console.warn("[WebsiteContext] Background refresh failed:", err?.message || err);
      }
      // Keep cached website visible; do not set error
    } finally {
      isFetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const cached = initialCacheRef.current;
    if (cached) {
      backgroundRefresh();
    } else {
      loadSettings();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [loadSettings, backgroundRefresh]);

  const getSetting = useCallback(
    (key, defaultValue = "") => settings[key] ?? defaultValue,
    [settings]
  );

  const openingHours = useMemo(() => parseOpeningHours(settings.opening_hours), [settings.opening_hours]);
  const isOpen = useMemo(() => {
    const onlineEnabled = settings.online_ordering_enabled;
    if (onlineEnabled === false) return false;
    return isRestaurantOpenNow(openingHours);
  }, [openingHours, settings.online_ordering_enabled]);

  const value = useMemo(
    () => ({
      settings,
      loading,
      error,
      getSetting,
      restaurantName: settings.restaurant_name || "Khyenn Chyenn",
      openingHours,
      isOpen,
      reload: loadSettings,
    }),
    [settings, loading, error, getSetting, openingHours, isOpen, loadSettings]
  );

  return <WebsiteContext.Provider value={value}>{children}</WebsiteContext.Provider>;
};

export const useWebsite = () => {
  const context = useContext(WebsiteContext);
  if (!context) throw new Error("useWebsite must be used within a WebsiteProvider");
  return context;
};