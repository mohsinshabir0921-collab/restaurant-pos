import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 30000,
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

let isRefreshing = false;
let refreshSubscribers = [];

const onRefreshed = (accessToken) => {
  refreshSubscribers.forEach((callback) => callback(accessToken));
  refreshSubscribers = [];
};

const clearAuth = () => {
  localStorage.removeItem("token");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("user");
  window.location.href = "/pos/login";
};

const requestNewAccessToken = async () => {
  const refreshToken = localStorage.getItem("refreshToken");
  if (!refreshToken) {
    throw new Error("No refresh token available");
  }

  const response = await axios.post(
    `${API_BASE}/auth/refresh`,
    { refreshToken },
    { timeout: 15000 }
  );

  const { accessToken, refreshToken: newRefreshToken } = response.data;
  localStorage.setItem("token", accessToken);
  if (newRefreshToken) {
    localStorage.setItem("refreshToken", newRefreshToken);
  }

  return accessToken;
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const status = error.response?.status;

    if (status === 401 && !originalRequest?._retry) {
      const url = originalRequest?.url || "";
      const isAuthRequest = url.includes("/auth/login") || url.includes("/auth/refresh");

      if (!isAuthRequest) {
        originalRequest._retry = true;

        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            refreshSubscribers.push((accessToken) => {
              if (!accessToken) {
                reject(error);
                return;
              }
              originalRequest.headers.Authorization = `Bearer ${accessToken}`;
              resolve(api(originalRequest));
            });
          });
        }

        isRefreshing = true;
        try {
          const accessToken = await requestNewAccessToken();
          onRefreshed(accessToken);
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return api(originalRequest);
        } catch (refreshError) {
          onRefreshed(null);
          clearAuth();
          return Promise.reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      }
    }

    if (status === 403) {
      console.warn("Access denied:", error.response.data?.message);
    }

    return Promise.reject(error);
  }
);

export const authAPI = {
  login: (email, password) => api.post("/auth/login", { email, password }),
  register: (data) => api.post("/auth/register", data),
  registerUser: (data) => api.post("/auth/register", data),
  logout: (refreshToken) => api.post("/auth/logout", { refreshToken }),
  getMe: () => api.get("/auth/me"),
  getStaff: (params) => api.get("/auth/staff", { params }),
  getStaffById: (id) => api.get(`/auth/staff/${id}`),
  updateStaff: (id, data) => api.put(`/auth/staff/${id}`, data),
  changePassword: (id, data) => api.patch(`/auth/staff/${id}/password`, data),
  deactivateStaff: (id) => api.patch(`/auth/staff/${id}/deactivate`),
};

export const settingsAPI = {
  getAll: (group) => api.get("/settings", { params: { group } }),
  getPublic: () => api.get("/settings/public"),
  get: (key) => api.get(`/settings/${key}`),
  update: (key, value, description, group) => api.put(`/settings/${key}`, { value, description, group }),
  bulkUpdate: (settings) => api.post("/settings/bulk", { settings }),
  initialize: () => api.get("/settings/init"),
  uploadMedia: (formData, onProgress) =>
    api.post("/settings/media", formData, {
      headers: { "Content-Type": false },
      onUploadProgress: (e) => onProgress && onProgress(e),
    }),
  removeMedia: (type) => api.delete("/settings/media", { data: { type } }),
  testPrinter: () => api.post("/settings/test-printer"),
};

export const categoryAPI = {
  getAll: (params) => api.get("/categories", { params }),
  getById: (id) => api.get(`/categories/${id}`),
  create: (data) => api.post("/categories", data),
  update: (id, data) => api.put(`/categories/${id}`, data),
  delete: (id) => api.delete(`/categories/${id}`),
  reorder: (categoryOrders) => api.post("/categories/reorder", { categoryOrders }),
};

export const menuAPI = {
  getAll: (params) => api.get("/menu", { params }),
  getByCategory: () => api.get("/menu/by-category"),
  getById: (id) => api.get(`/menu/${id}`),
  create: (data) => api.post("/menu", data),
  update: (id, data) => api.put(`/menu/${id}`, data),
  delete: (id) => api.delete(`/menu/${id}`),
  toggleAvailability: (id, isAvailable) => api.patch(`/menu/${id}/toggle`, { isAvailable }),
  reorder: (itemOrders) => api.post("/menu/reorder", { itemOrders }),
};

export const tableAPI = {
  getAll: (params) => api.get("/tables", { params }),
  getFloorPlan: () => api.get("/tables/floor-plan"),
  getById: (id) => api.get(`/tables/${id}`),
  create: (data) => api.post("/tables", data),
  update: (id, data) => api.put(`/tables/${id}`, data),
  delete: (id) => api.delete(`/tables/${id}`),
  updateStatus: (id, status) => api.patch(`/tables/${id}/status`, { status }),
  merge: (data) => api.post("/tables/merge", data),
  getByStatus: (status) => api.get(`/tables/status/${status}`),
};

export const customerAPI = {
  getAll: (params) => api.get("/customers", { params }),
  search: (q, limit) => api.get("/customers/search", { params: { q, limit } }),
  getById: (id) => api.get(`/customers/${id}`),
  getByPhone: (phone) => api.get(`/customers/phone/${phone}`),
  createOrGet: (data) => api.post("/customers/lookup", data),
  update: (id, data) => api.put(`/customers/${id}`, data),
  addAddress: (id, data) => api.post(`/customers/${id}/addresses`, data),
  updateAddress: (id, addressId, data) => api.put(`/customers/${id}/addresses/${addressId}`, data),
  deleteAddress: (id, addressId) => api.delete(`/customers/${id}/addresses/${addressId}`),
  setDefaultAddress: (id, addressId) => api.patch(`/customers/${id}/addresses/${addressId}/default`),
  getOrders: (id, params) => api.get(`/customers/${id}/orders`, { params }),
  getStats: (id) => api.get(`/customers/${id}/stats`),
  redeemPoints: (id, points) => api.post(`/customers/${id}/redeem-points`, { points }),
  bulkDelete: (ids) => api.delete("/customers/bulk", { data: { ids } }),
};

export const couponAPI = {
  getAll: (params) => api.get("/coupons", { params }),
  getById: (id) => api.get(`/coupons/${id}`),
  validate: (data) => api.get("/coupons/validate", { params: data }),
  create: (data) => api.post("/coupons", data),
  update: (id, data) => api.put(`/coupons/${id}`, data),
  delete: (id) => api.delete(`/coupons/${id}`),
  toggle: (id, isActive) => api.patch(`/coupons/${id}/toggle`, { isActive }),
};

export const bannerAPI = {
  getAll: () => api.get("/banners"),
  create: (data) => api.post("/banners", data),
  update: (id, data) => api.put(`/banners/${id}`, data),
  delete: (id) => api.delete(`/banners/${id}`),
  toggle: (id, isActive) => api.patch(`/banners/${id}/toggle`, { isActive }),
};

export const orderAPI = {
  create: (data) => api.post("/orders", data),
  getAll: (params) => api.get("/orders", { params }),
  getById: (id) => api.get(`/orders/${id}`),
  getKitchenOrders: () => api.get("/orders/kitchen"),
  updateStatus: (id, orderStatus) => api.patch(`/orders/${id}/status`, { orderStatus }),
  assignDelivery: (id, deliveryBoyId) => api.post(`/orders/${id}/assign`, { deliveryBoyId }),
  updateItemStatus: (id, itemIndex, kitchenStatus) => api.patch(`/orders/${id}/items/${itemIndex}/kitchen-status`, { kitchenStatus }),
  update: (id, data) => api.put(`/orders/${id}`, data),
  addItems: (id, items) => api.post(`/orders/${id}/items`, { items }),
  removeItem: (id, itemIndex) => api.delete(`/orders/${id}/items/${itemIndex}`),
  cancel: (id, reason) => api.post(`/orders/${id}/cancel`, { reason }),
  markPaid: (id) => api.post(`/orders/${id}/mark-paid`),
  printKOT: (id) => api.post(`/orders/${id}/print-kot`),
  printInvoice: (id) => api.post(`/orders/${id}/print-invoice`),
  editItems: (id, data) => api.put(`/orders/${id}/edit`, data),
  collectAdditional: (id, data) => api.post(`/orders/${id}/collect-additional`, data),
  bulkDelete: (ids) => api.delete("/orders/bulk", { data: { ids } }),
};

export const deliveryAPI = {
  getAssigned: () => api.get("/deliveries/assigned"),
  reportLocation: (orderId, lat, lng) => api.post("/deliveries/location", { orderId, lat, lng }),
  getTracking: (id) => api.get(`/orders/${id}/tracking`),
};

export const reportAPI = {
  getToday: () => api.get("/reports/today"),
  getDashboard: () => api.get("/reports/dashboard"),
  getDateRange: (startDate, endDate) => api.get("/reports/date-range", { params: { startDate, endDate } }),
  getSalesByCategory: (params) => api.get("/reports/sales-by-category", { params }),
  getSalesByItem: (params) => api.get("/reports/sales-by-item", { params }),
  getPayments: (params) => api.get("/reports/payments", { params }),
  getTax: (params) => api.get("/reports/tax", { params }),
  getStaff: (params) => api.get("/reports/staff", { params }),
  getCustomers: (params) => api.get("/reports/customers", { params }),
  getHourly: (params) => api.get("/reports/hourly", { params }),
};

export const paymentAPI = {
  createCashfreeOrder: (orderId) => api.post("/payment/create-order", { orderId }),
  verifyCashfreePayment: (data) => api.post("/payment/verify", data),
  createAdditionalCashfreeOrder: (orderId) => api.post("/payment/create-additional-order", { orderId }),
  verifyAdditionalCashfreePayment: (data) => api.post("/payment/verify-additional", data),
  generateAdditionalPaymentLink: (orderId) => api.post("/payment/additional-link", { orderId }),
  bulkDelete: (ids) => api.delete("/payment/bulk", { data: { ids } }),
};

export const inventoryAPI = {
  getAll: (params) => api.get("/inventory", { params }),
  getLowStock: () => api.get("/inventory/low-stock"),
  getOutOfStock: () => api.get("/inventory/out-of-stock"),
  getSummary: () => api.get("/inventory/summary"),
  getMovements: (params) => api.get("/inventory/movements", { params }),
  getById: (id) => api.get(`/inventory/${id}`),
  create: (data) => api.post("/inventory", data),
  update: (id, data) => api.put(`/inventory/${id}`, data),
  adjust: (id, data) => api.patch(`/inventory/${id}/adjust`, data),
  delete: (id) => api.delete(`/inventory/${id}`),
};

export const recipeAPI = {
  getAll: (params) => api.get("/recipes", { params }),
  getByMenuItem: (menuItemId) => api.get(`/recipes/menu-item/${menuItemId}`),
  getById: (id) => api.get(`/recipes/${id}`),
  getCost: (id) => api.get(`/recipes/cost/${id}`),
  checkStock: (params) => api.get("/recipes/check-stock", { params }),
  create: (data) => api.post("/recipes", data),
  update: (id, data) => api.put(`/recipes/${id}`, data),
  delete: (id) => api.delete(`/recipes/${id}`),
};

export const purchaseOrderAPI = {
  getAll: (params) => api.get("/purchase-orders", { params }),
  getSummary: (params) => api.get("/purchase-orders/summary", { params }),
  getById: (id) => api.get(`/purchase-orders/${id}`),
  create: (data) => api.post("/purchase-orders", data),
  update: (id, data) => api.put(`/purchase-orders/${id}`, data),
  send: (id) => api.patch(`/purchase-orders/${id}/send`),
  receive: (id, data) => api.patch(`/purchase-orders/${id}/receive`, data),
  cancel: (id, data) => api.patch(`/purchase-orders/${id}/cancel`, data),
  delete: (id) => api.delete(`/purchase-orders/${id}`),
  bulkDelete: (ids) => api.delete("/purchase-orders/bulk", { data: { ids } }),
};

export const wasteAPI = {
  getAll: (params) => api.get("/waste", { params }),
  getSummary: (params) => api.get("/waste/summary", { params }),
  getById: (id) => api.get(`/waste/${id}`),
  create: (data) => api.post("/waste", data),
  update: (id, data) => api.put(`/waste/${id}`, data),
  approve: (id) => api.patch(`/waste/${id}/approve`),
  delete: (id) => api.delete(`/waste/${id}`),
  bulkDelete: (ids) => api.delete("/waste/bulk", { data: { ids } }),
};

export const loyaltyAPI = {
  getConfig: () => api.get("/loyalty/config"),
  updateConfig: (data) => api.put("/loyalty/config", data),
  getReport: (params) => api.get("/loyalty/report", { params }),
  getCustomer: (id) => api.get(`/loyalty/customer/${id}`),
  adjustPoints: (id, data) => api.patch(`/loyalty/customer/${id}/adjust`, data),
};

export const communicationAPI = {
  getAll: (params) => api.get("/communications", { params }),
  getByTrigger: (trigger, type) => api.get(`/communications/trigger/${trigger}`, { params: { type } }),
  getById: (id) => api.get(`/communications/${id}`),
  create: (data) => api.post("/communications", data),
  update: (id, data) => api.put(`/communications/${id}`, data),
  preview: (id, data) => api.post(`/communications/${id}/preview`, { data }),
  delete: (id) => api.delete(`/communications/${id}`),
};

export const notificationAPI = {
  getMine: () => api.get("/notifications"),
  markAsRead: (id) => api.patch(`/notifications/${id}/read`),
  markAllAsRead: () => api.patch("/notifications/read-all"),
  bulkDelete: (ids) => api.delete("/notifications/bulk", { data: { ids } }),
  clearAll: () => api.delete("/notifications/clear-all"),
};

export default api;