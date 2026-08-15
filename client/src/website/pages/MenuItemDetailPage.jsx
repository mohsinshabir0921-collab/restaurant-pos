import { useParams, Link } from "react-router-dom";
import { useMenuItem } from "../hooks/useMenu";
import { useCart } from "../context/CartContext";
import { useToast } from "../context/ToastContext";
import { VegMark, SpiceBadge, formatPrice, DishVisual, dishAccent, isSignatureDish } from "../components/common";
import Reveal from "../components/Reveal";
import { useState } from "react";

export default function MenuItemDetailPage() {
  const { id } = useParams();
  const { item, loading, error } = useMenuItem(id);
  const { addToCart } = useCart();
  const { notify } = useToast();
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState({});

  if (loading) {
    return (
      <div className="page-container">
        <div className="container">
          <div className="detail-skeleton">
            <div className="skeleton-block" />
            <div className="detail-skeleton-body">
              <div className="skeleton-line" style={{ width: "50%" }} />
              <div className="skeleton-line" style={{ width: "90%" }} />
              <div className="skeleton-line" style={{ width: "75%" }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="page-container">
        <div className="container">
          <div className="empty-state">
            <span className="not-found-code" aria-hidden="true">404</span>
            <h2>Item not found</h2>
            <p>{error || "This dish is no longer available."}</p>
            <Link to="/menu" className="btn btn-primary">
              Back to Menu
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const modifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
  const unitPrice =
    Number(item.price) +
    modifiers.reduce((sum, mod) => {
      const optionId = selected[mod._id] || mod.options?.[0]?._id;
      const option = mod.options?.find((opt) => opt._id === optionId);
      return sum + (option ? Number(option.price) : 0);
    }, 0);
  const total = unitPrice * qty;

  const handleAdd = () => {
    const normalizedModifiers = modifiers.map((mod) => {
      const optionId = selected[mod._id] || mod.options?.[0]?._id;
      const option = mod.options?.find((opt) => opt._id === optionId);
      return {
        name: mod.name,
        option: option?.name || "Default",
        price: option ? Number(option.price) : 0,
      };
    });
    addToCart(item, qty, normalizedModifiers, notes);
    notify("success", `${item.name} added to cart`);
    setQty(1);
    setNotes("");
  };

  const categoryName =
    typeof item.category === "string" ? item.category : item.category?.name || null;

  const signature = isSignatureDish(item);

  return (
    <div className="page-container">
      <div className="container">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden="true">/</span>
          <Link to="/menu">Menu</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{item.name}</span>
        </nav>

        <div className="detail-layout" data-accent={dishAccent(categoryName)}>
          <Reveal className="detail-media">
            <DishVisual item={item} category={categoryName} size="lg" signature={signature} />
          </Reveal>
          <Reveal className="detail-content" delay={100}>
            <div className="detail-meta">
              <VegMark isVeg={item.isVeg} />
              <SpiceBadge level={item.spiceLevel} />
              {categoryName && <span className="badge badge-category">{categoryName}</span>}
              {signature && <span className="badge badge-sig">Signature</span>}
            </div>
            <h1 className="detail-name">{item.name}</h1>
            {item.description && <p className="detail-desc">{item.description}</p>}
            <p className="detail-price">{formatPrice(item.price)}</p>

            {modifiers.length > 0 && (
              <div className="modifier-groups">
                {modifiers.map((mod) => (
                  <div key={mod._id} className="modifier-group">
                    <h3 className="modifier-title">
                      {mod.name}
                      {mod.required ? <span className="modifier-required">Required</span> : null}
                    </h3>
                    <div className="modifier-options">
                      {mod.options.map((opt) => {
                        const isSelected = (selected[mod._id] || mod.options?.[0]?._id) === opt._id;
                        return (
                          <label key={opt._id} className={`modifier-option ${isSelected ? "selected" : ""}`}>
                            <input
                              type="radio"
                              name={`modifier-${mod._id}`}
                              value={opt._id}
                              checked={isSelected}
                              onChange={() => setSelected((prev) => ({ ...prev, [mod._id]: opt._id }))}
                            />
                            <span className="modifier-option-name">{opt.name}</span>
                            {Number(opt.price) > 0 && (
                              <span className="modifier-option-price">+{formatPrice(opt.price)}</span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="modifier-notes">
              <label className="modifier-title" htmlFor="detail-notes">
                Special Instructions <span className="modifier-optional">Optional</span>
              </label>
              <textarea
                id="detail-notes"
                className="notes-input"
                rows="2"
                placeholder="Any special requests for this dish?"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={200}
              />
            </div>

            <div className="detail-footer">
              <div className="qty-stepper">
                <button type="button" className="qty-btn" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">
                  −
                </button>
                <span className="qty-value">{qty}</span>
                <button type="button" className="qty-btn" onClick={() => setQty((q) => q + 1)} aria-label="Increase quantity">
                  +
                </button>
              </div>
              <button type="button" className="btn btn-primary btn-lg" onClick={handleAdd}>
                Add to Cart · {formatPrice(total)}
              </button>
            </div>
          </Reveal>
        </div>
      </div>
    </div>
  );
}