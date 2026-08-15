import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "./website.css";
import "./website-extras.css";
import WebsiteApp from "./WebsiteApp.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <HashRouter>
      <WebsiteApp />
    </HashRouter>
  </StrictMode>
);
