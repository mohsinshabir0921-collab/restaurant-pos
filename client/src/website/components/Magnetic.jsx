import { useRef, useCallback } from "react";

// Subtle magnetic hover: the child gently follows the cursor, then springs
// back. Disabled for touch devices and prefers-reduced-motion (checked in the
// handler so it stays inert).
export default function Magnetic({ children, className = "", strength = 0.35, ...rest }) {
  const ref = useRef(null);
  const frame = useRef(null);

  const onMove = useCallback(
    (event) => {
      const el = ref.current;
      if (!el) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const rect = el.getBoundingClientRect();
      const x = (event.clientX - rect.left - rect.width / 2) * strength;
      const y = (event.clientY - rect.top - rect.height / 2) * strength;
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      });
    },
    [strength]
  );

  const onLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (frame.current) cancelAnimationFrame(frame.current);
    el.style.transition = "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)";
    el.style.transform = "";
    window.setTimeout(() => {
      el.style.transition = "";
    }, 500);
  }, []);

  return (
    <span
      ref={ref}
      className={`magnetic ${className}`.trim()}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      {...rest}
    >
      {children}
    </span>
  );
}