import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

const EASE = [0.16, 1, 0.3, 1];

// Scroll-based reveal wrapper. Fades/rises content in once on enter.
// Reduced motion: renders a plain element with no transform/opacity animation.
export default function Reveal({
  as: Tag = "div",
  children,
  className = "",
  delay = 0,
  threshold = 0.12,
  style,
  ...rest
}) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            io.disconnect();
          }
        });
      },
      { threshold, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  if (reduce) {
    const Plain = Tag;
    return (
      <Plain ref={ref} className={`reveal ${className}`.trim()} style={style} {...rest}>
        {children}
      </Plain>
    );
  }

  const MotionTag = motion[Tag] || motion.div;
  return (
    <MotionTag
      ref={ref}
      className={`reveal ${visible ? "revealed" : ""} ${className}`.trim()}
      style={style}
      initial={{ opacity: 0, y: 24 }}
      animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
      transition={{ duration: 0.7, ease: EASE, delay: delay / 1000 }}
      {...rest}
    >
      {children}
    </MotionTag>
  );
}
