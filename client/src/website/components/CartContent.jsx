import { Link } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { formatPrice, VegMark, QtyStepper, ItemImage } from "./common";

export default function CartContent({ onCheckout }) {
  const { cartItems, updateQuantity, removeFromCart, subtotal, isEmpty } = useCart();

  if (isEmpty) {
    return (
      <div className="cart-empty">
        <div className="cart-empty-icon" aria-hidden="true">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
          </svg>
        </div>
        <h3>Your cart is empty</h3>
        <p>Add some delicious dishes to get started.</p>
        <Link to="/menu" className="btn btn-primary">
          Browse Menu
        </Link>
      </div>
    );
  }

  return (
    <div className="cart-content">
      <ul className="cart-item-list" role="list">
        {cartItems.map((item) => (
          <li key={item.id} className="cart-item" role="listitem">
            <div className="cart-item-media">
              <ItemImage item={item} className="cart-item-img" alt="" />
              <span className="cart-item-veg">
                <VegMark isVeg={item.isVeg} />
              </span>
            </div>
            <div className="cart-item-body">
              <div className="cart-item-top">
                <h4 className="cart-item-name">{item.name}</h4>
                <button
                  type="button"
                  className="cart-item-remove"
                  onClick={() => removeFromCart(item.id)}
                  aria-label={`Remove ${item.name} from cart`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              {(item.modifiers?.length > 0 || item.notes) && (
                <p className="cart-item-meta">
                  {item.modifiers.map((m) => `${m.option} (+${formatPrice(m.price)})`).join(", ")}
                  {item.notes ? ` — ${item.notes}` : ""}
                </p>
              )}
              <div className="cart-item-bottom">
                <QtyStepper qty={item.qty} onChange={(qty) => updateQuantity(item.id, qty)} size="sm" />
                <span className="cart-item-price">{formatPrice(item.price + (item.modifiers || []).reduce((s, m) => s + (Number(m.price) || 0), 0))}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="cart-summary">
        <div className="cart-summary-row">
          <span>Subtotal</span>
          <span>{formatPrice(subtotal)}</span>
        </div>
        <p className="cart-summary-note">
          Delivery fee, taxes &amp; discounts are calculated at checkout.
        </p>
        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={onCheckout}>
          Proceed to Checkout
        </button>
        <Link to="/menu" className="btn btn-ghost btn-block">
          Continue Shopping
        </Link>
      </div>
    </div>
  );
}