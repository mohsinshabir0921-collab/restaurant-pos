// Reusable PWA / iOS detection helpers — capability-first, UA fallback only where needed.

export const isIOSDevice = () => {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent || navigator.vendor || '';
  const isiOSUA = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ reports as MacIntel with touch; feature-detect via platform + touch capability
  const isIPadOS = typeof navigator.platform === 'string' && navigator.platform === 'MacIntel' && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
  return isiOSUA || isIPadOS;
};

export const isStandaloneMode = () => {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch {}
  // iOS Safari proprietary
  if (typeof window.navigator !== 'undefined' && window.navigator.standalone === true) return true;
  return false;
};

export const isIOSInstallRequired = () => isIOSDevice() && !isStandaloneMode();
