import { useState, useCallback, useRef } from "react";
import { websiteAPI } from "../services/api";

const loadRazorpayScript = () =>
  new Promise((resolve, reject) => {
    if (window.Razorpay) {
      resolve(window.Razorpay);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(window.Razorpay);
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

  const createRazorpayOrder = useCallback(async (orderId) => {
    setProcessing(true);
    setError(null);
    try {
      const response = await websiteAPI.createRazorpayOrder(orderId);
      return response.data;
    } catch (err) {
      const message = err.response?.data?.message || "Failed to initialise payment";
      setError(message);
      throw err;
    } finally {
      setProcessing(false);
    }
  }, []);

  const verifyRazorpayPayment = useCallback(async (data) => {
    setProcessing(true);
    setError(null);
    try {
      const response = await websiteAPI.verifyRazorpayPayment(data);
      return response.data.order;
    } catch (err) {
      const message = err.response?.data?.message || "Payment verification failed";
      setError(message);
      throw err;
    } finally {
      setProcessing(false);
    }
  }, []);

  const openRazorpay = useCallback(
    async ({ key, orderId, razorpayOrderId, amount, currency, name, email, phone, description, restaurantName, onSuccess, onDismiss }) => {
      if (openedRef.current) return;
      openedRef.current = true;
      try {
        const Razorpay = await loadRazorpayScript();
        const options = {
          key,
          amount,
          currency,
          name: restaurantName || name,
          description: description || "Food order",
          order_id: razorpayOrderId,
          prefill: { name, email, contact: phone },
          notes: { orderId },
          theme: { color: "#c2410c" },
          modal: {
            ondismiss: () => {
              openedRef.current = false;
              onDismiss?.();
            },
          },
          handler: (response) => {
            openedRef.current = false;
            onSuccess?.(response);
          },
        };
        const rzp = new Razorpay(options);
        rzp.on("payment.failed", () => {
          openedRef.current = false;
        });
        rzp.open();
      } catch (err) {
        openedRef.current = false;
        throw err;
      }
    },
    []
  );

  const clearError = useCallback(() => setError(null), []);

  return { createRazorpayOrder, verifyRazorpayPayment, openRazorpay, processing, error, clearError };
};

// Orchestrates the full order + online payment flow.
export const useCheckout = () => {
  const { createOrder, creating, error: orderError, clearError: clearOrderError } = useOrder();
  const { createRazorpayOrder, verifyRazorpayPayment, openRazorpay, processing, error: paymentError, clearError: clearPaymentError } = usePayment();
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState(null);

  const placeOrder = useCallback(
    async ({ payload, razorpayPrefill, restaurantName }) => {
      setPlacing(true);
      setError(null);
      try {
        // 1. Create the order (pending for online payment).
        const order = await createOrder(payload);

        // 2. For online payment: create the Razorpay order, open checkout and
        //    only trust the server-side verification result.
        if (payload.paymentMethod === "upi") {
          const rzp = await createRazorpayOrder(order._id);
          const verified = await new Promise((resolve, reject) => {
            openRazorpay({
              key: rzp.key,
              orderId: order._id,
              razorpayOrderId: rzp.razorpayOrderId,
              amount: rzp.amount,
              currency: rzp.currency,
              name: razorpayPrefill?.name || order.customerName,
              email: razorpayPrefill?.email || order.customerEmail,
              phone: razorpayPrefill?.phone || order.customerPhone,
              description: `Order ${order.orderNumber}`,
              restaurantName,
              onSuccess: (response) => {
                verifyRazorpayPayment({
                  orderId: order._id,
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                })
                  .then((verifiedOrder) => resolve(verifiedOrder))
                  .catch((err) => reject(err));
              },
              onDismiss: () => reject(new Error("Payment was cancelled")),
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
    [createOrder, createRazorpayOrder, verifyRazorpayPayment, openRazorpay]
  );

  const clearError = useCallback(() => {
    setError(null);
    clearOrderError();
    clearPaymentError();
  }, [clearOrderError, clearPaymentError]);

  return { placeOrder, placing, processing, error, clearError };
};