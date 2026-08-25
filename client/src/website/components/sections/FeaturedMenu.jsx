import { useState } from "react";
import { Link } from "react-router-dom";
import Reveal from "../Reveal";
import { DishVisual, formatPrice, isSignatureDish, hasRealPhoto, categoryName, defaultModifiers } from "../common";

export default function FeaturedMenu({ categories, popularItems, loading, onAdd }) {
  const [activeCategory, setActiveCategory] = useState(null);

  const items = (activeCategory
    ? categories.find((c) => c._id === activeCategory)?.items || []
    : popularItems
  ).slice(0, 8);

  const featuredItem = items[0];
  const supportItems = items.slice(1);

  const handleCategoryClick = (id) => setActiveCategory((prev) => (prev === id ? null : id));
  const handleAdd = (item) => onAdd(item, defaultModifiers(item));

  if (loading) {
    return (
      <section className="hp-featured">
        <div className="container">
          <div className="hp-featured-skeleton" aria-hidden="true" />
        </div>
      </section>
    );
  }

  if (!featuredItem) {
    return (
      <section className="hp-featured">
        <div className="container">
          <p className="hp-featured-empty">The kitchen is warming up. Please check back shortly.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="hp-featured" data-accent={categoryName(featuredItem) !== "Menu" ? undefined : undefined}>
      <div className="container">
        <Reveal className="hp-featured-head">
          <p className="section-eyebrow">From the Kitchen</p>
          <h2 className="section-title">Some things are worth ordering twice.</h2>
        </Reveal>

        {categories.length > 0 && (
          <Reveal className="hp-rail" role="group" aria-label="Filter dishes by category">
            <button
              type="button"
              className={`hp-rail-item ${activeCategory === null ? "active" : ""}`}
              onClick={() => handleCategoryClick(null)}
            >
              <span className="hp-rail-num">00</span>
              <span className="hp-rail-name">All</span>
            </button>
            {categories.map((category, index) => (
              <button
                key={category._id}
                type="button"
                className={`hp-rail-item ${activeCategory === category._id ? "active" : ""}`}
                onClick={() => handleCategoryClick(category._id)}
              >
                <span className="hp-rail-num">{String(index + 1).padStart(2, "0")}</span>
                <span className="hp-rail-name">{category.name}</span>
              </button>
            ))}
          </Reveal>
        )}

        <div className="hp-featured-stage">
          <Reveal className="hp-featured-hero">
            <div className="hp-featured-media">
              {hasRealPhoto(featuredItem) ? (
                <img className="hp-featured-img" src={featuredItem.image} alt={featuredItem.name} loading="lazy" />
              ) : (
                <DishVisual
                  item={featuredItem}
                  category={categoryName(featuredItem)}
                  size="lg"
                  signature={isSignatureDish(featuredItem)}
                />
              )}
            </div>
            <div className="hp-featured-body">
              <span className="hp-featured-kicker">{categoryName(featuredItem)}</span>
              <h3 className="hp-featured-name">
                <Link to={`/menu/${featuredItem._id}`}>{featuredItem.name}</Link>
              </h3>
              {featuredItem.description && <p className="hp-featured-desc">{featuredItem.description}</p>}
              <div className="hp-featured-foot">
                <span className="hp-featured-price">{formatPrice(featuredItem.price)}</span>
                <button
                  type="button"
                  className="btn btn-primary hp-featured-add"
                  onClick={() => handleAdd(featuredItem)}
                >
                  Add to Cart
                </button>
              </div>
              <span className="hp-featured-note">Probably ordering this again.</span>
            </div>
          </Reveal>

          <div className="hp-featured-list">
            {supportItems.map((item, index) => (
              <Reveal key={item._id} className="hp-featured-row-wrap" delay={(index % 3) * 70}>
                <div className="hp-featured-row">
                  <span className="hp-row-num">{String(index + 2).padStart(2, "0")}</span>
                  <Link to={`/menu/${item._id}`} className="hp-row-media" aria-hidden="true" tabIndex={-1}>
                    {hasRealPhoto(item) ? (
                      <img className="hp-row-img" src={item.image} alt="" loading="lazy" />
                    ) : (
                      <DishVisual item={item} category={categoryName(item)} size="sm" signature={isSignatureDish(item)} />
                    )}
                  </Link>
                  <span className="hp-row-body">
                    <Link to={`/menu/${item._id}`} className="hp-row-name">
                      {item.name}
                    </Link>
                    <span className="hp-row-cat">{categoryName(item)}</span>
                  </span>
                  <span className="hp-row-price">{formatPrice(item.price)}</span>
                  <button
                    type="button"
                    className="hp-row-add"
                    aria-label={`Add ${item.name} to cart`}
                    onClick={() => handleAdd(item)}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        <Reveal className="hp-featured-more">
          <Link to="/menu" className="section-link">
            View Full Menu
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
