import { Link } from "react-router-dom";
import { useCart } from "../context/CartContext";
import CartContent from "../components/CartContent";
import Reveal from "../components/Reveal";

export default function CartPage() {
  const { itemCount } = useCart();

  return (
    <div className="page-container cart-page">
      <div className="page-hero">
        <p className="page-eyebrow">Your Selection</p>
        <h1 className="page-title">Your Cart</h1>
        <p className="page-subtitle">
          {itemCount > 0 ? `${itemCount} item${itemCount > 1 ? "s" : ""} in your cart` : "Ready to order?"}
        </p>
      </div>
      <div className="container">
        <div className="cart-page-layout">
          <Reveal>
            <CartContent onCheckout={() => {}} />
          </Reveal>
          <Reveal delay={120} className="cart-page-aside">
            <Link to="/checkout" className="btn btn-primary btn-lg btn-block">
              Proceed to Checkout
            </Link>
            <Link to="/menu" className="btn btn-ghost btn-block">
              Continue Shopping
            </Link>
          </Reveal>
        </div>
      </div>
    </div>
  );
}