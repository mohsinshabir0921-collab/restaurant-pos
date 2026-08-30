import { Link } from "react-router-dom";
import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { useDeviceTier } from "../../hooks/useDeviceTier";
import Magnetic from "../Magnetic";

const HERO_EASE = [0.16, 1, 0.3, 1];

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

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
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: HERO_EASE } },
};

/**
 * Hero — "Warm Cinematic Editorial".
 * Full-bleed food photography as the dominant, integrated element (no floating
 * sticker / glowing cutout). Strong dark gradient overlay keeps copy readable.
 * Content hierarchy: eyebrow -> headline -> supporting line -> CTAs.
 * Motion reuses the existing framer-motion Reveal-style stagger. The subtle
 * scroll parallax is disabled under prefers-reduced-motion AND on coarse
 * pointers (touch), so mobile stays calm and never reproduces desktop parallax.
 */
export default function Hero({
  restaurantName,
  tagline,
  description,
  openingHours,
  orderNote,
}) {
  const heroRef = useRef(null);
  const reduce = useReducedMotion();
  const { mobile } = useDeviceTier();

  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const mediaY = useTransform(scrollYProgress, [0, 1], [0, 110]);
  const mediaScale = useTransform(scrollYProgress, [0, 1], [1.08, 1.18]);

  const todayKey = DAY_KEYS[new Date().getDay()];
  const today = openingHours?.[todayKey];
  const openToday =
    today && today.open && today.close ? `Open today ${fmtTime(today.open)} – ${fmtTime(today.close)}` : null;

  // Fixed, curated food visual for the cinematic hero. A dedicated high-res
  // opaque food photo whose dark surround merges into the charcoal scene, so
  // the dish reads as "in scene" rather than a floating sticker.
  const heroImage = "/images/menu/scroll-feast-pizza.png";

  // Coarse/mobile pointers get no parallax — the food stays calm and content
  // stays centered, and it never mimics the desktop drift. Same for reduced
  // motion. Fine-pointer desktop keeps the subtle scroll parallax.
  const canParallax = !reduce && !mobile;

  return (
    <section className="hp-hero" ref={heroRef}>
      <motion.div
        className="hp-hero-media"
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          ...(canParallax ? { y: mediaY, scale: mediaScale } : {}),
        }}
      >
        <img
          className="hp-hero-media-el"
          src={heroImage}
          alt=""
          fetchPriority="high"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </motion.div>

      <div className="hp-hero-scrim" aria-hidden="true" />

      <motion.div
        className="container hp-hero-content"
        variants={heroContainer}
        initial={reduce ? false : "hidden"}
        animate="show"
      >
        <motion.p className="hp-hero-eyebrow" variants={heroItem}>
          <span className="hp-hero-eyebrow-rule" />
          Restaurant · Est. 2020
        </motion.p>
        <motion.h1 className="hp-hero-title" variants={heroItem}>
          {restaurantName}
        </motion.h1>
        {tagline ? (
          <motion.p className="hp-hero-tagline" variants={heroItem}>
            {tagline}
          </motion.p>
        ) : null}
        {description ? (
          <motion.p className="hp-hero-sub" variants={heroItem}>
            {description}
          </motion.p>
        ) : null}
        {(orderNote || openToday) && (
          <motion.p className="hp-hero-meta" variants={heroItem}>
            {[orderNote, openToday].filter(Boolean).join(" · ")}
          </motion.p>
        )}
        <motion.div className="hp-hero-actions" variants={heroItem}>
          <Magnetic>
            <Link to="/checkout" className="btn btn-light btn-lg hp-hero-cta">
              Order Now
            </Link>
          </Magnetic>
          <Magnetic>
            <Link to="/menu" className="btn btn-outline-light btn-lg hp-hero-cta">
              Explore Menu
            </Link>
          </Magnetic>
        </motion.div>
      </motion.div>
    </section>
  );
}
