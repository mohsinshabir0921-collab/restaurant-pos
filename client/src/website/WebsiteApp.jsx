import { Routes, Route, Navigate } from "react-router-dom";
import { WebsiteProvider } from "./context/WebsiteContext";
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
import NotFoundPage from "./pages/NotFoundPage";

export default function WebsiteApp() {
  return (
    <WebsiteProvider>
      <CartProvider>
        <OrderProvider>
          <Routes>
            <Route element={<WebsiteLayout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/menu" element={<MenuPage />} />
              <Route path="/menu/:id" element={<MenuItemDetailPage />} />
              <Route path="/cart" element={<CartPage />} />
              <Route path="/checkout" element={<CheckoutPage />} />
              <Route path="/order-confirmation" element={<OrderConfirmationPage />} />
              <Route path="/track" element={<TrackOrderPage />} />
              <Route path="/track/:orderNumber" element={<TrackOrderPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </OrderProvider>
      </CartProvider>
    </WebsiteProvider>
  );
}
