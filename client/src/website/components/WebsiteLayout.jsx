import { Outlet, useLocation } from "react-router-dom";
import { useWebsite } from "../context/WebsiteContext";
import { useCart } from "../context/CartContext";
import { ToastProvider } from "../context/ToastContext";
import AnnouncementBar from "./AnnouncementBar";
import Header from "./Header";
import Footer from "./Footer";
import CartDrawer from "./CartDrawer";
import "../public-dark.css";

export default function WebsiteLayout() {
  const { restaurantName } = useWebsite();
  const { isCartOpen } = useCart();
  const location = useLocation();

  return (
    <ToastProvider>
      <div className="website-layout theme-dark">
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <AnnouncementBar />
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