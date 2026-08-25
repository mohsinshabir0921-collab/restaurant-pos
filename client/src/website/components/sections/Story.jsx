import { Link } from "react-router-dom";
import Reveal from "../Reveal";

export default function Story({ restaurantName, aboutContent, aboutImgSrc, totalItems, daysOpen, orderNote }) {
  const body =
    aboutContent && aboutContent.trim()
      ? aboutContent
      : "We are a family-run kitchen serving fresh, flavourful food made from quality ingredients.";

  const meta = [
    { label: "Dishes", value: String(totalItems || "—") },
    { label: "Open", value: `${daysOpen || "—"} days` },
    { label: "Order", value: orderNote || "—" },
  ];

  return (
    <section className="hp-story">
      <div className="container hp-story-grid">
        <Reveal className="hp-story-media">
          <figure className="hp-story-figure">
            <img className="hp-story-img" src={aboutImgSrc} alt={`Inside ${restaurantName}`} loading="lazy" />
            <figcaption className="hp-story-cap">Inside {restaurantName}</figcaption>
          </figure>
        </Reveal>

        <Reveal className="hp-story-body" delay={120}>
          <p className="hp-story-eyebrow">About</p>
          <h2 className="hp-story-title">{restaurantName}</h2>
          <p className="hp-story-text">{body}</p>
          <Link to="/menu" className="hp-story-link">
            Order from the Kitchen
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </Link>
          <dl className="hp-story-meta">
            {meta.map((row) => (
              <div key={row.label} className="hp-story-meta-row">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </section>
  );
}
