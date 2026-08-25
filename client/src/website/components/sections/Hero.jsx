import { Link } from "react-router-dom";
import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
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

export default function Hero({
  restaurantName,
  tagline,
  description,
  heroImage,
  heroVideo,
  openingHours,
  orderNote,
}) {
  const heroRef = useRef(null);
  const reduce = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const mediaY = useTransform(scrollYProgress, [0, 1], [0, 130]);
  const mediaScale = useTransform(scrollYProgress, [0, 1], [1.12, 1.24]);

  const todayKey = DAY_KEYS[new Date().getDay()];
  const today = openingHours?.[todayKey];
  const openToday =
    today && today.open && today.close ? `Open today ${fmtTime(today.open)} – ${fmtTime(today.close)}` : null;

  return (
    <section className="hp-hero" ref={heroRef}>
      <div className="hp-hero-scrim" aria-hidden="true" />
      <div className="hp-hero-monogram" aria-hidden="true">K</div>
      <div className="hp-hero-dish" aria-hidden="true">
        <img className="hp-hero-dish-img" src="/images/menu/scroll-feast-pizza.png" alt="" />
      </div>

      <motion.div
        className="container hp-hero-content"
        variants={heroContainer}
        initial={reduce ? false : "hidden"}
        animate="show"
      >
        <motion.p className="hp-hero-kicker" variants={heroItem}>
          <span className="hp-hero-kicker-rule" />
          Restaurant · Est. 2026
        </motion.p>
        <motion.p className="hp-hero-brand" variants={heroItem}>
          {restaurantName}
        </motion.p>
        <motion.div className="hp-hero-actions" variants={heroItem}>
          <Magnetic>
            <Link to="/menu" className="btn btn-light btn-lg">
              Explore Menu
            </Link>
          </Magnetic>
          <Magnetic>
            <Link to="/checkout" className="btn btn-outline-light btn-lg">
              Order Now
            </Link>
          </Magnetic>
        </motion.div>
      </motion.div>

      <div className="hp-hero-scroll" aria-hidden="true">
        <span className="hp-hero-scroll-line" />
        Scroll
      </div>
    </section>
  );
}
