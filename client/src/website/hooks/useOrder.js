import { useState, useCallback, useRef } from "react";
import { websiteAPI } from "../services/api";

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

  // Opens the Cashfree hosted checkout in a popup modal (preserving the old
  // modal checkout UX). Resolves only through onSuccess / onDismiss so the
  // caller can decide how to surface cancelled/failed payments.
  const openCashfree = useCallback(
    async ({ paymentSessionId, environment, cashfreeOrderId, onSuccess, onDismiss }) => {
      if (openedRef.current) return;
      openedRef.current = true;
      try {
        const Cashfree = await loadCashfreeScript();
        const cashfree = new Cashfree({
          mode: environment === "production" ? "production" : "sandbox",
        });
        const result = await cashfree.checkout({
          paymentSessionId,
          orderId: cashfreeOrderId,
          redirectTarget: "_modal",
        });
        openedRef.current = false;

        const status = result?.paymentDetails?.paymentStatus;
        if (status === "SUCCESS") {
          onSuccess?.({
            cashfreeOrderId: result.orderId || cashfreeOrderId,
            paymentStatus: status,
          });
        } else {
          onDismiss?.(
            result?.paymentDetails?.paymentMessage ||
              (status === "CANCELLED" ? "Payment was cancelled" : "Payment failed")
          );
        }
      } catch (err) {
        openedRef.current = false;
        onDismiss?.(err?.message || "Payment was cancelled");
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
  const { createCashfreeOrder, verifyCashfreePayment, openCashfree, processing, clearError: clearPaymentError } = usePayment();
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState(null);

  const placeOrder = useCallback(
    async ({ payload, prefill, restaurantName }) => {
      setPlacing(true);
      setError(null);
      try {
        // 1. Create the order (pending for online payment).
        const order = await createOrder(payload);

        // 2. For online payment: create the Cashfree order, open checkout and
        //    only trust the server-side verification result.
        if (payload.paymentMethod === "upi") {
          const cf = await createCashfreeOrder(order._id);
          const verified = await new Promise((resolve, reject) => {
            openCashfree({
              paymentSessionId: cf.paymentSessionId,
              environment: cf.environment,
              cashfreeOrderId: cf.cashfreeOrderId,
              name: prefill?.name || order.customerName,
              email: prefill?.email || order.customerEmail,
              phone: prefill?.phone || order.customerPhone,
              description: `Order ${order.orderNumber}`,
              restaurantName,
              onSuccess: (response) => {
                verifyCashfreePayment({
                  orderId: order._id,
                  cashfreeOrderId: response.cashfreeOrderId,
                  paymentStatus: response.paymentStatus,
                })
                  .then((verifiedOrder) => resolve(verifiedOrder))
                  .catch((err) => reject(err));
              },
              onDismiss: (message) => reject(new Error(message || "Payment was cancelled")),
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
    [createOrder, createCashfreeOrder, verifyCashfreePayment, openCashfree]
  );

  const clearError = useCallback(() => {
    setError(null);
    clearOrderError();
    clearPaymentError();
  }, [clearOrderError, clearPaymentError]);

  return { placeOrder, placing, processing, error, clearError };
};