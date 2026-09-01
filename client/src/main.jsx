import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.jsx";

// Register service worker for POS push notifications (scoped to /pos)
if ('serviceWorker' in navigator && (import.meta.env.PROD || import.meta.env.DEV)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/pos/sw.js', { scope: '/pos/' })
      .then((registration) => {
        console.log('SW registered:', registration);
      })
      .catch((error) => {
        console.log('SW registration failed:', error);
      });
  });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter basename="/pos">
      <App />
    </BrowserRouter>
  </StrictMode>
);