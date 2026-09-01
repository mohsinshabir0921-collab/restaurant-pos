import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute, PublicRoute } from "./components/ProtectedRoute";
import MainLayout from "./components/MainLayout";
import LoginPage from "./pages/LoginPage";
import POSPage from "./pages/POSPage";
import DashboardPage from "./pages/DashboardPage";
import KitchenPage from "./pages/KitchenPage";
import DeliveryPage from "./pages/DeliveryPage";
import DeliveryTrackingPage from "./pages/DeliveryTrackingPage";
import ReportsPage from "./pages/ReportsPage";
import MenuPage from "./pages/MenuPage";
import CategoriesPage from "./pages/CategoriesPage";
import TablesPage from "./pages/TablesPage";
import CustomersPage from "./pages/CustomersPage";
import CouponsPage from "./pages/CouponsPage";
import BannersPage from "./pages/BannersPage";
import StaffPage from "./pages/StaffPage";
import SettingsPage from "./pages/SettingsPage";
import PaymentMethodsEditPage from "./pages/PaymentMethodsEditPage";
import InventoryPage from "./pages/InventoryPage";
import RecipesPage from "./pages/RecipesPage";
import PurchaseOrdersPage from "./pages/PurchaseOrdersPage";
import WasteLogPage from "./pages/WasteLogPage";
import CommunicationsPage from "./pages/CommunicationsPage";
import LoyaltyPage from "./pages/LoyaltyPage";
import "./App.css";

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      
      <Route element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
        <Route path="/" element={<POSPage />} />
        <Route path="/dashboard" element={<ProtectedRoute allowedRoles={["admin"]}><DashboardPage /></ProtectedRoute>} />
        <Route path="/kitchen" element={<ProtectedRoute allowedRoles={["admin", "kitchen"]}><KitchenPage /></ProtectedRoute>} />
        <Route path="/delivery" element={<ProtectedRoute allowedRoles={["delivery"]}><DeliveryPage /></ProtectedRoute>} />
        <Route path="/tracking" element={<ProtectedRoute allowedRoles={["admin", "cashier"]}><DeliveryTrackingPage /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute allowedRoles={["admin"]}><ReportsPage /></ProtectedRoute>} />
        <Route path="/menu" element={<ProtectedRoute allowedRoles={["admin"]}><MenuPage /></ProtectedRoute>} />
        <Route path="/categories" element={<ProtectedRoute allowedRoles={["admin"]}><CategoriesPage /></ProtectedRoute>} />
        <Route path="/tables" element={<ProtectedRoute allowedRoles={["admin"]}><TablesPage /></ProtectedRoute>} />
        <Route path="/customers" element={<ProtectedRoute allowedRoles={["admin", "cashier"]}><CustomersPage /></ProtectedRoute>} />
        <Route path="/coupons" element={<ProtectedRoute allowedRoles={["admin"]}><CouponsPage /></ProtectedRoute>} />
        <Route path="/banners" element={<ProtectedRoute allowedRoles={["admin"]}><BannersPage /></ProtectedRoute>} />
        <Route path="/staff" element={<ProtectedRoute allowedRoles={["admin"]}><StaffPage /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute allowedRoles={["admin"]}><SettingsPage /></ProtectedRoute>} />
        <Route path="/settings/payments/edit/:id" element={<ProtectedRoute allowedRoles={["admin"]}><PaymentMethodsEditPage /></ProtectedRoute>} />
        <Route path="/inventory" element={<ProtectedRoute allowedRoles={["admin"]}><InventoryPage /></ProtectedRoute>} />
        <Route path="/recipes" element={<ProtectedRoute allowedRoles={["admin"]}><RecipesPage /></ProtectedRoute>} />
        <Route path="/purchase-orders" element={<ProtectedRoute allowedRoles={["admin"]}><PurchaseOrdersPage /></ProtectedRoute>} />
        <Route path="/waste" element={<ProtectedRoute allowedRoles={["admin"]}><WasteLogPage /></ProtectedRoute>} />
        <Route path="/communications" element={<ProtectedRoute allowedRoles={["admin"]}><CommunicationsPage /></ProtectedRoute>} />
        <Route path="/loyalty" element={<ProtectedRoute allowedRoles={["admin"]}><LoyaltyPage /></ProtectedRoute>} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}