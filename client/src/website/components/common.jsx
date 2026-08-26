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
  "/images/menu/bbq-chicken-pizza.webp",
  "/images/menu/black-coffee.webp",
  "/images/menu/blue-curacao-mocktail.webp",
  "/images/menu/blue-mocktail.webp",
  "/images/menu/butter-chicken-pizza.webp",
  "/images/menu/butter-chicken.webp",
  "/images/menu/butter-naan.webp",
  "/images/menu/cappuccino.webp",
  "/images/menu/cheese-burst-pizza.webp",
  "/images/menu/cheese-corn-pizza.webp",
  "/images/menu/cheese-pizza.webp",
  "/images/menu/chicken-biryani.webp",
  "/images/menu/chicken-blast-pizza.webp",
  "/images/menu/chicken-chowmein.webp",
  "/images/menu/chicken-curry.webp",
  "/images/menu/chicken-fingers.webp",
  "/images/menu/chicken-fried-rice.webp",
  "/images/menu/chicken-kanti.webp",
  "/images/menu/chicken-karahi.webp",
  "/images/menu/chicken-nuggets.webp",
  "/images/menu/chicken-pulao.webp",
  "/images/menu/chicken-roll.webp",
  "/images/menu/chicken-tikka-pizza.webp",
  "/images/menu/chilli-chicken.webp",
  "/images/menu/chilli-paneer.webp",
  "/images/menu/coffee.webp",
  "/images/menu/crispy-corn.webp",
  "/images/menu/crispy-fried-chicken-momos.webp",
  "/images/menu/crispy-paneer.webp",
  "/images/menu/cutting-chai.webp",
  "/images/menu/deluxe-margherita-pizza.webp",
  "/images/menu/finger-salad.webp",
  "/images/menu/fresh-lime-soda.webp",
  "/images/menu/fried-chicken-momos.webp",
  "/images/menu/golden-delight-pizza.webp",
  "/images/menu/green-apple-mocktail.webp",
  "/images/menu/green-salad.webp",
  "/images/menu/green-tea.webp",
  "/images/menu/honey-chilli-chicken.webp",
  "/images/menu/honey-chilli-potato.webp",
  "/images/menu/hot-sauce.webp",
  "/images/menu/indian-salad.webp",
  "/images/menu/jeera-rice.webp",
  "/images/menu/kadhai-paneer-pizza.webp",
  "/images/menu/kashmiri-kahwa.webp",
  "/images/menu/ketchup.webp",
  "/images/menu/lemon-tea.webp",
  "/images/menu/malai-momos.webp",
  "/images/menu/margherita-pizza.webp",
  "/images/menu/masala-chicken.webp",
  "/images/menu/mattar-mushroom-pizza.webp",
  "/images/menu/mattar-paneer-pizza.webp",
  "/images/menu/mayonnaise.webp",
  "/images/menu/mexican-chicken-pizza.webp",
  "/images/menu/mint-chutney.webp",
  "/images/menu/onion-gravy.webp",
  "/images/menu/owner-special-pizza.webp",
  "/images/menu/paneer-butter-masala-pizza.webp",
  "/images/menu/paneer-curry-pizza.webp",
  "/images/menu/peri-peri-chicken-pizza.webp",
  "/images/menu/pink-sauce-pasta.webp",
  "/images/menu/pizza-toppings.webp",
  "/images/menu/plain-naan.webp",
  "/images/menu/plain-rice.webp",
  "/images/menu/raita.webp",
  "/images/menu/roasted-chicken-pizza.webp",
  "/images/menu/rumali-roti.webp",
  "/images/menu/schezwan-chicken-fried-rice.webp",
  "/images/menu/schezwan-chicken.webp",
  "/images/menu/schezwan-veg-fried-rice.webp",
  "/images/menu/schezwan-veg-pizza.webp",
  "/images/menu/special-chicken-pizza.webp",
  "/images/menu/special-veg-pizza.webp",
  "/images/menu/spicy-paneer-pizza.webp",
  "/images/menu/steamed-chicken-momos.webp",
  "/images/menu/tandoori-chicken.webp",
  "/images/menu/tandoori-momos.webp",
  "/images/menu/tawa-roti.webp",
  "/images/menu/tomato-paneer-pizza.webp",
  "/images/menu/veg-chowmein.webp",
  "/images/menu/vegetable-fried-rice.webp",
  "/images/menu/vegetable-pulao.webp",
  "/images/menu/virgin-mojito.webp",
  "/images/menu/wazwan-chicken.webp",
  "/images/menu/white-sauce-pasta.webp",
]);

export const DUPLICATE_FOOD_IMAGES = new Set([
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