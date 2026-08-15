import { Link } from "react-router-dom";
import Reveal from "../components/Reveal";

export default function NotFoundPage() {
  return (
    <div className="page-container">
      <div className="container">
        <Reveal className="empty-state not-found">
          <span className="not-found-code" aria-hidden="true">404</span>
          <h1>Page not found</h1>
          <p>The page you're looking for doesn't exist or has been moved.</p>
          <Link to="/" className="btn btn-primary">
            Back to Home
          </Link>
        </Reveal>
      </div>
    </div>
  );
}