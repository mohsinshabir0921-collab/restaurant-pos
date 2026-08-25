import Reveal from "../Reveal";
import { GALLERY } from "../common";

export default function EditorialGallery() {
  return (
    <section className="hp-gallery">
      <div className="container">
        <Reveal className="hp-gallery-head">
          <p className="section-eyebrow">A Look Around</p>
          <h2 className="section-title">Made to be remembered.</h2>
          <p className="hp-gallery-note">Shot on a phone. Tastes better in person.</p>
        </Reveal>

        <div className="hp-gallery-grid">
          {GALLERY.map((photo, index) => (
            <Reveal
              key={photo.src}
              className={`hp-gallery-item hp-gallery-item--${photo.size}`}
              delay={(index % 3) * 80}
            >
              <figure className="hp-gallery-figure">
                <img className="hp-gallery-img" src={photo.src} alt={photo.alt} loading="lazy" />
                <figcaption className="hp-gallery-cap">{photo.alt}</figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
