import { useState, useEffect, useCallback, useRef } from "react";
import { websiteAPI } from "../services/api";

// Fetches the authoritative order estimate from the backend (same calculation
// the server will apply when the order is actually placed).
export const useEstimate = ({ items, orderType, couponCode, deliveryAddress, customerPhone, enabled = true }) => {
  const [estimate, setEstimate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const payloadItems = (items || []).map((item) => ({
    menuItemId: item.menuItemId,
    qty: item.qty,
    modifiers: item.modifiers || [],
    notes: item.notes || "",
  }));

  const refresh = useCallback(async () => {
    if (!enabled || !items || items.length === 0) {
      setEstimate(null);
      setError(null);
      return;
    }
    try {
      setLoading(true);
      const response = await websiteAPI.getOrderEstimate({
        items: payloadItems,
        orderType,
        couponCode: couponCode || undefined,
        deliveryAddress: deliveryAddress || undefined,
        customerPhone: customerPhone || undefined,
      });
      setEstimate(response.data.estimate);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.message || "Could not calculate order total");
      setEstimate(null);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, orderType, couponCode, JSON.stringify(payloadItems), deliveryAddress, customerPhone]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      refresh();
    }, 350);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [refresh]);

  return { estimate, loading, error, refresh };
};