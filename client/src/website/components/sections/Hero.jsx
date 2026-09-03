import { Link } from "react-router-dom";
import { useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import Magnetic from "../Magnetic";

const HERO_EASE = [0.16, 1, 0.3, 1];

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const DEFAULT_SUB = "Authentic recipes, finest ingredients, and the warmth of a table worth returning to.";

const fmtTime = (time) => {
  if (!time) return "";
  const [hours, minutes] = String(time).split(":");
  const h = parseInt(hours, 10);
  if (Number.isNaN(h)) return time;
  const suffix = h >= 12 ? "PM" : "AM";
  const display = h % 12 || 12;
  return `${display}:${minutes || "00"} ${suffix}`;
};

const heroContainer = {
  hidden: { opacity: 1 },
  show: { opacity: 1, transition: { staggerChildren: 0.09, delayChildren: 0.12 } },
};

const heroItem = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: HERO_EASE } },
};

/**
 * Hero — "Flavours Worth Remembering".
 * Left: uppercase gold eyebrow, elegant serif headline, supporting copy, dual
 * CTAs and a quiet trust row.
 * When an uploaded hero video or image is configured it becomes the full-bleed
 * background, with a subtle dark overlay/scrim keeping copy readable and the
 * decorative CSS/SVG composition removed. When neither is configured, the
 * standalone decorative brand composition is shown instead.
 * Fonts: Fraunces (serif display) + Work Sans (sans). Motion is a single
 * subtle opacity reveal, disabled under prefers-reduced-motion.
 */
export default function Hero({
  restaurantName,
  tagline,
  description,
  openingHours,
  orderNote,
  heroImageUrl,
  heroVideoUrl,
}) {
  const heroRef = useRef(null);
  const reduce = useReducedMotion();

  const todayKey = DAY_KEYS[new Date().getDay()];
  const today = openingHours?.[todayKey];
  const openToday =
    today && today.open && today.close ? `Open today ${fmtTime(today.open)} – ${fmtTime(today.close)}` : null;

  const hasMedia = !!(heroVideoUrl || heroImageUrl);

  const metaRow = [
    "Traditional flavours",
    "Crafted fresh",
    openToday || "Delivered locally",
  ].filter(Boolean);

  return (
    <section className={hasMedia ? "hp-hero hp-hero--media" : "hp-hero"} ref={heroRef}>
      {heroVideoUrl ? (
        <video
          className="hp-hero-media"
          src={heroVideoUrl}
          autoPlay
          muted
          loop
          playsInline
          aria-hidden="true"
        />
      ) : heroImageUrl ? (
        <img
          className="hp-hero-media"
          src={heroImageUrl}
          alt=""
          aria-hidden="true"
        />
      ) : null}

      {hasMedia && <div className="hp-hero-scrim" aria-hidden="true" />}

      {/* Standalone decorative brand composition — only shown when there is no
          uploaded hero media, as a fallback design. Pure CSS/SVG, no image. */}
      {!hasMedia && (
        <motion.div className="hp-hero-visual" aria-hidden="true">
          <span className="hp-hero-visual-ambient" />
          <span className="hp-hero-visual-jaali" />
          <span className="hp-hero-visual-arch" />
          <span className="hp-hero-visual-mandala" />
          <span className="hp-hero-visual-frame" />
          <span className="hp-hero-visual-corner hp-hero-visual-corner-tl" />
          <span className="hp-hero-visual-corner hp-hero-visual-corner-br" />
          <span className="hp-hero-visual-label">Kashmir · Tradition</span>
        </motion.div>
      )}

      <motion.div
        className="container hp-hero-content"
        variants={heroContainer}
        initial={reduce ? false : "hidden"}
        animate="show"
      >
        <motion.p className="hp-hero-eyebrow" variants={heroItem}>
          <span className="hp-hero-eyebrow-rule" aria-hidden="true" />
          <span>SINCE 2020</span>
        </motion.p>

        <motion.h1 className="hp-hero-title" variants={heroItem}>
          Flavours Worth
          <br />
          <em>Remembering</em>
        </motion.h1>

        <motion.p className="hp-hero-sub" variants={heroItem}>
          {description?.trim() || DEFAULT_SUB}
        </motion.p>

        <motion.div className="hp-hero-actions" variants={heroItem}>
          <Magnetic>
            <Link to="/checkout" className="btn btn-light btn-lg hp-hero-cta hp-hero-cta-primary">
              Order Now
            </Link>
          </Magnetic>
          <Magnetic>
            <Link to="/menu" className="btn btn-outline-light btn-lg hp-hero-cta hp-hero-cta-secondary">
              Explore Menu
            </Link>
          </Magnetic>
        </motion.div>

        <motion.ul className="hp-hero-trust" variants={heroItem} aria-label="Restaurant details">
          {metaRow.map((item) => (
            <li key={item} className="hp-hero-trust-item">
              <span className="hp-hero-trust-sep" aria-hidden="true" />
              {item}
            </li>
          ))}
        </motion.ul>
      </motion.div>
    </section>
  );
}
