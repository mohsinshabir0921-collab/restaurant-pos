import { useState, useMemo } from "react";
import { useMenu } from "../hooks/useMenu";
import { useCart } from "../context/CartContext";
import { useToast } from "../context/ToastContext";
import ItemModal from "../components/ItemModal";
import Reveal from "../components/Reveal";
import {
  VegMark,
  formatPrice,
  SpiceBadge,
  DishVisual,
  dishAccent,
  dishInitial,
  isSignatureDish,
} from "../components/common";

const DEFAULT_ICON = "🍽️";

export default function MenuPage() {
  const { categories, loading, error, reload } = useMenu();
  const { addToCart } = useCart();
  const { notify } = useToast();
  const [selectedItem, setSelectedItem] = useState(null);
  const [activeCategory, setActiveCategory] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | veg | nonveg

  const flattened = useMemo(() => categories.flatMap((c) => c.items || []), [categories]);

  const filteredCategories = useMemo(() => {
    const query = search.trim().toLowerCase();
    let items = flattened;

    if (query) {
      items = items.filter(
        (item) =>
          item.name?.toLowerCase().includes(query) ||
          item.description?.toLowerCase().includes(query)
      );
    }

    if (filter === "veg") items = items.filter((item) => item.isVeg);
    if (filter === "nonveg") items = items.filter((item) => !item.isVeg);

    if (items.length === 0) return [];

    // If searching/filtering, group by the item's category name.
    const grouped = categories
      .map((category) => ({
        ...category,
        items: items.filter((item) => {
          const itemCategory = typeof item.category === "string" ? item.category : item.category?.name || "";
          return itemCategory === category.name;
        }),
      }))
      .filter((category) => category.items.length > 0);

    return grouped;
  }, [categories, flattened, search, filter]);

  const activeCategoryObj =
    activeCategory && categories.find((c) => c._id === activeCategory);

  const visibleCategories = activeCategoryObj ? [activeCategoryObj] : filteredCategories;

  const handleAdd = (item) => {
    if (item.modifiers?.length > 0) {
      setSelectedItem(item);
      return;
    }
    addToCart(item, 1, [], "");
    notify("success", `${item.name} added to cart`);
  };

  if (loading) {
    return (
      <div className="page-container menu-page">
        <div className="page-hero">
          <p className="page-eyebrow">Fresh &amp; Flavourful</p>
          <h1 className="page-title">Our Menu</h1>
          <p className="page-subtitle">Loading our delicious menu…</p>
        </div>
        <div className="container menu-grid">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="menu-card skeleton">
              <div className="skeleton-monogram" />
              <div className="menu-card-content">
                <div className="skeleton-line" style={{ width: "55%" }} />
                <div className="skeleton-line" style={{ width: "88%" }} />
                <div className="skeleton-line short" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container menu-page">
        <div className="container">
          <div className="empty-state">
            <h2>Couldn't load the menu</h2>
            <p>{error}</p>
            <button type="button" className="btn btn-primary" onClick={reload}>
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container menu-page">
      <div className="page-hero">
        <p className="page-eyebrow">Fresh &amp; Flavourful</p>
        <h1 className="page-title">Our Menu</h1>
        <p className="page-subtitle">Freshly prepared dishes for takeaway &amp; delivery</p>
      </div>

      <div className="container">
        <div className="menu-toolbar">
          <div className="menu-search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="search"
              placeholder="Search dishes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search menu"
            />
          </div>

          <div className="menu-filters" role="group" aria-label="Dietary filter">
            <button
              type="button"
              className={`filter-btn ${filter === "all" ? "active" : ""}`}
              onClick={() => setFilter("all")}
            >
              All
            </button>
            <button
              type="button"
              className={`filter-btn ${filter === "veg" ? "active" : ""}`}
              onClick={() => setFilter("veg")}
            >
              Veg
            </button>
            <button
              type="button"
              className={`filter-btn ${filter === "nonveg" ? "active" : ""}`}
              onClick={() => setFilter("nonveg")}
            >
              Non-Veg
            </button>
          </div>
        </div>

        <nav className="menu-category-nav" aria-label="Menu categories">
          {categories.map((category) => (
            <button
              key={category._id}
              type="button"
              className={`category-tab ${activeCategory === category._id ? "active" : ""}`}
              onClick={() => setActiveCategory((prev) => (prev === category._id ? null : category._id))}
            >
              <span className="category-tab-icon" aria-hidden="true">
                {dishInitial(category.name)}
              </span>
              <span>{category.name}</span>
            </button>
          ))}
        </nav>

        {visibleCategories.length === 0 ? (
          <div className="empty-state">
            <h2>No dishes found</h2>
            <p>Try a different search or clear the filters.</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setSearch("");
                setFilter("all");
                setActiveCategory(null);
              }}
            >
              Clear Filters
            </button>
          </div>
        ) : (
          visibleCategories.map((category, categoryIndex) => (
            <section
              key={category._id}
              className="menu-section"
              id={`cat-${category._id}`}
              data-accent={dishAccent(category.name)}
            >
              <Reveal className="menu-section-heading" delay={40}>
                <span className="menu-section-index" aria-hidden="true">
                  {String(categoryIndex + 1).padStart(2, "0")}
                </span>
                <div className="menu-section-titles">
                  <h2 className="menu-section-title">{category.name}</h2>
                  <span className="menu-section-count">
                    {category.items.length} {category.items.length === 1 ? "dish" : "dishes"}
                  </span>
                </div>
                <span className="menu-section-rule" aria-hidden="true" />
              </Reveal>

              <div className="menu-grid">
                {category.items.map((item, index) => {
                  const signature = isSignatureDish(item);
                  return (
                    <Reveal key={item._id} delay={(index % 3) * 70 + categoryIndex * 30}>
                      <article className={`menu-card ${signature ? "featured" : ""}`}>
                        <div className="menu-card-monogram">
                          <DishVisual item={item} category={category.name} size="sm" signature={signature} />
                        </div>
                        <div className="menu-card-content">
                          <div className="menu-card-top">
                            <span className="menu-card-veg">
                              <VegMark isVeg={item.isVeg} />
                            </span>
                            {signature && <span className="menu-card-sig">Signature</span>}
                            <SpiceBadge level={item.spiceLevel} />
                          </div>
                          <h3 className="menu-card-name">{item.name}</h3>
                          {item.description && <p className="menu-card-desc">{item.description}</p>}
                          {item.modifiers?.length > 0 && (
                            <p className="menu-card-modifiers">{item.modifiers.map((m) => m.name).join(" · ")}</p>
                          )}
                          <div className="menu-card-bottom">
                            <span className="menu-card-price">
                              <span className="menu-card-price-label">from</span> {formatPrice(item.price)}
                            </span>
                            <button
                              type="button"
                              className="add-btn"
                              onClick={() => handleAdd(item)}
                              aria-label={`Add ${item.name} to cart`}
                            >
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                <line x1="12" y1="5" x2="12" y2="19" />
                                <line x1="5" y1="12" x2="19" y2="12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </article>
                    </Reveal>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>

      <ItemModal item={selectedItem} onClose={() => setSelectedItem(null)} />
    </div>
  );
}