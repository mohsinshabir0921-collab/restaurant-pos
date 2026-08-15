import { useState, useEffect } from "react";
import { useCart } from "../context/CartContext";
import { useToast } from "../context/ToastContext";
import { formatPrice, VegMark, SpiceBadge, QtyStepper, DishVisual, isSignatureDish } from "./common";

export default function ItemModal({ item, onClose }) {
  const { addToCart } = useCart();
  const { notify } = useToast();
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState({});

  useEffect(() => {
    setQty(1);
    setNotes("");
    setSelected({});
  }, [item?._id]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    if (item) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", onKeyDown);
    }
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [item, onClose]);

  if (!item) return null;

  const modifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
  const unitPrice =
    Number(item.price) +
    modifiers.reduce((sum, mod) => {
      const selectedOption = selected[mod._id] || mod.options?.[0]?._id;
      const option = mod.options?.find((opt) => opt._id === selectedOption);
      return sum + (option ? Number(option.price) : 0);
    }, 0);
  const total = unitPrice * qty;

  const handleOptionChange = (modId, optionId) => {
    setSelected((prev) => ({ ...prev, [modId]: optionId }));
  };

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
    onClose();
  };

  return (
    <div className="modal-root" role="dialog" aria-modal="true" aria-label={item.name}>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="item-modal">
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="item-modal-media">
          <DishVisual
            item={item}
            category={typeof item.category === "string" ? item.category : item.category?.name}
            size="md"
            signature={isSignatureDish(item)}
          />
        </div>

        <div className="item-modal-body">
          <div className="item-modal-top">
            <VegMark isVeg={item.isVeg} />
            <SpiceBadge level={item.spiceLevel} />
          </div>
          <h2 className="item-modal-name">{item.name}</h2>
          {item.description && <p className="item-modal-desc">{item.description}</p>}

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
                            onChange={() => handleOptionChange(mod._id, opt._id)}
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
            <label className="modifier-title" htmlFor="item-notes">
              Special Instructions <span className="modifier-optional">Optional</span>
            </label>
            <textarea
              id="item-notes"
              className="notes-input"
              rows="2"
              placeholder="Any special requests for this dish?"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="item-modal-footer">
            <QtyStepper qty={qty} onChange={(next) => setQty(next)} />
            <button type="button" className="btn btn-primary btn-lg" onClick={handleAdd}>
              Add · {formatPrice(total)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}