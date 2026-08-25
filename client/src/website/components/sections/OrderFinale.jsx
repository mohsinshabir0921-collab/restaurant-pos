import { Link } from "react-router-dom";
import Reveal from "../Reveal";
import Magnetic from "../Magnetic";

export default function OrderFinale() {
  return (
    <section className="hp-finale">
      <div className="container">
        <Reveal className="hp-finale-box">
          <p className="hp-finale-eyebrow">Before You Order</p>
          <h2 className="hp-finale-title">
            You&rsquo;re already <em>hungry.</em>
          </h2>
          <p className="hp-finale-sub">Order online for takeaway or doorstep delivery.</p>
          <div className="hp-finale-actions">
            <Magnetic>
              <Link to="/menu" className="btn btn-light btn-lg">
                Start Your Order
              </Link>
            </Magnetic>
            <Magnetic>
              <Link to="/checkout" className="btn btn-outline-light btn-lg">
                Checkout
              </Link>
            </Magnetic>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
