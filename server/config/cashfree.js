// Cashfree Payments gateway configuration.
//
// CASHFREE_ENV selects the API base URL and the SDK mode the frontend must
// use: "sandbox" for the test environment and "production" for live payments.
const API_BASE = {
  sandbox: "https://sandbox.cashfree.com",
  production: "https://api.cashfree.com",
  test: "https://sandbox.cashfree.com",
};

const CASHFREE_ENV = String(process.env.CASHFREE_ENV || "sandbox").toLowerCase();

const CASHFREE_API_BASE = API_BASE[CASHFREE_ENV] || API_BASE.sandbox;

// API version determines the order/session payload shape. 2023-08-01 is the
// stable, widely documented version that uses an explicit merchant order_id.
const CASHFREE_API_VERSION = process.env.CASHFREE_API_VERSION || "2023-08-01";

module.exports = {
  CASHFREE_API_BASE,
  CASHFREE_API_VERSION,
  CASHFREE_ENV,
};