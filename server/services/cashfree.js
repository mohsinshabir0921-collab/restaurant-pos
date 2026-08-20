const { CASHFREE_API_BASE, CASHFREE_API_VERSION } = require("../config/cashfree");

// Thin, dependency-free wrapper around the Cashfree PG v3 REST API using
// Node's global fetch. Controllers call these helpers so tests can stub the
// module instead of hitting the real gateway.
const request = async (path, { method = "GET", body } = {}) => {
  const response = await fetch(`${CASHFREE_API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-client-id": process.env.CASHFREE_CLIENT_ID || "",
      "x-client-secret": process.env.CASHFREE_CLIENT_SECRET || "",
      "x-api-version": CASHFREE_API_VERSION,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON error body (e.g. gateway/network errors) - keep data as null.
  }

  if (!response.ok) {
    const error = new Error(data?.message || `Cashfree API error (${response.status})`);
    error.statusCode = response.status;
    error.data = data;
    throw error;
  }

  return data;
};

// POST /pg/orders - create a payment order (idempotent by order_id).
const createOrder = (payload) => request("/pg/orders", { method: "POST", body: payload });

// POST /pg/orders/{order_id}/sessions - create a fresh payment session for an
// existing order (used to let the customer retry without recreating the order).
const createOrderSession = (orderId, payload) =>
  request(`/pg/orders/${orderId}/sessions`, { method: "POST", body: payload });

// GET /pg/orders/{order_id} - fetch an order (amount, status, session id).
const fetchOrder = (orderId) => request(`/pg/orders/${orderId}`);

// GET /pg/orders/{order_id}/payments - all payment attempts for an order.
const fetchOrderPayments = (orderId) => request(`/pg/orders/${orderId}/payments`);

// GET /pg/payments/{cf_payment_id} - a single payment attempt.
const fetchPayment = (paymentId) => request(`/pg/payments/${paymentId}`);

module.exports = {
  createOrder,
  createOrderSession,
  fetchOrder,
  fetchOrderPayments,
  fetchPayment,
};