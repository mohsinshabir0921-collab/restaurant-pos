import { Outlet, useLocation } from "react-router-dom";
import { useWebsite } from "../context/WebsiteContext";
import { useCart } from "../context/CartContext";
import { ToastProvider } from "../context/ToastContext";
import Header from "./Header";
import Footer from "./Footer";
import CartDrawer from "./CartDrawer";

export default function WebsiteLayout() {
  const { restaurantName } = useWebsite();
  const { isCartOpen } = useCart();
  const location = useLocation();

  return (
    <ToastProvider>
      <div className="website-layout">
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <Header restaurantName={restaurantName} />
        <main id="main-content" className="main-content">
          <div key={location.pathname} className="page-enter">
            <Outlet />
          </div>
        </main>
        <Footer restaurantName={restaurantName} />
        <CartDrawer isOpen={isCartOpen} />
      </div>
    </ToastProvider>
  );
}