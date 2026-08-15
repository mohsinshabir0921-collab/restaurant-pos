import { Link, useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useCart } from "../context/CartContext";
import { useOrder } from "../context/OrderContext";
import { useWebsite } from "../context/WebsiteContext";

const NAV_LINKS = [
  { path: "/", label: "Home" },
  { path: "/menu", label: "Menu" },
  { path: "/cart", label: "Cart" },
];

export default function Header({ restaurantName }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { itemCount, setIsCartOpen } = useCart();
  const { orderType, setOrderType } = useOrder();
  const { settings } = useWebsite();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const isHome = location.pathname === "/";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const takeawayEnabled = settings.takeaway_enabled !== false;
  const deliveryEnabled = settings.delivery_enabled !== false;

  const handleOrderTypeChange = (type) => {
    setOrderType(type);
    if (location.pathname === "/") navigate("/menu");
  };

  const isMenuOrCheckout = location.pathname.startsWith("/menu") || location.pathname === "/checkout";

  return (
    <header className={`site-header ${scrolled ? "scrolled" : ""} ${isHome ? "over-hero" : ""}`}>
      <div className="container header-inner">
        <Link to="/" className="site-logo" aria-label={`${restaurantName} - Home`}>
          <span className="logo-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" />
              <path d="M10 16c0-3.314 2.686-6 6-6s6 2.686 6 6-2.686 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M16 10v6l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="logo-text">{restaurantName}</span>
        </Link>

        <nav className="header-nav" aria-label="Main navigation">
          <ul className="nav-list">
            {NAV_LINKS.map((link) => (
              <li key={link.path}>
                <Link
                  to={link.path}
                  className={`nav-link ${location.pathname === link.path ? "active" : ""}`}
                  aria-current={location.pathname === link.path ? "page" : undefined}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="header-actions">
          {isMenuOrCheckout && (
            <div className="order-type-switch" role="group" aria-label="Order type">
              {takeawayEnabled && (
                <button
                  type="button"
                  className={`ot-switch-btn ${orderType === "takeaway" ? "active" : ""}`}
                  onClick={() => handleOrderTypeChange("takeaway")}
                  aria-pressed={orderType === "takeaway"}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <path d="M7 10l5 5 5-5" />
                    <path d="M12 15V3" />
                  </svg>
                  Takeaway
                </button>
              )}
              {deliveryEnabled && (
                <button
                  type="button"
                  className={`ot-switch-btn ${orderType === "delivery" ? "active" : ""}`}
                  onClick={() => handleOrderTypeChange("delivery")}
                  aria-pressed={orderType === "delivery"}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M5 8h11l2 4v6H5z" />
                    <circle cx="8" cy="18" r="1.5" />
                    <circle cx="16" cy="18" r="1.5" />
                    <path d="M16 12h4v3h-4" />
                  </svg>
                  Delivery
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            className="cart-trigger"
            onClick={() => setIsCartOpen(true)}
            aria-label={itemCount > 0 ? `Cart with ${itemCount} items` : "Open cart"}
            aria-expanded="false"
            aria-haspopup="dialog"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            {itemCount > 0 && <span className="cart-badge">{itemCount}</span>}
          </button>

          <button
            type="button"
            className={`mobile-menu-btn ${mobileOpen ? "open" : ""}`}
            onClick={() => setMobileOpen((open) => !open)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileOpen}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="mobile-nav">
          <ul className="mobile-nav-list">
            {NAV_LINKS.map((link) => (
              <li key={link.path}>
                <Link to={link.path} className={`mobile-nav-link ${location.pathname === link.path ? "active" : ""}`}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  );
}