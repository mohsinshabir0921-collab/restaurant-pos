export default function SectionHeading({ eyebrow, title, note, align = "left", className = "" }) {
  return (
    <div className={`hp-head hp-head--${align} ${className}`.trim()}>
      {eyebrow && <p className="section-eyebrow">{eyebrow}</p>}
      {title && <h2 className="section-title">{title}</h2>}
      {note && <p className="hp-head-note">{note}</p>}
    </div>
  );
}
