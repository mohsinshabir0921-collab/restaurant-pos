import Reveal from "../Reveal";

export default function BrandEthos({ description, totalItems, daysOpen, orderNote }) {
  const statement =
    description && description.trim()
      ? description
      : "A family-run kitchen serving fresh, flavourful food made from quality ingredients — cooked to order, never compromised.";

  const stats = [
    { num: String(totalItems || "—"), label: "Dishes on the menu" },
    { num: String(daysOpen || "—"), label: "Days open each week" },
    { num: orderNote || "—", label: "Ordering, your way" },
  ];

  return (
    <section className="hp-ethos">
      <div className="container hp-ethos-inner">
        <Reveal className="hp-ethos-statement-wrap">
          <p className="hp-ethos-eyebrow">The Kitchen</p>
          <p className="hp-ethos-statement">{statement}</p>
        </Reveal>
        <Reveal className="hp-ethos-stats" as="ul" delay={120}>
          {stats.map((stat) => (
            <li key={stat.label} className="hp-ethos-stat">
              <span className="hp-stat-num">{stat.num}</span>
              <span className="hp-stat-label">{stat.label}</span>
            </li>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
