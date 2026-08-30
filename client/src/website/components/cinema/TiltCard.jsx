import { useCallback, useRef } from "react";

// Subtle 3D hover tilt (CSS perspective rotate). rAF-throttled, springs back on
// leave, and stays inert on touch devices / prefers-reduced-motion.
export default function TiltCard({ children, className = "", max = 7, ...rest }) {
  const ref = useRef(null);
  const frame = useRef(null);

  const onMove = useCallback(
    (event) => {
      const el = ref.current;
      if (!el) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const rect = el.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        el.style.transform = `perspective(900px) rotateX(${(-py * max).toFixed(2)}deg) rotateY(${(
          px * max
        ).toFixed(2)}deg) translateZ(0)`;
      });
    },
    [max]
  );

  const onLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (frame.current) cancelAnimationFrame(frame.current);
    el.style.transition = "transform 0.7s cubic-bezier(0.16, 1, 0.3, 1)";
    el.style.transform = "";
    window.setTimeout(() => {
      el.style.transition = "";
    }, 700);
  }, []);

  return (
    <div
      ref={ref}
      className={`tilt-card ${className}`.trim()}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      {...rest}
    >
      {children}
    </div>
  );
}