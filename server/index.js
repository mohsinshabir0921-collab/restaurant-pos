require("dotenv").config();

// Global error handlers for unhandled async errors
process.on("unhandledRejection", (reason, promise) => {
  console.error("=== UNHANDLED REJECTION ===");
  console.error("Reason:", reason);
  console.error("Promise:", promise);
  if (reason instanceof Error) {
    console.error("Stack:", reason.stack);
  }
});

process.on("uncaughtException", (error) => {
  console.error("=== UNCAUGHT EXCEPTION ===");
  console.error("Error:", error.message);
  console.error("Stack:", error.stack);
  process.exit(1);
});

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");

const { loginLimiter, refreshLimiter, registerLimiter } = require("./middleware/rateLimiters");

const authRoutes = require("./routes/authRoutes");
const menuRoutes = require("./routes/menuRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const orderRoutes = require("./routes/orderRoutes");
const tableRoutes = require("./routes/tableRoutes");
const customerRoutes = require("./routes/customerRoutes");
const couponRoutes = require("./routes/couponRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const reportRoutes = require("./routes/reportRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const inventoryRoutes = require("./routes/inventoryRoutes");
const recipeRoutes = require("./routes/recipeRoutes");
const purchaseOrderRoutes = require("./routes/purchaseOrderRoutes");
const wasteRoutes = require("./routes/wasteRoutes");
const loyaltyRoutes = require("./routes/loyaltyRoutes");
const communicationRoutes = require("./routes/communicationRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const bannerRoutes = require("./routes/bannerRoutes");
const publicRoutes = require("./routes/publicRoutes");
const deliveryRoutes = require("./routes/deliveryRoutes");

const app = express();

app.use(helmet());

// CORS: allow only configured client origins (CLIENT_URL, comma-separated).
// Defaults to the Vite dev server so local development keeps working.
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser requests (curl, server-to-server, same-origin) and configured origins.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
  })
);

// CORS error handler - must come before general error handler
app.use((err, req, res, next) => {
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ success: false, message: "CORS origin not allowed" });
  }
  next(err);
});

// Cashfree webhooks must be verified against the exact raw body, so the raw
// body parser must run before the global JSON parser for this route.
app.use("/api/payment/webhook", express.raw({ type: "application/json" }));

app.use(express.json());

app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/refresh", refreshLimiter);
app.use("/api/auth/register", registerLimiter);

app.get("/", (req, res) => {
  res.send("API is running");
});

app.use("/api/auth", authRoutes);
app.use("/api/menu", menuRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/tables", tableRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/recipes", recipeRoutes);
app.use("/api/purchase-orders", purchaseOrderRoutes);
app.use("/api/waste", wasteRoutes);
app.use("/api/loyalty", loyaltyRoutes);
app.use("/api/communications", communicationRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/banners", bannerRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/deliveries", deliveryRoutes);

const { notFound, errorHandler } = require("./middleware/errorMiddleware");
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("MongoDB connected");
    
    const Settings = require("./models/Settings");
    await Settings.initializeDefaults();
    console.log("Default settings initialized");
    
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.log("MongoDB connection error:", err);
  });