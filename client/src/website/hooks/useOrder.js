import { useState, useCallback, useRef } from "react";
import { websiteAPI } from "../services/api";
import { OUTCOME, decidePaymentOutcome } from "../../lib/paymentOutcome";

const loadCashfreeScript = () =>
  new Promise((resolve, reject) => {
    if (window.Cashfree) {
      resolve(window.Cashfree);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.onload = () => resolve(window.Cashfree);
    script.onerror = () => reject(new Error("Payment gateway could not be loaded. Please try again."));
    document.body.appendChild(script);
  });

export const useOrder = () => {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  const createOrder = useCallback(async (orderData) => {
    setCreating(true);
    setError(null);
    try {
      const response = await websiteAPI.createOrder(orderData);
      return response.data.order;
    } catch (err) {
      const message = err.response?.data?.message || "Failed to create order";
      setError(message);
      throw err;
    } finally {
      setCreating(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { createOrder, creating, error, clearError };
};

export const usePayment = () => {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const openedRef = useRef(false);

  const createCashfreeOrder = useCallback(async (orderId) => {
    setProcessing(true);
    setError(null);
    try {
      const response = await websiteAPI.createCashfreeOrder(orderId);
      return response.data;
    } catch (err) {
      const message = err.response?.data?.message || "Failed to initialise payment";
      setError(message);
      throw err;
    } finally {
      setProcessing(false);
    }
  }, []);

  const verifyCashfreePayment = useCallback(async (data) => {
    setProcessing(true);
    setError(null);
    try {
      const response = await websiteAPI.verifyCashfreePayment(data);
      return response.data.order;
    } catch (err) {
      const message = err.response?.data?.message || "Payment verification failed";
      setError(message);
      throw err;
    } finally {
      setProcessing(false);
    }
  }, []);

  // Opens the Cashfree hosted checkout in a popup modal. The modal's
  // client-side status is NOT authoritative: for UPI the popup often reports
  // CANCELLED / NOT_ATTEMPTED even when the payment was captured (the payment
  // redirects to a UPI app and the popup loses the return context). So this
  // ALWAYS reconciles with the server via verifyCashfreePayment and only then
  // invokes onSuccess / onFailure / onPending based on the server's verdict.
  const openCashfree = useCallback(
    async ({ paymentSessionId, environment, cashfreeOrderId, orderId, onSuccess, onFailure, onPending }) => {
      if (openedRef.current) return;
      openedRef.current = true;
      try {
        const Cashfree = await loadCashfreeScript();
        const cashfree = new Cashfree({
          mode: environment === "production" ? "production" : "sandbox",
        });

        // The payment flow has returned (success, failure, popup closed, or a
        // redirect to a UPI app). Ignore the client-side status and reconcile
        // with the server below.
        let checkoutResult = null;
        try {
          checkoutResult = await cashfree.checkout({
            paymentSessionId,
            orderId: cashfreeOrderId,
            redirectTarget: "_modal",
          });
        } catch (checkoutErr) {
          checkoutResult = checkoutErr;
          console.log("CASHFREE CHECKOUT ERROR:", checkoutErr?.message || checkoutErr);
        }

        try {
          const verifyRes = await websiteAPI.verifyCashfreePayment({
            orderId,
            cashfreeOrderId,
          });
          const outcome = decidePaymentOutcome(verifyRes);
          if (outcome === OUTCOME.PAID) {
            onSuccess?.(verifyRes.data.order);
          } else if (outcome === OUTCOME.FAILED) {
            onFailure?.(verifyRes.data?.message || "Payment could not be completed");
          } else {
            onPending?.(
              "We could not confirm the payment right now. Your order will update automatically when it is verified."
            );
          }
        } catch (verifyErr) {
          console.log("VERIFY PAYMENT ERROR:", verifyErr);
          const outcome = decidePaymentOutcome(verifyErr.response);
          if (outcome === OUTCOME.FAILED) {
            onFailure?.(verifyErr.response?.data?.message || "Payment could not be completed");
          } else {
            const checkoutErrorCode =
              checkoutResult?.error?.code || checkoutResult?.code || "";
            const isUserAborted = checkoutErrorCode === "payment_aborted";
            const msg = verifyErr.response?.data?.message || "";
            if (isUserAborted && msg.includes("Could not confirm")) {
              onFailure?.(msg || "Payment cancelled");
            } else {
              onPending?.(
                "We could not confirm the payment right now. Your order will update automatically when it is verified."
              );
            }
          }
        }
      } catch (err) {
        onFailure?.(err?.message || "Payment could not be completed");
      } finally {
        openedRef.current = false;
      }
    },
    []
  );

  const clearError = useCallback(() => setError(null), []);

  return { createCashfreeOrder, verifyCashfreePayment, openCashfree, processing, error, clearError };
};

// Orchestrates the full order + online payment flow.
export const useCheckout = () => {
  const { createOrder, clearError: clearOrderError } = useOrder();
  const { createCashfreeOrder, openCashfree, processing, clearError: clearPaymentError } = usePayment();
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState(null);

  const placeOrder = useCallback(
    async ({ payload }) => {
      setPlacing(true);
      setError(null);
      try {
        // 1. Create the order (pending for online payment).
        const order = await createOrder(payload);

        // 2. For online payment: create the Cashfree order, open checkout and
        //    let the server-side verification determine the true outcome. The
        //    modal callback status is not trusted.
        if (payload.paymentMethod === "upi") {
          const cf = await createCashfreeOrder(order._id);
          const verified = await new Promise((resolve, reject) => {
            openCashfree({
              paymentSessionId: cf.paymentSessionId,
              environment: cf.environment,
              cashfreeOrderId: cf.cashfreeOrderId,
              orderId: order._id,
              onSuccess: (verifiedOrder) => resolve(verifiedOrder),
              onFailure: (message) => reject(new Error(message || "Payment could not be completed")),
              onPending: (message) => reject(new Error(message)),
            });
          });
          return verified;
        }

        return order;
      } catch (err) {
        const message =
          err?.message && !String(err?.message).startsWith("Request failed")
            ? err.message
            : err?.response?.data?.message || "Could not place your order. Please try again.";
        setError(message);
        throw err;
      } finally {
        setPlacing(false);
      }
    },
    [createOrder, createCashfreeOrder, openCashfree]
  );

  const clearError = useCallback(() => {
    setError(null);
    clearOrderError();
    clearPaymentError();
  }, [clearOrderError, clearPaymentError]);

  return { placeOrder, placing, processing, error, clearError };
};