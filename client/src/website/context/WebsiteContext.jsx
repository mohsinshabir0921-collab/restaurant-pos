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

export const WebsiteProvider = ({ children }) => {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
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
      setSettings(response.data.settings || {});
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      console.error("Failed to load settings:", err);
      // Preserve existing settings (do not invent defaults); surface retryable error.
      const message =
        err.response?.data?.message || err.message || "Failed to load restaurant settings";
      setError(message);
    } finally {
      if (mountedRef.current) setLoading(false);
      isFetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadSettings();
    return () => {
      mountedRef.current = false;
    };
  }, [loadSettings]);

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