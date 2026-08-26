import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useWebsite } from "../context/WebsiteContext";

const ORIGIN = "https://khyennchyenn.co.in";
const BASE = `${ORIGIN}/website`;

const DEFAULT_DESCRIPTION =
  "Order delicious food online for takeaway or delivery. View our menu, order, and pay securely online.";

function setMeta(attribute, key, content) {
  if (!content) return;
  let el = document.head.querySelector(`meta[${attribute}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attribute, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setLink(rel, href) {
  if (!href) return;
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

export default function SeoManager() {
  const location = useLocation();
  const { settings, restaurantName } = useWebsite();
  const name = restaurantName || "Khyenn Chyenn";

  useEffect(() => {
    const pathname = location.pathname || "/";
    const description =
      settings.restaurant_description ||
      settings.restaurant_tagline ||
      DEFAULT_DESCRIPTION;
    const image = settings.about_image
      ? `${ORIGIN}/images/${settings.about_image}`
      : `${ORIGIN}/images/about-restaurant.png`;
    const canonical = pathname === "/" ? BASE : `${BASE}${pathname}`;

    const routeMeta = {
      "/": { title: `${name} | Order Food Online`, description },
      "/menu": {
        title: `Menu | ${name}`,
        description: `Browse the full ${name} menu and order your favourites online for takeaway or delivery.`,
      },
      "/cart": {
        title: `Your Cart | ${name}`,
        description: `Review your ${name} order before checkout.`,
      },
      "/checkout": {
        title: `Checkout | ${name}`,
        description: `Complete your ${name} order and pay securely online.`,
      },
      "/track": {
        title: `Track Your Order | ${name}`,
        description: `Track the live status of your ${name} order.`,
      },
      "/order-confirmation": {
        title: `Order Confirmation | ${name}`,
        description: `Thank you for your order at ${name}.`,
      },
    };

    let meta = routeMeta[pathname];
    if (!meta && pathname.startsWith("/track/")) {
      meta = {
        title: `Track Order | ${name}`,
        description: `Track the live status of your ${name} order.`,
      };
    }
    if (!meta) meta = routeMeta["/"];

    document.title = meta.title;
    setMeta("name", "description", meta.description);
    setLink("canonical", canonical);
    setMeta("property", "og:title", meta.title);
    setMeta("property", "og:description", meta.description);
    setMeta("property", "og:url", canonical);
    setMeta("property", "og:image", image);
    setMeta("name", "twitter:title", meta.title);
    setMeta("name", "twitter:description", meta.description);
    setMeta("name", "twitter:image", image);

    const jsonld = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Restaurant",
          name,
          url: BASE,
          image,
          ...(settings.restaurant_description
            ? { description: settings.restaurant_description }
            : {}),
        },
        {
          "@type": "WebSite",
          name,
          url: BASE,
        },
      ],
    };
    const script = document.getElementById("seo-jsonld");
    if (script) script.textContent = JSON.stringify(jsonld);
  }, [location.pathname, settings, restaurantName, name]);

  return null;
}
