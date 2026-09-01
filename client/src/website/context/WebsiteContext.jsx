import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
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

// TEMPORARY BYPASS: VITE_BYPASS_ORDERING_HOURS=true forces isOpen=true.
// Easy to remove later: delete this check and the env flag.
const isOrderingHoursBypassEnabled = () =>
  String(import.meta.env.VITE_BYPASS_ORDERING_HOURS || "").toLowerCase() === "true";

// Client-side open/closed check used only for display. Mirrors the server
// enforcement but runs in the visitor's local time (fine for the banner).
const isRestaurantOpenNow = (hours) => {
  if (isOrderingHoursBypassEnabled()) return true;
  if (!hours || typeof hours !== "object") return true;
  const dayKey = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][
    new Date().getDay()
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
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= open && nowMin < close;
};

export const WebsiteProvider = ({ children }) => {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const response = await websiteAPI.getPublicSettings();
      setSettings(response.data.settings || {});
      setError(null);
    } catch (err) {
      console.error("Failed to load settings:", err);
      setError(err.response?.data?.message || "Failed to load restaurant settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const getSetting = useCallback(
    (key, defaultValue = "") => settings[key] ?? defaultValue,
    [settings]
  );

  const openingHours = useMemo(() => parseOpeningHours(settings.opening_hours), [settings.opening_hours]);
  const isOpen = useMemo(() => isRestaurantOpenNow(openingHours), [openingHours]);

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