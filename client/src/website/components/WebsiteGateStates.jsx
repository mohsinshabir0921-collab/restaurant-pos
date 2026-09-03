import { useEffect, useState } from "react";

// Lightweight shell shown while /api/settings/public is in-flight.
// No business defaults are invented; it is purely visual.
export function WebsiteLoadingShell({ slow }) {
  return (
    <div className="website-layout theme-dark" aria-busy="true" aria-live="polite">
      {/* Header skeleton */}
      <div
        className="site-header"
        style={{ opacity: 0.6, pointerEvents: "none" }}
        aria-hidden="true"
      >
        <div className="header-inner container" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0" }}>
          <div style={{ width: 140, height: 28, borderRadius: 6, background: "rgba(244,230,210,0.14)" }} />
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 72, height: 22, borderRadius: 999, background: "rgba(244,230,210,0.10)" }} />
            <div style={{ width: 96, height: 22, borderRadius: 999, background: "rgba(244,230,210,0.10)" }} />
          </div>
        </div>
      </div>

      <main className="main-content">
        {/* Hero skeleton */}
        <div
          className="hp-hero"
          style={{ minHeight: "52vh", display: "flex", alignItems: "center", padding: "48px 0" }}
          aria-hidden="true"
        >
          <div className="container hp-hero-content" style={{ width: "100%" }}>
            <div style={{ width: 180, height: 12, borderRadius: 999, background: "rgba(244,230,210,0.14)", marginBottom: 16 }} />
            <div style={{ width: "min(520px, 90%)", height: 42, borderRadius: 8, background: "rgba(244,230,210,0.12)", marginBottom: 12 }} />
            <div style={{ width: "min(420px, 80%)", height: 42, borderRadius: 8, background: "rgba(244,230,210,0.08)", marginBottom: 20 }} />
            <div style={{ width: 260, height: 14, borderRadius: 6, background: "rgba(244,230,210,0.10)", marginBottom: 24 }} />
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ width: 132, height: 44, borderRadius: 999, background: "rgba(244,230,210,0.14)" }} />
              <div style={{ width: 132, height: 44, borderRadius: 999, background: "rgba(244,230,210,0.08)", border: "1px solid rgba(244,230,210,0.12)" }} />
            </div>
          </div>
        </div>

        {/* Centered status */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            padding: "28px 16px 48px",
            textAlign: "center",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              border: "2px solid rgba(244,230,210,0.22)",
              borderTopColor: "rgba(244,230,210,0.85)",
              animation: "spin 0.9s linear infinite",
            }}
          />
          <div style={{ color: "#f4e6d2", fontFamily: "var(--font-display, serif)", fontSize: "0.95rem", opacity: 0.92 }}>
            {slow ? "Waking things up… This may take a moment." : "Loading…"}
          </div>
          {slow && (
            <div style={{ color: "rgba(244,230,210,0.72)", fontSize: "0.85rem", maxWidth: 420 }}>
              The server may be waking up. Thanks for waiting.
            </div>
          )}
        </div>
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

export function WebsiteErrorState({ error, onRetry }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#3f0d0a",
        color: "#f4e6d2",
        padding: 24,
      }}
      role="alert"
      aria-live="assertive"
    >
      <div style={{ textAlign: "center", maxWidth: 520, width: "100%" }}>
        <h1 style={{ fontFamily: "var(--font-display, serif)", marginBottom: 10, fontSize: "1.4rem" }}>
          Couldn’t load the website
        </h1>
        <p style={{ opacity: 0.88, lineHeight: 1.5, marginBottom: 12 }}>
          We couldn’t load restaurant settings. This can happen when the server is waking up or your connection is slow.
        </p>
        {error && (
          <p style={{ opacity: 0.7, fontSize: "0.85rem", marginBottom: 16, wordBreak: "break-word" }}>
            {String(error)}
          </p>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-light" onClick={onRetry}>
            Retry
          </button>
          <a href="/" className="btn btn-outline-light" onClick={(e) => { e.preventDefault(); window.location.reload(); }}>
            Reload page
          </a>
        </div>
        <p style={{ opacity: 0.6, fontSize: "0.8rem", marginTop: 14 }}>
          If this keeps happening, please check your connection and try again.
        </p>
      </div>
    </div>
  );
}

export function WebsiteDisabledState({ restaurantName, onRetry, contactUrl }) {
  return (
    <div
      className="website-disabled"
      style={{
        minHeight: "100vh",
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#3f0d0a",
        color: "#f4e6d2",
        overflow: "hidden",
        isolation: "isolate",
        padding: "32px 20px",
      }}
    >
      {/* Atmospheric vignette + subtle warm glow */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(120% 90% at 50% 38%, rgba(201,178,132,0.08) 0%, transparent 55%), radial-gradient(140% 110% at 50% 100%, rgba(0,0,0,0.55) 0%, transparent 62%), linear-gradient(180deg, rgba(26,8,8,0.0) 0%, rgba(18,6,6,0.55) 100%)",
          pointerEvents: "none",
        }}
      />
      {/* Himalayan layered silhouettes — ultra subtle */}
      <svg
        aria-hidden="true"
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          width: "100%",
          height: "38%",
          opacity: 0.09,
          pointerEvents: "none",
        }}
      >
        <path d="M0 210 L180 90 L320 170 L480 60 L640 140 L760 40 L900 110 L1080 20 L1220 90 L1440 70 L1440 320 L0 320 Z" fill="#1a0808" />
        <path d="M0 250 L220 160 L380 220 L520 140 L680 200 L840 120 L980 180 L1120 110 L1280 160 L1440 130 L1440 320 L0 320 Z" fill="#0f0404" opacity="0.7" />
      </svg>
      {/* Soft gold horizon line */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "50%",
          bottom: "38%",
          width: "min(720px, 88%)",
          height: 1,
          transform: "translateX(-50%)",
          background: "linear-gradient(90deg, transparent, rgba(201,178,132,0.28), transparent)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 560,
          textAlign: "center",
          padding: "clamp(32px, 6vw, 56px) clamp(20px, 4vw, 40px)",
        }}
      >
        {/* Brand mark — reuse existing circular mark */}
        <div
          aria-hidden="true"
          style={{
            width: 44,
            height: 44,
            margin: "0 auto 18px",
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            border: "1px solid rgba(201,178,132,0.32)",
            background: "rgba(255,255,255,0.06)",
            color: "var(--champagne, #c9b284)",
          }}
        >
          <svg viewBox="0 0 32 32" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="16" cy="16" r="13.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M10.5 16c0-3.03 2.46-5.5 5.5-5.5s5.5 2.47 5.5 5.5-2.46 5.5-5.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M16 11v5l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(1.35rem, 3.5vw, 1.75rem)",
            fontWeight: 600,
            letterSpacing: "0.04em",
            color: "#fff8e7",
            lineHeight: 1.15,
            textWrap: "balance",
          }}
        >
          {restaurantName || "Khyenn Chyenn"}
        </div>

        <div
          aria-hidden="true"
          style={{
            width: 56,
            height: 1,
            margin: "14px auto 22px",
            background: "linear-gradient(90deg, transparent, #c9b284, transparent)",
            opacity: 0.9,
          }}
        />

        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(1.9rem, 5.2vw, 2.65rem)",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1.08,
            color: "#fffaf0",
            margin: "0 0 14px",
            textWrap: "balance",
          }}
        >
          Online Ordering is Unavailable
        </h1>

        <p
          style={{
            fontFamily: "var(--font)",
            fontSize: "clamp(0.95rem, 2.2vw, 1.02rem)",
            lineHeight: 1.65,
            color: "rgba(244,230,210,0.82)",
            maxWidth: 420,
            margin: "0 auto 28px",
          }}
        >
          We’re currently not accepting online orders.
          <br />
          Please check back later or contact us directly.
        </p>

        {/* Minimal closed-store illustration — subtle, gold + cream on burgundy */}
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            justifyContent: "center",
            margin: "0 auto 28px",
            opacity: 0.92,
          }}
        >
          <svg viewBox="0 0 120 78" width="118" height="76" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}>
            {/* Awning */}
            <path d="M18 22 L22 12 L98 12 L102 22 Z" fill="none" stroke="#c9b284" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M22 22 L28 12 L36 22 Z" fill="rgba(201,178,132,0.18)" stroke="#c9b284" strokeWidth="1" />
            <path d="M36 22 L44 12 L52 22 Z" fill="none" stroke="#c9b284" strokeWidth="1" />
            <path d="M52 22 L60 12 L68 22 Z" fill="rgba(201,178,132,0.12)" stroke="#c9b284" strokeWidth="1" />
            <path d="M68 22 L76 12 L84 22 Z" fill="none" stroke="#c9b284" strokeWidth="1" />
            <path d="M84 22 L92 12 L98 22 Z" fill="rgba(201,178,132,0.14)" stroke="#c9b284" strokeWidth="1" />
            {/* Facade */}
            <rect x="24" y="22" width="72" height="38" rx="2.5" fill="none" stroke="rgba(244,230,210,0.22)" strokeWidth="1.2" />
            <rect x="24" y="22" width="72" height="38" rx="2.5" fill="rgba(255,248,231,0.03)" />
            {/* Door */}
            <rect x="48" y="32" width="24" height="28" rx="1.2" fill="none" stroke="#c9b284" strokeWidth="1.25" />
            <circle cx="67" cy="46" r="1.4" fill="#c9b284" />
            {/* Closed diagonal */}
            <path d="M48 32 L72 60" stroke="rgba(244,230,210,0.55)" strokeWidth="1" strokeLinecap="round" />
            <path d="M72 32 L48 60" stroke="rgba(244,230,210,0.55)" strokeWidth="1" strokeLinecap="round" />
            {/* Sign */}
            <rect x="54" y="38" width="12" height="7" rx="1" fill="#1a0808" stroke="#c9b284" strokeWidth="0.9" />
            <path d="M57 41.5 H63" stroke="#c9b284" strokeWidth="0.7" strokeLinecap="round" />
            {/* Base line */}
            <path d="M14 60 H106" stroke="rgba(201,178,132,0.32)" strokeWidth="1" strokeLinecap="round" />
            {/* Side windows hint */}
            <rect x="28" y="36" width="14" height="14" rx="1" fill="none" stroke="rgba(244,230,210,0.18)" strokeWidth="0.9" />
            <rect x="78" y="36" width="14" height="14" rx="1" fill="none" stroke="rgba(244,230,210,0.18)" strokeWidth="0.9" />
          </svg>
        </div>

        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          {contactUrl ? (
            <a
              href={contactUrl}
              className="btn btn-light"
              style={{ minWidth: 148, boxShadow: "0 8px 24px rgba(0,0,0,0.22)" }}
              target={contactUrl.startsWith("http") ? "_blank" : undefined}
              rel={contactUrl.startsWith("http") ? "noopener noreferrer" : undefined}
            >
              Contact Us
            </a>
          ) : null}
          <button
            type="button"
            className={contactUrl ? "btn btn-outline-light" : "btn btn-light"}
            onClick={() => {
              if (onRetry) onRetry();
              // Fallback hard reload if settings fetch does not re-enable quickly
              setTimeout(() => {
                try {
                  if (document.visibilityState === "visible") window.location.reload();
                } catch {}
              }, 300);
            }}
            style={{ minWidth: 148 }}
          >
            Try Again Later
          </button>
        </div>

        <p style={{ marginTop: 18, fontSize: "0.78rem", color: "rgba(244,230,210,0.58)", letterSpacing: "0.02em" }}>
          Thank you for your patience.
        </p>
      </div>

      <style>{`@media (prefers-reduced-motion: reduce) { .website-disabled * { animation: none !important; transition: none !important; } }`}</style>
    </div>
  );
}
