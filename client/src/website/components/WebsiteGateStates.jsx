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
