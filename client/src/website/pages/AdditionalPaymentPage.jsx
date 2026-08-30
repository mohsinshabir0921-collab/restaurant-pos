import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { websiteAPI } from "../services/api";
import { usePayment } from "../hooks/useOrder";
import { useWebsite } from "../context/WebsiteContext";
import { formatPrice } from "../components/common";

// Fronts the shareable additional-payment link (/pay/:token). The token only
// identifies the order server-side; the payable amount always comes from the
// server's order.additionalAmountDue (never shown as editable, never read from
// the client). This is an additional payment for an existing order - it is
// never presented as a new order.
export default function AdditionalPaymentPage() {
  const { token } = useParams();
  const { settings } = useWebsite();
  const { openAdditionalCashfreeByToken } = usePayment();

  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [payState, setPayState] = useState("idle"); // idle | processing | success | error
  const [payMessage, setPayMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await websiteAPI.getAdditionalPaymentLink(token);
        if (cancelled) return;
        if (!res.data?.success) {
          setError(res.data?.message || "This payment link is not valid.");
          return;
        }
        setInfo({ orderNumber: res.data.orderNumber, amount: Number(res.data.amount) || 0 });
      } catch (err) {
        if (cancelled) return;
        const status = err.response?.status;
        const message =
          status === 404
            ? "This payment link is invalid or has expired."
            : err.response?.data?.message || "We could not load this payment link. Please try again.";
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handlePay = async () => {
    if (!info || payState === "processing") return;
    setPayState("processing");
    setPayMessage("");
    try {
      const res = await websiteAPI.createAdditionalCashfreeOrderByToken(token);
      if (!res.data?.success) {
        setPayState("error");
        setPayMessage(res.data?.message || "Could not start the payment");
        return;
      }

      await new Promise((resolve) => {
        openAdditionalCashfreeByToken({
          token,
          paymentSessionId: res.data.paymentSessionId,
          environment: res.data.environment,
          cashfreeOrderId: res.data.cashfreeOrderId,
          onSuccess: () => {
            setPayState("success");
            setPayMessage("Payment received. Your additional amount is settled.");
            resolve();
          },
          onFailure: (message) => {
            setPayState("error");
            setPayMessage(message || "Payment could not be completed");
            resolve();
          },
          onPending: (message) => {
            setPayState("error");
            setPayMessage(message || "We could not confirm the payment right now. Your order will update automatically when it is verified.");
            resolve();
          },
        });
      });
    } catch (err) {
      setPayState("error");
      setPayMessage(err?.response?.data?.message || "Could not start the payment");
    }
  };

  return (
    <div className="track-page">
      <div className="track-card">
        <h1 className="track-title">Complete Payment</h1>

        {loading && <p className="field-hint">Loading payment details…</p>}

        {!loading && error && (
          <>
            <p className="track-error">{error}</p>
            <div className="track-actions">
              <Link className="btn btn-ghost" to="/">
                Back to home
              </Link>
            </div>
          </>
        )}

        {!loading && !error && info && (
          <>
            <p className="field-hint">
              Additional payment for Order #{info.orderNumber}
            </p>
            <div className="track-additional-pay">
              <div className="track-additional-info">
                <span className="track-label">Amount due</span>
                <strong className="track-additional-amount">{formatPrice(info.amount)}</strong>
              </div>

              {payState === "success" ? (
                <p className="track-additional-success">{payMessage}</p>
              ) : (
                <>
                  <button
                    className="btn btn-primary"
                    onClick={handlePay}
                    disabled={payState === "processing"}
                  >
                    {payState === "processing" ? "Processing…" : "Pay Additional Amount"}
                  </button>
                  {payState === "error" && <p className="track-error">{payMessage}</p>}
                </>
              )}
            </div>

            <p className="field-hint">
              This is an additional payment for your existing order at{" "}
              {settings.restaurant_name || "our restaurant"}. The amount below is fixed and
              cannot be changed.
            </p>

            <div className="track-actions">
              <Link className="btn btn-ghost" to="/">
                Back to home
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}