import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

// Cinematic scroll reveal: elements rise in with a soft blur+opacity once they
// enter the viewport. GPU-friendly (transform/opacity) and fully disabled under
// prefers-reduced-motion (elements stay visible/static).
export default function CineReveal({
  as: Tag = "div",
  children,
  className = "",
  delay = 0,
  y = 48,
  duration = 1.15,
  ...rest
}) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const tween = gsap.fromTo(
        el,
        { opacity: 0, y, filter: "blur(8px)" },
        {
          opacity: 1,
          y: 0,
          filter: "blur(0px)",
          duration,
          delay,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 88%", once: true },
        }
      );
      return () => tween.scrollTrigger?.kill();
    });
    return () => mm.revert();
  }, [delay, y, duration]);

  return (
    <Tag ref={ref} className={`cine-reveal ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}