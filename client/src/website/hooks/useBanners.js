import { useState, useEffect, useCallback } from "react";
import { websiteAPI } from "../services/api";

// Loads the promotional banners the server has deemed live (active, started,
// not expired). The server decides; this hook only sorts defensively.
export const useBanners = () => {
  const [banners, setBanners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadBanners = useCallback(async () => {
    try {
      setLoading(true);
      const response = await websiteAPI.getActiveBanners();
      const list = (response.data.banners || [])
        .slice()
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      setBanners(list);
      setError(null);
    } catch (err) {
      console.error("Failed to load banners:", err);
      setError(err.response?.data?.message || "Failed to load promotions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBanners();
  }, [loadBanners]);

  return { banners, loading, error, reload: loadBanners };
};