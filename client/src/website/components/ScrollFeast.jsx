import { useEffect, useRef } from "react";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, t) => from + (to - from) * t;
// Smoothstep — eases the assembled<->exploded transition so it feels intentional.
const ease = (t) => t * t * (3 - 2 * t);

// A burger, built from SIX separate, cleanly drawn components. Each layer is its
// own SVG group aligned to the same central axis (x = 200). At rest (progress 0)
// they stack into one complete burger; as the user scrolls they separate
// vertically into a controlled exploded view and reassemble on scroll-back.
// No rotation, no sideways drift, no scattering, no particles, no blur.
const G = 46; // vertical spread per step when exploded
const LAYERS = [
  { key: "bun-top", offset: -2.5 * G },
  { key: "lettuce", offset: -1.5 * G },
  { key: "tomato", offset: -0.5 * G },
  { key: "cheese", offset: 0.5 * G },
  { key: "patty", offset: 1.5 * G },
  { key: "bun-bottom", offset: 2.5 * G },
];

const SESAME = [
  [162, 190, -16],
  [196, 181, -6],
  [230, 190, 14],
  [178, 204, 4],
  [218, 204, -6],
  [150, 214, 10],
  [250, 214, -12],
  [200, 198, 0],
];

export default function ScrollFeast() {
  const sectionRef = useRef(null);
  const progressRef = useRef(null);
  const layerRefs = useRef([]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const apply = (p) => {
      const e = ease(p);
      for (let i = 0; i < LAYERS.length; i += 1) {
        const el = layerRefs.current[i];
        if (el) {
          el.setAttribute(
            "transform",
            `translate(0 ${LAYERS[i].offset * e})`
          );
        }
      }
      if (progressRef.current) {
        progressRef.current.style.transform = `scaleX(${p})`;
      }
    };

    if (reduced) {
      apply(0);
      if (progressRef.current) {
        progressRef.current.style.transform = "scaleX(1)";
      }
      return undefined;
    }

    let rafId = 0;
    let active = false;
    let running = false;
    const current = { value: 0 };

    const computeTarget = () => {
      const rect = section.getBoundingClientRect();
      const total = section.offsetHeight - window.innerHeight;
      const scrolled = clamp(-rect.top, 0, total);
      return total > 0 ? scrolled / total : 0;
    };

    const tick = () => {
      const target = computeTarget();
      const cur = current.value;
      const next =
        Math.abs(target - cur) < 0.0004 ? target : lerp(cur, target, 0.14);
      if (Math.abs(next - cur) > 0.00001) {
        current.value = next;
        apply(next);
      }
      if (active) {
        rafId = requestAnimationFrame(tick);
      } else {
        running = false;
      }
    };

    const startLoop = () => {
      if (running) return;
      running = true;
      rafId = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          active = entry.isIntersecting;
          if (active) startLoop();
        }
      },
      { threshold: 0 }
    );
    io.observe(section);

    current.value = computeTarget();
    apply(current.value);

    return () => {
      io.disconnect();
      cancelAnimationFrame(rafId);
      running = false;
    };
  }, []);

  return (
    <section
      className="scroll-feast"
      ref={sectionRef}
      aria-label="The making of a craving"
    >
      <div className="scroll-feast-sticky">
        <div className="scroll-feast-bg" aria-hidden="true" />
        <div className="scroll-feast-stage" aria-hidden="true">
          <div className="scroll-feast-dish">
            <svg
              className="scroll-feast-svg"
              viewBox="0 0 400 600"
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label="A burger separating into its layers and reassembling as you scroll"
            >
              <defs>
                <linearGradient id="sf-bun-top" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#f4b85e" />
                  <stop offset="1" stopColor="#db8c2c" />
                </linearGradient>
                <linearGradient id="sf-bun-bottom" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#e7a23f" />
                  <stop offset="1" stopColor="#c97a22" />
                </linearGradient>
                <linearGradient id="sf-lettuce" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#9ccc4f" />
                  <stop offset="1" stopColor="#5d9e2c" />
                </linearGradient>
                <linearGradient id="sf-tomato" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#ff6454" />
                  <stop offset="1" stopColor="#e23a2c" />
                </linearGradient>
                <linearGradient id="sf-cheese" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#ffd75a" />
                  <stop offset="1" stopColor="#f3ad12" />
                </linearGradient>
                <linearGradient id="sf-patty" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#7a4626" />
                  <stop offset="1" stopColor="#46260f" />
                </linearGradient>
                <filter id="sf-soft" x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow
                    dx="0"
                    dy="7"
                    stdDeviation="7"
                    floodColor="#000000"
                    floodOpacity="0.32"
                  />
                </filter>
              </defs>

              {/* TOP BUN */}
              <g ref={(el) => (layerRefs.current[0] = el)} filter="url(#sf-soft)">
                <path
                  d="M80,245 C80,173 132,156 200,156 C268,156 320,173 320,245 Z"
                  fill="url(#sf-bun-top)"
                />
                <path
                  d="M80,245 C80,173 132,156 200,156 C268,156 320,173 320,245 Z"
                  fill="#ffffff"
                  opacity="0.08"
                />
                {SESAME.map(([cx, cy, rot], i) => (
                  <ellipse
                    key={i}
                    cx={cx}
                    cy={cy}
                    rx="6"
                    ry="3.4"
                    fill="#fbeccd"
                    transform={`rotate(${rot} ${cx} ${cy})`}
                  />
                ))}
              </g>

              {/* LETTUCE */}
              <g ref={(el) => (layerRefs.current[1] = el)} filter="url(#sf-soft)">
                <path
                  d="M70,251 Q86,244 102,251 Q118,258 134,251 Q150,244 166,251 Q182,258 198,251 Q214,244 230,251 Q246,258 262,251 Q278,244 294,251 Q310,258 330,251 L330,277 Q314,288 298,277 Q282,288 266,277 Q250,288 234,277 Q218,288 202,277 Q186,288 170,277 Q154,288 138,277 Q122,288 106,277 Q90,288 70,277 Z"
                  fill="url(#sf-lettuce)"
                />
              </g>

              {/* TOMATO */}
              <g ref={(el) => (layerRefs.current[2] = el)} filter="url(#sf-soft)">
                <ellipse cx="200" cy="290" rx="112" ry="14" fill="url(#sf-tomato)" />
                <ellipse cx="200" cy="290" rx="92" ry="9" fill="#ff8273" opacity="0.55" />
                <g fill="#ffe1a8" opacity="0.85">
                  <ellipse cx="170" cy="288" rx="3" ry="2" />
                  <ellipse cx="200" cy="284" rx="3" ry="2" />
                  <ellipse cx="230" cy="288" rx="3" ry="2" />
                  <ellipse cx="185" cy="294" rx="2.4" ry="1.6" />
                  <ellipse cx="215" cy="294" rx="2.4" ry="1.6" />
                </g>
              </g>

              {/* CHEESE */}
              <g ref={(el) => (layerRefs.current[3] = el)} filter="url(#sf-soft)">
                <path
                  d="M72,300 H328 V314 Q328,320 322,320 H302 L294,338 Q290,342 286,320 H114 Q110,342 106,320 H78 Q72,320 72,314 Z"
                  fill="url(#sf-cheese)"
                />
              </g>

              {/* PATTY */}
              <g ref={(el) => (layerRefs.current[4] = el)} filter="url(#sf-soft)">
                <path
                  d="M84,320 H316 Q326,320 326,332 V346 Q326,367 305,367 H95 Q74,367 74,346 V332 Q74,320 84,320 Z"
                  fill="url(#sf-patty)"
                />
                <g
                  stroke="#321a0c"
                  strokeWidth="3"
                  strokeLinecap="round"
                  opacity="0.45"
                  fill="none"
                >
                  <path d="M118,336 H282" />
                  <path d="M132,348 H268" />
                  <path d="M150,358 H250" />
                </g>
              </g>

              {/* BOTTOM BUN */}
              <g ref={(el) => (layerRefs.current[5] = el)} filter="url(#sf-soft)">
                <path
                  d="M80,364 H320 V408 Q320,436 294,436 H106 Q80,436 80,408 Z"
                  fill="url(#sf-bun-bottom)"
                />
                <path
                  d="M80,364 H320 V372 Q200,380 80,372 Z"
                  fill="#ffffff"
                  opacity="0.08"
                />
              </g>
            </svg>
          </div>
        </div>
        <div className="scroll-feast-copy">
          <p className="scroll-feast-eyebrow">The Making of a Craving</p>
        </div>
        <div className="scroll-feast-foot">
          <div className="scroll-feast-progress" aria-hidden="true">
            <span className="scroll-feast-progress-fill" ref={progressRef} />
          </div>
        </div>
      </div>
    </section>
  );
}
