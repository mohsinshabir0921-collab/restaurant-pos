import axios from "axios";

// Production API base is injected at build time via VITE_API_URL (set in the
// hosting provider's environment, e.g. Netlify). Falls back to the same-origin
// /api path so the local Vite dev proxy (vite.config.js -> /api) handles dev.
const API_BASE = import.meta.env.VITE_API_URL || "/api";

const websiteApi = axios.create({
  baseURL: API_BASE,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 10000,
});

// Public website API calls. Order/payment/coupon calls go through the
// dedicated public endpoints (/api/public) which reuse the same POS
// controllers server-side with price/availability validation.
export const websiteAPI = {
  getPublicSettings: () => websiteApi.get("/settings/public"),
  getActiveBanners: () => websiteApi.get("/public/banners"),
  getMenuByCategory: () => websiteApi.get("/menu/by-category"),
  getMenuItem: (id) => websiteApi.get(`/menu/${id}`),
  getOrderEstimate: (data) => websiteApi.post("/public/order-estimate", data),
  validateCoupon: (params) => websiteApi.get("/public/coupons/validate", { params }),
  createOrder: (data) => websiteApi.post("/public/orders", data),
  createCashfreeOrder: (orderId) => websiteApi.post("/public/payment/create-order", { orderId }),
  verifyCashfreePayment: (data) => websiteApi.post("/public/payment/verify", data),
  createAdditionalCashfreeOrder: (orderId, phone) =>
    websiteApi.post("/public/payment/create-additional-order", { orderId, phone }),
  verifyAdditionalCashfreePayment: (data) => websiteApi.post("/public/payment/verify-additional", data),
  getAdditionalPaymentLink: (token) =>
    websiteApi.get(`/public/payment/link/${encodeURIComponent(token)}`),
  createAdditionalCashfreeOrderByToken: (token) =>
    websiteApi.post("/public/payment/create-additional-order", { token }),
  verifyAdditionalCashfreePaymentByToken: (data) =>
    websiteApi.post("/public/payment/verify-additional", data),
  trackOrder: (orderNumber, phone) =>
    websiteApi.get(`/public/orders/${orderNumber}/track`, { params: { phone } }),
  getRecentOrders: (phone) => websiteApi.get("/public/orders/recent", { params: { phone } }),
};

export default websiteApi;
