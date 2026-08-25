import { useState } from "react";

export const formatPrice = (value) => {
  const num = Number(value || 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
};

export function VegMark({ isVeg }) {
  const veg = isVeg !== undefined ? isVeg : true;
  return (
    <span
      className={`veg-mark ${veg ? "veg" : "non-veg"}`}
      title={veg ? "Vegetarian" : "Non-vegetarian"}
      aria-label={veg ? "Vegetarian" : "Non-vegetarian"}
    >
      <span className="veg-dot" />
    </span>
  );
}

const SPICE_LABELS = {
  none: "Mild",
  mild: "Mild",
  medium: "Medium",
  hot: "Hot",
  extra_hot: "Extra Hot",
};

export function SpiceBadge({ level }) {
  if (!level || level === "none") return null;
  const count = level === "extra_hot" ? 3 : level === "hot" ? 3 : level === "medium" ? 2 : 1;
  return (
    <span className="badge badge-spice" title={`Spice level: ${SPICE_LABELS[level] || level}`}>
      <span aria-hidden="true">{"🌶".repeat(count)}</span>
      <span className="visually-hidden">{SPICE_LABELS[level] || level}</span>
    </span>
  );
}

export function QtyStepper({ qty, onChange, size = "md" }) {
  const handleClick = (delta) => (event) => {
    event.stopPropagation();
    onChange(Math.max(0, (Number(qty) || 0) + delta));
  };
  return (
    <div className={`qty-stepper ${size}`} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="qty-btn" onClick={handleClick(-1)} aria-label="Decrease quantity" disabled={qty <= 0}>
        −
      </button>
      <span className="qty-value" aria-live="polite">{qty}</span>
      <button type="button" className="qty-btn" onClick={handleClick(1)} aria-label="Increase quantity">
        +
      </button>
    </div>
  );
}

export function ItemImage({ item, className = "", alt = "" }) {
  if (item?.image) {
    return <img className={className} src={item.image} alt={alt} loading="lazy" />;
  }
  return (
    <div className={`item-image-fallback ${className}`} aria-hidden="true">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 17" />
      </svg>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Photography-free visual language.
   Deterministic, tasteful CSS/SVG monograms generated from the dish's name,
   category and dietary type. No images, no external assets.
   -------------------------------------------------------------------------- */

const CATEGORY_ACCENTS = {
  starters: "starters",
  appetizers: "starters",
  mains: "mains",
  main: "mains",
  curries: "mains",
  biryani: "rice",
  rice: "rice",
  fried_rice: "rice",
  chowmein: "noodles",
  noodles: "noodles",
  desserts: "desserts",
  beverages: "drinks",
  drinks: "drinks",
  chinese: "noodles",
  indian: "mains",
  pizza: "pizza",
  sides: "sides",
  sauces: "sides",
  extras: "sides",
};

const DEFAULT_ACCENT = "mains";

export function dishAccent(categoryName = "") {
  const key = String(categoryName || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return CATEGORY_ACCENTS[key] || DEFAULT_ACCENT;
}

export function dishInitial(name = "") {
  const clean = String(name || "").replace(/^["'([{]+/, "").trim();
  return clean.charAt(0).toUpperCase() || "•";
}

export function isSignatureDish(item = {}) {
  const name = String(item.name || "");
  return /(special|owner special|khyenn chyenn special|signature)/i.test(name);
}

/**
 * DishVisual — the editorial focal point for a photography-free menu.
 * Renders a fine-ringed monogram over a category-tinted gradient panel with
 * a subtle abstract line pattern. Accepts a `size` for card vs. detail.
 */
export function DishVisual({ item, category = "", size = "md", signature = false }) {
  const accent = dishAccent(category || item.category);
  const initial = dishInitial(item?.name);
  const [imgFailed, setImgFailed] = useState(false);
  const image = item?.image && !imgFailed ? item.image : null;
  const cls = `dish-visual dish-visual--${accent} dish-visual--${size} ${signature ? "dish-visual--sig" : ""} ${image ? "dish-visual--img" : ""}`;
  return (
    <div className={cls} data-accent={accent} aria-hidden={image ? undefined : "true"}>
      {image && (
        <img
          className="dish-visual__img"
          src={image}
          alt={item?.name || ""}
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      )}
      <svg className="dish-visual__pattern" viewBox="0 0 160 160" preserveAspectRatio="xMidYMid slice">
        <circle cx="80" cy="80" r="78" fill="none" stroke="currentColor" strokeOpacity="0.06" strokeWidth="1" />
        <circle cx="80" cy="80" r="58" fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" strokeDasharray="2 6" />
        <path d="M0 130 Q40 110 80 130 T160 130" fill="none" stroke="currentColor" strokeOpacity="0.05" strokeWidth="1.2" />
        <path d="M0 40 Q40 24 80 40 T160 40" fill="none" stroke="currentColor" strokeOpacity="0.05" strokeWidth="1.2" />
        <line x1="40" y1="150" x2="120" y2="150" stroke="currentColor" strokeOpacity="0.06" strokeWidth="1" />
      </svg>
      <span className="dish-visual__ring" />
      <span className="dish-visual__initial">{initial}</span>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="menu-card skeleton" aria-hidden="true">
      <div className="skeleton-block" />
      <div className="menu-card-content">
        <div className="skeleton-line" style={{ width: "70%" }} />
        <div className="skeleton-line" style={{ width: "90%" }} />
        <div className="skeleton-line short" />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Real food photography audit.
   A curated allow-list of genuine dish photos, plus an exclusion set of
   byte-identical / templated images shared across many dishes (so a single
   photo is never shown under multiple different dish names).
   -------------------------------------------------------------------------- */
export const REAL_FOOD_IMAGES = new Set([
  "blue-curacao-mocktail.webp",
  "blue-mocktail.webp",
  "butter-naan.webp",
  "chicken-biryani.webp",
  "chicken-chowmein.webp",
  "chicken-fried-rice.webp",
  "chicken-kanti.webp",
  "chicken-karahi.webp",
  "chicken-roll.webp",
  "chicken-tikka.webp",
  "chilli-chicken.webp",
  "chilli-paneer.webp",
  "crispy-corn.webp",
  "crispy-fried-chicken-momos.webp",
  "crispy-paneer.webp",
  "cutting-chai.webp",
  "finger-salad.webp",
  "fresh-lime-soda.webp",
  "fried-chicken-momos.webp",
  "green-apple-mocktail.webp",
  "green-tea.webp",
  "honey-chilli-chicken.webp",
  "honey-chilli-potato.webp",
  "hot-sauce.webp",
  "indian-salad.webp",
  "jeera-rice.webp",
  "kadhai-paneer-pizza.webp",
  "kashmiri-kahwa.webp",
  "ketchup.webp",
  "lemon-tea.webp",
  "malai-momos.webp",
  "masala-chicken.webp",
  "mattar-mushroom-pizza.webp",
  "mattar-paneer-pizza.webp",
  "mayonnaise.webp",
  "mint-chutney.webp",
  "onion-gravy.webp",
  "paneer-butter-masala-pizza.webp",
  "paneer-curry-pizza.webp",
  "pink-sauce-pasta.webp",
  "pizza-toppings.webp",
  "plain-naan.webp",
  "plain-rice.webp",
  "raita.webp",
  "rumali-roti.webp",
  "schezwan-chicken-fried-rice.webp",
  "schezwan-chicken.webp",
  "schezwan-veg-fried-rice.webp",
  "schezwan-veg-pizza.webp",
  "special-veg-pizza.webp",
  "steamed-chicken-momos.webp",
  "tandoori-momos.webp",
  "tawa-roti.webp",
  "tomato-paneer-pizza.webp",
  "veg-chowmein.webp",
  "vegetable-fried-rice.webp",
  "wazwan-chicken.webp",
  "white-sauce-pasta.webp",
]);

export const DUPLICATE_FOOD_IMAGES = new Set([
  "butter-chicken-pizza.webp",
  "cheese-pizza.webp",
  "deluxe-margherita-pizza.webp",
  "chicken-tikka-pizza.webp",
  "spicy-paneer-pizza.webp",
  "margherita-pizza.webp",
  "roasted-chicken-pizza.webp",
  "cheese-corn-pizza.webp",
  "special-chicken-pizza.webp",
  "blue-curacao-mocktail.webp",
  "blue-mocktail.webp",
  "cheese-burst-pizza.webp",
  "mexican-chicken-pizza.webp",
]);

const imageSlug = (url = "") => String(url).split("/").pop();

export const hasRealPhoto = (item = {}) => {
  const slug = imageSlug(item.image);
  return Boolean(item.image && REAL_FOOD_IMAGES.has(slug) && !DUPLICATE_FOOD_IMAGES.has(slug));
};

export const categoryName = (item = {}) =>
  typeof item.category === "string" ? item.category : item.category?.name || "Menu";

export const defaultModifiers = (item = {}) =>
  (Array.isArray(item.modifiers) ? item.modifiers : [])
    .map((mod) => {
      const option = mod.options?.[0];
      return {
        name: mod.name,
        option: option?.name || "Default",
        price: option ? Number(option.price) || 0 : 0,
      };
    })
    .filter((mod) => mod.name && mod.option);

export const GALLERY = [
  { src: "/images/menu/chicken-biryani.webp", alt: "Chicken biryani, layered rice and slow-cooked meat", size: "a" },
  { src: "/images/menu/tandoori-momos.webp", alt: "Tandoori momos, charred and spiced", size: "b" },
  { src: "/images/menu/honey-chilli-chicken.webp", alt: "Honey chilli chicken, glossy and crisp", size: "c" },
  { src: "/images/menu/chicken-karahi.webp", alt: "Chicken karahi, simmered in tomatoes and spice", size: "d" },
  { src: "/images/menu/special-veg-pizza.webp", alt: "Special veg pizza, straight from the oven", size: "e" },
  { src: "/images/menu/cutting-chai.webp", alt: "Cutting chai, strong and milky", size: "f" },
];