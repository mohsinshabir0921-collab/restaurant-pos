import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

// Scroll-linked parallax wrapper. The child drifts vertically as it crosses the
// viewport, producing depth without any JS layout work (GPU transform only).
// Completely inert under prefers-reduced-motion.
export default function CineParallax({ children, speed = 0.16, className = "", ...rest }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const tween = gsap.fromTo(
        el,
        { yPercent: -speed * 100 },
        {
          yPercent: speed * 100,
          ease: "none",
          scrollTrigger: {
            trigger: el.parentElement || el,
            start: "top bottom",
            end: "bottom top",
            scrub: 1.1,
          },
        }
      );
      return () => tween.scrollTrigger?.kill();
    });
    return () => mm.revert();
  }, [speed]);

  return (
    <div ref={ref} className={`cine-parallax ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}