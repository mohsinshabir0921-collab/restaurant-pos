import { Link } from "react-router-dom";
import { useWebsite } from "../context/WebsiteContext";

const DAYS = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
];

const formatTime = (time) => {
  if (!time) return "Closed";
  const [hours, minutes] = String(time).split(":");
  const h = parseInt(hours, 10);
  if (Number.isNaN(h)) return "Closed";
  const suffix = h >= 12 ? "PM" : "AM";
  const displayHour = h % 12 || 12;
  return `${displayHour}:${minutes || "00"} ${suffix}`;
};

const getExternalHttpUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    return null;
  }
  return null;
};

const toDigits = (value) => String(value || "").trim().replace(/\D/g, "");

export default function Footer({ restaurantName }) {
  const { settings, openingHours } = useWebsite();
  const phone = settings.restaurant_phone || "";
  const address = settings.restaurant_address || "";
  const email = settings.restaurant_email || "";
  const whatsappDigits = toDigits(settings.whatsapp_number);
  const instagramUrl = getExternalHttpUrl(settings.instagram_url);
  const whatsappUrl = whatsappDigits ? `https://wa.me/${whatsappDigits}` : null;
  const emailUrl = email ? `mailto:${email}` : null;

  const socials = [
    { name: "Instagram", url: instagramUrl, icon: "instagram" },
    { name: "WhatsApp", url: whatsappUrl, icon: "whatsapp" },
    { name: "Email", url: emailUrl, icon: "email" },
  ].filter((s) => s.url);

  return (
    <footer className="site-footer" role="contentinfo">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link to="/" className="footer-logo" aria-label={`${restaurantName} - Home`}>
              <span className="logo-mark" aria-hidden="true">
                <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" />
                  <path d="M10 16c0-3.314 2.686-6 6-6s6 2.686 6 6-2.686 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M16 10v6l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="logo-text">{restaurantName}</span>
            </Link>
            <p className="footer-tagline">
              {settings.restaurant_description ||
                "Fresh ingredients, time-honoured recipes and food crafted with love. Order online for takeaway or delivery."}
            </p>
            {socials.length > 0 && (
              <div className="footer-socials">
                {socials.map((s) => (
                  <a
                    key={s.name}
                    href={s.url}
                    className="social-link"
                    aria-label={s.name}
                    {...(s.icon === "email" ? {} : { target: "_blank", rel: "noopener noreferrer" })}
                  >
                    {s.icon === "instagram" ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                      </svg>
                    ) : s.icon === "whatsapp" ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                        <path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1zm5 0a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1z" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                      </svg>
                    )}
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="footer-section">
            <h3 className="footer-title">Quick Links</h3>
            <ul className="footer-links">
              <li><Link to="/menu">Our Menu</Link></li>
              <li><Link to="/cart">Your Cart</Link></li>
              <li><Link to="/checkout">Checkout</Link></li>
              <li><Link to="/menu">Order Takeaway</Link></li>
              <li><Link to="/menu">Order Delivery</Link></li>
            </ul>
          </div>

          <div className="footer-section">
            <h3 className="footer-title">Contact Us</h3>
            <address className="footer-address">
              {address && (
                <p className="footer-contact-row">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span>{address}</span>
                </p>
              )}
              {phone && (
                <p className="footer-contact-row">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                  <a href={`tel:${phone.replace(/\s+/g, "")}`}>{phone}</a>
                </p>
              )}
            </address>
          </div>

          <div className="footer-section">
            <h3 className="footer-title">Opening Hours</h3>
            <dl className="opening-hours">
              {DAYS.map((day) => {
                const hours = openingHours[day.key];
                const isClosed = !hours || !hours.open || !hours.close;
                const isToday =
                  new Date()
                    .toLocaleDateString("en-US", { weekday: "short" })
                    .toLowerCase() === day.key.slice(0, 3);
                return (
                  <div key={day.key} className={`hours-row ${isToday ? "today" : ""}`}>
                    <dt>{isToday ? "Today" : day.label}</dt>
                    <dd>{isClosed ? "Closed" : `${formatTime(hours.open)} – ${formatTime(hours.close)}`}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </div>

        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} {restaurantName}. All rights reserved.</p>
          <p className="footer-note">Ordering by Takeaway &amp; Delivery</p>
        </div>
      </div>
    </footer>
  );
}