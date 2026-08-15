import { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";

const CartContext = createContext(null);

const STORAGE_KEY = "website_cart_v1";

const emptyCart = [];

export const CartProvider = ({ children }) => {
  const [cartItems, setCartItems] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState(null);

  // Load cart from localStorage once.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setCartItems(parsed);
      }
    } catch {
      // ignore corrupted cart
    }
  }, []);

  // Persist cart.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cartItems));
    } catch {
      // storage may be unavailable; ignore
    }
  }, [cartItems]);

  const addToCart = useCallback((menuItem, quantity = 1, modifiers = [], notes = "") => {
    const normalizedModifiers = Array.isArray(modifiers)
      ? modifiers.filter((m) => m && m.name && m.option).map((m) => ({ name: m.name, option: m.option, price: Number(m.price) || 0 }))
      : [];
    const categoryName =
      typeof menuItem.category === "string"
        ? menuItem.category
        : menuItem.category?.name || "";

    setCartItems((prev) => {
      const existingIndex = prev.findIndex(
        (item) =>
          item.menuItemId === menuItem._id &&
          JSON.stringify(item.modifiers) === JSON.stringify(normalizedModifiers) &&
          (item.notes || "") === String(notes || "").trim()
      );

      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          qty: updated[existingIndex].qty + quantity,
        };
        return updated;
      }

      const newItem = {
        id: `${menuItem._id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        menuItemId: menuItem._id,
        name: menuItem.name,
        price: Number(menuItem.price) || 0,
        qty: quantity,
        isVeg: menuItem.isVeg !== undefined ? menuItem.isVeg : true,
        image: menuItem.image || "",
        category: categoryName,
        modifiers: normalizedModifiers,
        notes: String(notes || "").trim(),
      };
      return [...prev, newItem];
    });
    setIsCartOpen(true);
  }, []);

  const removeFromCart = useCallback((itemId) => {
    setCartItems((prev) => prev.filter((item) => item.id !== itemId));
  }, []);

  const updateQuantity = useCallback(
    (itemId, qty) => {
      if (qty <= 0) {
        removeFromCart(itemId);
        return;
      }
      setCartItems((prev) =>
        prev.map((item) => (item.id === itemId ? { ...item, qty } : item))
      );
    },
    [removeFromCart]
  );

  const clearCart = useCallback(() => {
    setCartItems(emptyCart);
    setAppliedCoupon(null);
  }, []);

  const applyCoupon = useCallback((coupon) => setAppliedCoupon(coupon), []);
  const removeCoupon = useCallback(() => setAppliedCoupon(null), []);

  const itemCount = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.qty, 0),
    [cartItems]
  );

  // Item base price + selected modifier prices, per unit.
  const unitPrice = useCallback(
    (item) => {
      const mods = (item.modifiers || []).reduce((sum, m) => sum + (Number(m.price) || 0), 0);
      return (Number(item.price) || 0) + mods;
    },
    []
  );

  const subtotal = useMemo(
    () => cartItems.reduce((sum, item) => sum + unitPrice(item) * item.qty, 0),
    [cartItems, unitPrice]
  );

  const isEmpty = cartItems.length === 0;

  const value = useMemo(
    () => ({
      cartItems,
      isCartOpen,
      setIsCartOpen,
      addToCart,
      removeFromCart,
      updateQuantity,
      clearCart,
      appliedCoupon,
      applyCoupon,
      removeCoupon,
      unitPrice,
      subtotal,
      itemCount,
      isEmpty,
    }),
    [
      cartItems,
      isCartOpen,
      addToCart,
      removeFromCart,
      updateQuantity,
      clearCart,
      appliedCoupon,
      applyCoupon,
      removeCoupon,
      unitPrice,
      subtotal,
      itemCount,
      isEmpty,
    ]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within a CartProvider");
  return context;
};