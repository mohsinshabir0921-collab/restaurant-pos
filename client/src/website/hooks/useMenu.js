import { useState, useEffect, useCallback } from "react";
import { websiteAPI } from "../services/api";

export const useMenu = () => {
  const [categories, setCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadMenu = useCallback(async () => {
    try {
      setLoading(true);
      const response = await websiteAPI.getMenuByCategory();
      // The shared POS endpoint returns groups shaped { category: {...}, items: [...] }.
      // Normalize to { _id, name, displayOrder, items } so the website can use the
      // category fields directly (the POS relies on the original nested shape).
      const groups = (response.data.categories || []).map((group) => ({
        _id: group.category?._id ?? null,
        name: group.category?.name || "Uncategorized",
        displayOrder: group.category?.displayOrder ?? 0,
        items: group.items || [],
      }));
      setCategories(groups);
      setMenuItems(groups.flatMap((group) => group.items || []));
      setError(null);
    } catch (err) {
      console.error("Failed to load menu:", err);
      setError(err.response?.data?.message || "Failed to load menu");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMenu();
  }, [loadMenu]);

  const getMenuItemById = useCallback(
    (id) => menuItems.find((item) => item._id === id) || null,
    [menuItems]
  );

  return {
    categories,
    menuItems,
    loading,
    error,
    reload: loadMenu,
    getMenuItemById,
  };
};

export const useMenuItem = (id) => {
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    const loadItem = async () => {
      try {
        setLoading(true);
        const response = await websiteAPI.getMenuItem(id);
        if (!cancelled) {
          setItem(response.data.menuItem);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load menu item:", err);
          setError(err.response?.data?.message || "Failed to load menu item");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadItem();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return { item, loading, error };
};