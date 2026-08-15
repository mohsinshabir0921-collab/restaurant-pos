import { useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import CartContent from "./CartContent";

export default function CartDrawer({ isOpen }) {
  const { setIsCartOpen, itemCount } = useCart();
  const navigate = useNavigate();

  const handleClose = () => setIsCartOpen(false);

  const handleCheckout = () => {
    setIsCartOpen(false);
    navigate("/checkout");
  };

  return (
    <div className={`drawer-root ${isOpen ? "open" : ""}`} aria-hidden={!isOpen}>
      <div className="drawer-backdrop" onClick={handleClose} />
      <aside
        className="cart-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
        aria-hidden={!isOpen}
      >
        <div className="drawer-header">
          <h2 className="drawer-title">
            Your Cart{" "}
            {itemCount > 0 && <span className="drawer-count">{itemCount}</span>}
          </h2>
          <button
            type="button"
            className="drawer-close"
            onClick={handleClose}
            aria-label="Close cart"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="drawer-body">
          <CartContent onCheckout={handleCheckout} />
        </div>
      </aside>
    </div>
  );
}