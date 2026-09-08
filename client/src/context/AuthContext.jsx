import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { authAPI } from "../services/api";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadUser = useCallback(async () => {
    const token = localStorage.getItem("token");
    const savedUser = localStorage.getItem("user");
    if (!token) {
      setLoading(false);
      return;
    }
    // Trust localStorage for immediate render (prevents flash), then verify with server
    // The verification is silent: if access token expired, the interceptor will
    // refresh using the stored refreshToken and retry getMe without showing an error
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setLoading(false);
        return;
      }
    }
    try {
      const response = await authAPI.getMe();
      const userData = response.data.user;
      localStorage.setItem("user", JSON.stringify(userData));
      setUser(userData);
    } catch (err) {
      // If getMe failed with 401, the api interceptor already attempted silent refresh
      // If refresh succeeded, the retry would have succeeded and we wouldn't be here
      // If we are here, refresh failed or no refresh token — clear stale session
      // Do not show a raw refresh error; ProtectedRoute will redirect to /login
      const stillHasToken = localStorage.getItem("token");
      if (!stillHasToken) {
        setUser(null);
        localStorage.removeItem("user");
      } else if (err.response?.status === 401) {
        // Genuine 401 after refresh attempt — session expired, clear and let redirect handle
        // The interceptor's clearAuth already redirected to /pos/login for POS, but
        // for safety ensure local state is cleared without forcing a hard redirect here
        // (ProtectedRoute will handle redirect)
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const login = async (email, password) => {
    setError(null);
    try {
      const response = await authAPI.login(email, password);
      const { accessToken, refreshToken, user: userData } = response.data;
      
      localStorage.setItem("token", accessToken);
      if (refreshToken) {
        localStorage.setItem("refreshToken", refreshToken);
      }
      localStorage.setItem("user", JSON.stringify(userData));
      setUser(userData);
      
      return { success: true, user: userData };
    } catch (err) {
      const message = err.response?.data?.message || "Login failed";
      setError(message);
      return { success: false, message };
    }
  };

  const register = async (data) => {
    setError(null);
    try {
      const response = await authAPI.register(data);
      return { success: true, user: response.data.user };
    } catch (err) {
      const message = err.response?.data?.message || "Registration failed";
      setError(message);
      return { success: false, message };
    }
  };

  const logout = () => {
    const refreshToken = localStorage.getItem("refreshToken");
    if (refreshToken) {
      authAPI.logout(refreshToken).catch(() => {});
    }
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
    setUser(null);
  };

  const refreshUser = async () => {
    try {
      const response = await authAPI.getMe();
      const userData = response.data.user;
      localStorage.setItem("user", JSON.stringify(userData));
      setUser(userData);
      return userData;
    } catch {
      logout();
      return null;
    }
  };

  const hasRole = (roles) => {
    if (!user) return false;
    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    return allowedRoles.includes(user.role);
  };

  const value = {
    user,
    loading,
    error,
    login,
    register,
    logout,
    refreshUser,
    hasRole,
    isAuthenticated: !!user,
    isAdmin: user?.role === "admin",
    isCashier: user?.role === "cashier",
    isKitchen: user?.role === "kitchen",
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};