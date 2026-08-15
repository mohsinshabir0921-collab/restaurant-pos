import { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";

const OrderContext = createContext(null);

const STORAGE_KEY = "website_order_type_v1";

export const OrderProvider = ({ children }) => {
  const [orderType, setOrderTypeState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === "delivery" || saved === "takeaway" ? saved : "takeaway";
    } catch {
      return "takeaway";
    }
  });

  const [lastOrder, setLastOrderState] = useState(() => {
    try {
      const saved = sessionStorage.getItem("website_last_order");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const setOrderType = useCallback((type) => {
    if (type !== "takeaway" && type !== "delivery") return;
    setOrderTypeState(type);
    try {
      localStorage.setItem(STORAGE_KEY, type);
    } catch {
      // ignore
    }
  }, []);

  const setLastOrder = useCallback((order) => {
    setLastOrderState(order);
    try {
      if (order) {
        sessionStorage.setItem("website_last_order", JSON.stringify(order));
      } else {
        sessionStorage.removeItem("website_last_order");
      }
    } catch {
      // ignore
    }
  }, []);

  const reset = useCallback(() => {
    setLastOrder(null);
  }, [setLastOrder]);

  const value = useMemo(
    () => ({ orderType, setOrderType, lastOrder, setLastOrder, reset }),
    [orderType, setOrderType, lastOrder, setLastOrder, reset]
  );

  return <OrderContext.Provider value={value}>{children}</OrderContext.Provider>;
};

export const useOrder = () => {
  const context = useContext(OrderContext);
  if (!context) throw new Error("useOrder must be used within an OrderProvider");
  return context;
};