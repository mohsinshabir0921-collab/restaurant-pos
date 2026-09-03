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
import {
  WebsiteLoadingShell,
  WebsiteErrorState,
  WebsiteDisabledState,
} from "./components/WebsiteGateStates";

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
    const phone = String(settings.restaurant_phone || "").trim();
    const whatsappDigits = String(settings.whatsapp_number || "").replace(/\D/g, "");
    const email = String(settings.restaurant_email || "").trim();
    let contactUrl = null;
    if (phone) contactUrl = `tel:${phone.replace(/\s+/g, "")}`;
    else if (whatsappDigits) contactUrl = `https://wa.me/${whatsappDigits}`;
    else if (email) contactUrl = `mailto:${email}`;
    return (
      <WebsiteDisabledState
        restaurantName={settings.restaurant_name || "Khyenn Chyenn"}
        onRetry={reload}
        contactUrl={contactUrl}
      />
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
