import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { WebsiteProvider, useWebsite } from "./context/WebsiteContext";
import { CartProvider } from "./context/CartContext";
import { OrderProvider } from "./context/OrderContext";
import WebsiteLayout from "./components/WebsiteLayout";
import HomePage from "./pages/HomePage";
import MenuPage from "./pages/MenuPage";
import MenuItemDetailPage from "./pages/MenuItemDetailPage";
import CartPage from "./pages/CartPage";
import CheckoutPage from "./pages/CheckoutPage";
import OrderConfirmationPage from "./pages/OrderConfirmationPage";
import TrackOrderPage from "./pages/TrackOrderPage";
import AdditionalPaymentPage from "./pages/AdditionalPaymentPage";
import NotFoundPage from "./pages/NotFoundPage";
import { WebsiteLoadingShell, WebsiteErrorState } from "./components/WebsiteGateStates";

function WebsiteGate({ children }) {
  const { loading, error, settings, reload } = useWebsite();
  const [showSlow, setShowSlow] = useState(false);

  useEffect(() => {
    if (!loading) {
      setShowSlow(false);
      return;
    }
    const t = setTimeout(() => setShowSlow(true), 7000);
    return () => clearTimeout(t);
  }, [loading]);

  if (loading) {
    return <WebsiteLoadingShell slow={showSlow} />;
  }
  if (error) {
    return <WebsiteErrorState error={error} onRetry={reload} />;
  }
  if (settings.website_enabled === false) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#3f0d0a",
          color: "#f4e6d2",
        }}
      >
        <div style={{ textAlign: "center", padding: 24, maxWidth: 480 }}>
          <h1 style={{ fontFamily: "var(--font-display)", marginBottom: 12 }}>
            {settings.restaurant_name || "Restaurant"}
          </h1>
          <p>Our online ordering is currently unavailable. Please check back later or contact us directly.</p>
        </div>
      </div>
    );
  }
  return children;
}

export default function WebsiteApp() {
  return (
    <WebsiteProvider>
      <CartProvider>
        <OrderProvider>
          <WebsiteGate>
            <Routes>
              <Route element={<WebsiteLayout />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/menu" element={<MenuPage />} />
                <Route path="/menu/:id" element={<MenuItemDetailPage />} />
                <Route path="/cart" element={<CartPage />} />
                <Route path="/checkout" element={<CheckoutPage />} />
                <Route path="/order-confirmation" element={<OrderConfirmationPage />} />
                <Route path="/order-confirmation/:orderNumber" element={<OrderConfirmationPage />} />
                <Route path="/track" element={<TrackOrderPage />} />
                <Route path="/track/:orderNumber" element={<TrackOrderPage />} />
                <Route path="/pay/:token" element={<AdditionalPaymentPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </WebsiteGate>
        </OrderProvider>
      </CartProvider>
    </WebsiteProvider>
  );
}
