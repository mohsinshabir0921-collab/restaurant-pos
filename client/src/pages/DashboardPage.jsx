import { useState, useEffect, useMemo } from "react";
import { Line, Doughnut, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  BarElement,
} from "chart.js";
import { reportAPI } from "../services/api";
import { Link } from "react-router-dom";
import {
  IconPOS,
  IconDashboard,
  IconCustomers,
  IconReports,
  IconRefresh,
  IconChevronRight,
  IconTables,
  IconMenu,
} from "../components/icons";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  BarElement
);

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState(null);
  const [salesReport, setSalesReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateRange, setDateRange] = useState({ startDate: "", endDate: "" });

  const fetchDashboard = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await reportAPI.getDashboard();
      if (res.data.success) setDashboard(res.data);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  const fetchSalesReport = async () => {
    if (!dateRange.startDate || !dateRange.endDate) return;
    try {
      const res = await reportAPI.getDateRange(dateRange.startDate, dateRange.endDate);
      if (res.data.success) setSalesReport(res.data);
    } catch (err) {
      console.error("Failed to load sales report");
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const stats = dashboard?.stats || {};
  const salesTrend = dashboard?.salesTrend || [];
  const paymentModeStats = dashboard?.paymentModeStats || [];
  const statusSummary = dashboard?.statusSummary || [];
  const orderTypeStats = dashboard?.orderTypeStats || [];
  const recentOrders = dashboard?.recentOrders || [];

  const salesChartData = useMemo(() => ({
    labels: salesTrend.map(item => item.label),
    datasets: [{
      label: "Sales",
      data: salesTrend.map(item => item.sales),
      borderColor: "#0f766e",
      backgroundColor: "rgba(15, 118, 110, 0.14)",
      fill: true,
      tension: 0.35,
      pointRadius: 4,
      pointBackgroundColor: "#0f766e",
    }],
  }), [salesTrend]);

  const salesChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, ticks: { callback: (value) => `₹${value}` } },
    },
  };

  const paymentChartData = useMemo(() => ({
    labels: paymentModeStats.map(item => item.label),
    datasets: [{
      data: paymentModeStats.map(item => item.value),
      backgroundColor: ["#0f766e", "#2563eb", "#f59e0b", "#16a34a", "#8b5cf6"],
      borderColor: "#ffffff",
      borderWidth: 2,
    }],
  }), [paymentModeStats]);

  const paymentChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "68%",
    plugins: { legend: { position: "bottom" } },
  };

  const orderTypeChartData = useMemo(() => ({
    labels: orderTypeStats.map(item => item.label),
    datasets: [{
      label: "Orders",
      data: orderTypeStats.map(item => item.value),
      backgroundColor: ["#0f766e", "#2563eb", "#f59e0b"],
    }],
  }), [orderTypeStats]);

  const statusChartData = useMemo(() => ({
    labels: statusSummary.map(item => item.label),
    datasets: [{
      label: "Count",
      data: statusSummary.map(item => item.value),
      backgroundColor: ["#f59e0b", "#2563eb", "#16a34a", "#0f766e", "#dc2626"],
    }],
  }), [statusSummary]);

  if (loading) {
    return (
      <div className="page">
        <div className="loading"><span className="spinner spinner-lg"></span><span>Loading dashboard...</span></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="dashboard-error">
          <div className="empty-state-icon">⚠️</div>
          <h3>Could not load dashboard</h3>
          <p>{error}</p>
          <button className="btn btn-primary" onClick={fetchDashboard}><IconRefresh /> Retry</button>
        </div>
      </div>
    );
  }

  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div>
          <h1>Dashboard</h1>
          <p className="page-subtitle">{today} · Sales overview, order trends, and recent activity</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={fetchDashboard}><IconRefresh size={16} /> Refresh</button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Total Orders</span>
            <span className="stat-icon stat-icon-teal"><IconPOS /></span>
          </div>
          <div className="stat-value">{stats.totalOrders || 0}</div>
          <div className="stat-sub">All orders recorded</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Total Revenue</span>
            <span className="stat-icon stat-icon-violet"><IconDashboard /></span>
          </div>
          <div className="stat-value">{formatCurrency(stats.totalRevenue)}</div>
          <div className="stat-sub">Gross sales</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Paid Orders</span>
            <span className="stat-icon stat-icon-green"><IconCustomers /></span>
          </div>
          <div className="stat-value">{stats.paidOrders || 0}</div>
          <div className="stat-sub">Completed payments</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Avg Order Value</span>
            <span className="stat-icon stat-icon-amber"><IconReports /></span>
          </div>
          <div className="stat-value">{formatCurrency(stats.averageOrderValue)}</div>
          <div className="stat-sub">Per order average</div>
        </div>
      </div>

      <div className="chart-grid">
        <div className="chart-card">
          <div className="chart-header">
            <div>
              <h3 className="chart-title">Sales Trend</h3>
              <p className="chart-meta">Last 7 days</p>
            </div>
          </div>
          <Line data={salesChartData} options={salesChartOptions} />
        </div>
        <div className="chart-card">
          <div className="chart-header">
            <div>
              <h3 className="chart-title">Payment Modes</h3>
              <p className="chart-meta">By payment method</p>
            </div>
          </div>
          <Doughnut data={paymentChartData} options={paymentChartOptions} />
        </div>
      </div>

      <div className="chart-grid">
        <div className="chart-card">
          <div className="chart-header">
            <div>
              <h3 className="chart-title">Order Types</h3>
              <p className="chart-meta">Dine-in, takeaway & delivery</p>
            </div>
          </div>
          <Doughnut data={orderTypeChartData} options={paymentChartOptions} />
        </div>
        <div className="chart-card">
          <div className="chart-header">
            <div>
              <h3 className="chart-title">Order Status</h3>
              <p className="chart-meta">Current pipeline</p>
            </div>
          </div>
          <Bar data={statusChartData} options={salesChartOptions} />
        </div>
      </div>

      <div className="dashboard-panels">
        <div className="panel">
          <h3>Recent Orders</h3>
          <div className="recent-orders">
            {recentOrders.length > 0 ? (
              recentOrders.map(order => (
                <div key={order._id} className="recent-order-card">
                  <div className="order-icon">{order.orderType === "delivery" ? "🛵" : order.orderType === "takeaway" ? "🥡" : "🍽️"}</div>
                  <div className="order-header">
                    <span className="order-number">{order.customerName || "Walk-in"}</span>
                    <span className="order-meta">
                      <span>#{order.orderNumber ?? "—"}</span>
                      <span>· {order.orderType}</span>
                      <span>· {order.paymentMethod}</span>
                      <span>· {order.items} items</span>
                    </span>
                  </div>
                  <div className="order-right">
                    <div className="order-total">{formatCurrency(order.total)}</div>
                    <span className={`status-badge ${order.orderStatus}`}>{order.orderStatus}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">🛒</div>
                <h3 className="empty-state-title">No recent orders</h3>
                <p className="empty-state-description">Orders placed at the POS will appear here.</p>
                <Link to="/" className="btn btn-primary">Open POS</Link>
              </div>
            )}
          </div>
        </div>
        <div className="panel">
          <h3>Quick Actions</h3>
          <div className="quick-actions">
            <Link to="/" className="quick-action-btn">
              <span className="btn-icon"><IconPOS /></span>
              New Order
              <IconChevronRight className="ml-auto" size={16} />
            </Link>
            <Link to="/tables" className="quick-action-btn">
              <span className="btn-icon"><IconTables /></span>
              Manage Tables
              <IconChevronRight className="ml-auto" size={16} />
            </Link>
            <Link to="/menu" className="quick-action-btn">
              <span className="btn-icon"><IconMenu /></span>
              Manage Menu
              <IconChevronRight className="ml-auto" size={16} />
            </Link>
            <Link to="/reports" className="quick-action-btn">
              <span className="btn-icon"><IconReports /></span>
              View Reports
              <IconChevronRight className="ml-auto" size={16} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}