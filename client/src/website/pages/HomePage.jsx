import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useWebsite } from "../context/WebsiteContext";
import { useMenu } from "../hooks/useMenu";
import { DishVisual, formatPrice, VegMark, isSignatureDish, dishAccent } from "../components/common";
import Reveal from "../components/Reveal";
import Magnetic from "../components/Magnetic";

const FEATURES = [
  {
    title: "Fresh Daily",
    body: "Cooked fresh, never stale. Quality you can taste.",
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
  },
  {
    title: "Fast Delivery",
    body: "Hot and fresh, right to your door.",
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M5 8h11l2 4v6H5z" />
        <circle cx="8" cy="18" r="1.5" />
        <circle cx="16" cy="18" r="1.5" />
        <path d="M16 12h4v3h-4" />
      </svg>
    ),
  },
  {
    title: "Made with Love",
    body: "Recipes crafted over generations.",
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 17" />
      </svg>
    ),
  },
];

export default function HomePage() {
  const { settings, restaurantName, openingHours, getSetting } = useWebsite();
  const { categories, loading: menuLoading } = useMenu();
  const [activeCategory, setActiveCategory] = useState(null);
  const heroMediaRef = useRef(null);

  const tagline = getSetting("restaurant_tagline", "Delicious food, delivered with love");
  const description = getSetting("restaurant_description", "");
  const heroImage = getSetting("hero_image", "");
  const heroVideo = getSetting("hero_video", "");
  const aboutImage = getSetting("about_image", "");
  const aboutImgSrc = aboutImage || "/images/about-restaurant.png";
  const aboutContent = getSetting("about_content", "").trim() ||
    "We are a family-run kitchen serving fresh, flavourful food made from quality ingredients.";

  // Subtle hero parallax, disabled for reduced motion.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const update = () => {
      const el = heroMediaRef.current;
      if (!el) return;
      const y = Math.min(window.scrollY, window.innerHeight) * 0.22;
      el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0) scale(1.08)`;
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const popularItems = (activeCategory
    ? categories.find((c) => c._id === activeCategory)?.items || []
    : categories.slice(0, 3).flatMap((c) => c.items || [])
  ).slice(0, 8);

  const handleCategoryClick = (id) => {
    setActiveCategory((prev) => (prev === id ? null : id));
  };

  return (
    <div className="home-page">
      <section className="hero">
        <div className="hero-media" ref={heroMediaRef}>
          {heroVideo ? (
            <video className="hero-video" src={heroVideo} autoPlay muted loop playsInline poster={heroImage || undefined} />
          ) : heroImage ? (
            <img className="hero-img" src={heroImage} alt="" />
          ) : (
            <div className="hero-fallback" aria-hidden="true" />
          )}
        </div>
        <div className="hero-overlay" />
        <div className="container hero-content">
          <p className="hero-eyebrow">Welcome to {restaurantName}</p>
          <h1 className="hero-title">{tagline}</h1>
          {description && <p className="hero-subtitle">{description}</p>}
          <div className="hero-actions">
            <Magnetic>
              <Link to="/menu" className="btn btn-light btn-lg">
                Explore Menu
              </Link>
            </Magnetic>
            <Magnetic>
              <Link to="/checkout" className="btn btn-glass btn-lg">
                Order Now
              </Link>
            </Magnetic>
          </div>
        </div>
        <div className="hero-scroll" aria-hidden="true">
          Scroll
          <span />
        </div>
      </section>

      <section className="features">
        <div className="container features-grid">
          {FEATURES.map((feature, index) => (
            <Reveal key={feature.title} className="feature" delay={index * 90}>
              <div className="feature-icon">{feature.icon}</div>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="popular-section">
        <div className="container">
          <Reveal className="section-heading">
            <p className="section-eyebrow">Signature Dishes</p>
            <h2 className="section-title">Our Popular Menu</h2>
            <p className="section-subtitle">Handpicked favourites, prepared fresh for you.</p>
            <Link to="/menu" className="section-link">
              View Full Menu
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </Link>
          </Reveal>

          <Reveal className="category-pills" role="group" aria-label="Filter popular dishes by category">
            {categories.map((category) => (
              <button
                key={category._id}
                type="button"
                className={`category-pill ${activeCategory === category._id ? "active" : ""}`}
                onClick={() => handleCategoryClick(category._id)}
              >
                {category.name}
              </button>
            ))}
          </Reveal>

          {menuLoading ? (
            <div className="menu-grid">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="menu-card skeleton">
                  <div className="skeleton-monogram" />
                  <div className="menu-card-content">
                    <div className="skeleton-line" style={{ width: "55%" }} />
                    <div className="skeleton-line" style={{ width: "85%" }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="menu-grid">
              {popularItems.map((item, index) => (
                <Reveal key={item._id} delay={(index % 3) * 80}>
                  <Link
                    to={`/menu/${item._id}`}
                    className={`menu-card ${isSignatureDish(item) ? "featured" : ""}`}
                    data-accent={dishAccent(item.category)}
                  >
                    <div className="menu-card-monogram">
                      <DishVisual
                        item={item}
                        category={typeof item.category === "string" ? item.category : item.category?.name}
                        size="sm"
                        signature={isSignatureDish(item)}
                      />
                    </div>
                    <div className="menu-card-content">
                      <div className="menu-card-top">
                        <span className="menu-card-veg">
                          <VegMark isVeg={item.isVeg} />
                        </span>
                        {isSignatureDish(item) && <span className="menu-card-sig">Signature</span>}
                      </div>
                      <h3 className="menu-card-name">{item.name}</h3>
                      {item.description && <p className="menu-card-desc">{item.description}</p>}
                      <div className="menu-card-bottom">
                        <span className="menu-card-price">{formatPrice(item.price)}</span>
                        <span className="menu-card-add" aria-hidden="true">+</span>
                      </div>
                    </div>
                  </Link>
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="about-section">
        <div className="container about-grid">
          <Reveal className="about-media">
            <div className="about-media-inner">
              <img src={aboutImgSrc} alt={`Inside ${restaurantName}`} className="about-img" loading="lazy" />
            </div>
          </Reveal>
          <Reveal className="about-content" delay={120}>
            <p className="section-eyebrow">Our Story</p>
            <h2 className="section-title">About {restaurantName}</h2>
            <p className="about-text">{aboutContent}</p>
            <div className="about-stats">
              <div className="about-stat">
                <span className="stat-value">100%</span>
                <span className="stat-label">Fresh Ingredients</span>
              </div>
              <div className="about-stat">
                <span className="stat-value">{openingHours ? Object.keys(openingHours).length : 7}</span>
                <span className="stat-label">Days Open</span>
              </div>
              <div className="about-stat">
                <span className="stat-value">4.9★</span>
                <span className="stat-label">Rating</span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="cta-section">
        <div className="container">
          <Reveal className="cta-box">
            <h2 className="cta-title">Craving something delicious?</h2>
            <p className="cta-subtitle">Order online for pickup or doorstep delivery.</p>
            <div className="cta-actions">
              <Magnetic>
                <Link to="/menu" className="btn btn-light btn-lg">
                  Start Your Order
                </Link>
              </Magnetic>
              <Magnetic>
                <Link to="/checkout" className="btn btn-glass btn-lg">
                  Checkout
                </Link>
              </Magnetic>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}