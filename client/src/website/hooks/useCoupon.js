import { useState, useCallback } from "react";
import { websiteAPI } from "../services/api";

export const useCoupon = () => {
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState(null);

  const validateCoupon = useCallback(async (code, orderAmount, orderType) => {
    if (!code || !String(code).trim()) return null;
    setValidating(true);
    setError(null);
    try {
      const response = await websiteAPI.validateCoupon({
        code: String(code).trim(),
        orderAmount,
        orderType,
      });
      const coupon = response.data.coupon;
      return {
        code: coupon.code,
        name: coupon.name,
        type: coupon.type,
        value: coupon.value,
        discount: coupon.discount,
      };
    } catch (err) {
      const message = err.response?.data?.message || "Invalid or expired coupon";
      setError(message);
      return null;
    } finally {
      setValidating(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { validateCoupon, validating, error, clearError };
};