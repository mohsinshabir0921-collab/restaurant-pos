import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useBanners } from "../hooks/useBanners";

const setAnnounceHeight = () => {
  const el = document.querySelector(".announcement-bar");
  const height = el ? el.offsetHeight : 0;
  document.documentElement.style.setProperty("--announce-h", `${height}px`);
};

export default function AnnouncementBar() {
  const { banners } = useBanners();
  const navigate = useNavigate();
  const barRef = useRef(null);

  // The bar is fixed above the (also fixed) site header, so its real height is
  // published as --announce-h and the header + content shift down accordingly.
  useEffect(() => {
    setAnnounceHeight();
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(setAnnounceHeight);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [banners.length]);

  if (!banners.length) return null;

  const handleClick = (banner) => {
    if (banner.couponCode) {
      navigate(`/checkout?coupon=${encodeURIComponent(banner.couponCode)}`);
    } else if (banner.ctaLink) {
      if (banner.ctaLink.startsWith("/")) {
        navigate(banner.ctaLink);
      } else {
        window.open(banner.ctaLink, "_blank", "noopener,noreferrer");
      }
    }
  };

  return (
    <div className="announcement-bar" ref={barRef} role="region" aria-label="Offers and promotions">
      <div className="container announcement-bar-inner">
        {banners.map((banner) => {
          const interactive = Boolean(banner.couponCode || banner.ctaLink);
          const content = (
            <>
              <span className="announcement-title">{banner.title}</span>
              {banner.description && <span className="announcement-desc">{banner.description}</span>}
              {banner.couponCode && <span className="announcement-code">{banner.couponCode}</span>}
              {banner.ctaText && <span className="announcement-cta">{banner.ctaText}</span>}
            </>
          );
          return interactive ? (
            <button
              key={banner._id}
              type="button"
              className="announcement-item"
              onClick={() => handleClick(banner)}
            >
              {content}
            </button>
          ) : (
            <div key={banner._id} className="announcement-item">
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}