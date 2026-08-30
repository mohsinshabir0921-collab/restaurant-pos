import { useEffect, useState } from "react";

// Device capability tiers used to decide how much 3D/motion to render.
// - HIGH:   capable desktop — full cinematic scene, higher DPR.
// - MOBILE: touch/small screens — lighter scene, capped DPR, weaker parallax.
// - LOW:    low-end hardware (few cores / little memory) — CSS-only cinematic,
//           no WebGL canvas.
export const TIERS = { HIGH: "high", MOBILE: "mobile", LOW: "low" };

const isReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const computeDpr = (tier, reduced) => {
  if (reduced) return 1;
  if (tier === TIERS.LOW) return 1;
  if (tier === TIERS.MOBILE) return Math.min(window.devicePixelRatio || 1, 1.4);
  return Math.min(window.devicePixelRatio || 1, 1.75);
};

const detect = () => {
  if (typeof window === "undefined") {
    return { tier: TIERS.HIGH, mobile: false, lowPower: false, reducedMotion: false, dpr: 1 };
  }
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const small = window.innerWidth < 768;
  const mobile = coarse || small;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const lowPower = cores <= 4 && memory <= 4;
  let tier = TIERS.HIGH;
  if (lowPower && mobile) tier = TIERS.LOW;
  else if (mobile) tier = TIERS.MOBILE;
  else if (lowPower) tier = TIERS.LOW;
  const reducedMotion = isReducedMotion();
  return { tier, mobile, lowPower, reducedMotion, dpr: computeDpr(tier, reducedMotion) };
};

export const useDeviceTier = () => {
  const [state, setState] = useState(detect);

  useEffect(() => {
    const mqReduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mqCoarse = window.matchMedia("(pointer: coarse)");
    const onChange = () => setState(detect());
    mqReduced.addEventListener?.("change", onChange);
    mqCoarse.addEventListener?.("change", onChange);
    window.addEventListener("resize", onChange, { passive: true });
    return () => {
      mqReduced.removeEventListener?.("change", onChange);
      mqCoarse.removeEventListener?.("change", onChange);
      window.removeEventListener("resize", onChange);
    };
  }, []);

  return state;
};

export const useReducedMotion = () => {
  const [reduced, setReduced] = useState(isReducedMotion);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
};