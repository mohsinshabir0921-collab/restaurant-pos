import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./website.css";
import "./website-extras.css";
import WebsiteApp from "./WebsiteApp.jsx";

createRoot(document.getElementById("root")).render(
  <BrowserRouter basename="/">
    <WebsiteApp />
  </BrowserRouter>
);
