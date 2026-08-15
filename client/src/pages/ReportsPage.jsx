import { useState, useEffect } from "react";
import { reportAPI } from "../services/api";
import {
  IconDashboard,
  IconCalendar,
  IconCategories,
  IconMenu,
  IconCart,
  IconReports,
  IconStaff,
  IconCustomers,
  IconClock,
  IconRefresh,
  IconDownload,
} from "../components/icons";

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;

export default function ReportsPage() {
  const [activeReport, setActiveReport] = useState("today");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dateRange, setDateRange] = useState({ startDate: "", endDate: "" });
  const [reports, setReports] = useState({
    today: null,
    dateRange: null,
    category: null,
    item: null,
    payment: null,
    tax: null,
    staff: null,
    customer: null,
    hourly: null,
  });

  const fetchReport = async (type) => {
    setLoading(true);
    setError("");
    try {
      let res;
      switch (type) {
        case "today":
          res = await reportAPI.getToday();
          break;
        case "dateRange":
          if (!dateRange.startDate || !dateRange.endDate) return;
          res = await reportAPI.getDateRange(dateRange.startDate, dateRange.endDate);
          break;
        case "category":
          res = await reportAPI.getSalesByCategory({ startDate: dateRange.startDate, endDate: dateRange.endDate });
          break;
        case "item":
          res = await reportAPI.getSalesByItem({ startDate: dateRange.startDate, endDate: dateRange.endDate, limit: 50 });
          break;
        case "payment":
          res = await reportAPI.getPayments({ startDate: dateRange.startDate, endDate: dateRange.endDate });
          break;
        case "tax":
          res = await reportAPI.getTax({ startDate: dateRange.startDate, endDate: dateRange.endDate });
          break;
        case "staff":
          res = await reportAPI.getStaff({ startDate: dateRange.startDate, endDate: dateRange.endDate });
          break;
        case "customer":
          res = await reportAPI.getCustomers({ startDate: dateRange.startDate, endDate: dateRange.endDate, limit: 50 });
          break;
        case "hourly":
          res = await reportAPI.getHourly({ startDate: dateRange.startDate, endDate: dateRange.endDate });
          break;
      }
      if (res.data.success) {
        setReports(prev => ({ ...prev, [type]: res.data }));
      }
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport("today");
  }, []);

  useEffect(() => {
    if (activeReport !== "today") {
      fetchReport(activeReport);
    }
  }, [activeReport, dateRange]);

  const handleDateRangeSubmit = (e) => {
    e.preventDefault();
    fetchReport(activeReport);
  };

  const exportCSV = (data, filename) => {
    if (!data || !data.length) return;
    const headers = Object.keys(data[0]);
    const csv = [
      headers.join(","),
      ...data.map(row => headers.map(h => JSON.stringify(row[h])).join(","))
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderReport = () => {
    const report = reports[activeReport];
    if (!report) return <div className="loading">Loading...</div>;

    switch (activeReport) {
      case "today":
        return renderTodayReport(report);
      case "dateRange":
        return renderDateRangeReport(report);
      case "category":
        return renderCategoryReport(report);
      case "item":
        return renderItemReport(report);
      case "payment":
        return renderPaymentReport(report);
      case "tax":
        return renderTaxReport(report);
      case "staff":
        return renderStaffReport(report);
      case "customer":
        return renderCustomerReport(report);
      case "hourly":
        return renderHourlyReport(report);
      default:
        return null;
    }
  };

  const renderTodayReport = (r) => (
    <div className="reports-view">
      <div className="report-cards">
        <div className="report-card"><span className="report-label">Total Orders</span><div className="report-value">{r.totalOrders}</div></div>
        <div className="report-card"><span className="report-label">Paid Orders</span><div className="report-value">{r.paidOrders}</div></div>
        <div className="report-card"><span className="report-label">Total Sales</span><div className="report-value">{formatCurrency(r.totalSales)}</div></div>
        <div className="report-card"><span className="report-label">Paid Sales</span><div className="report-value">{formatCurrency(r.paidSales)}</div></div>
        <div className="report-card"><span className="report-label">Subtotal</span><div className="report-value">{formatCurrency(r.subtotal)}</div></div>
        <div className="report-card"><span className="report-label">Total Tax</span><div className="report-value">{formatCurrency(r.totalTax)}</div></div>
        <div className="report-card"><span className="report-label">Discounts</span><div className="report-value">{formatCurrency(r.totalDiscount)}</div></div>
        <div className="report-card"><span className="report-label">Service Charge</span><div className="report-value">{formatCurrency(r.totalServiceCharge)}</div></div>
      </div>
      <div className="report-section">
        <div className="section-header">
          <h2>Payment Breakdown</h2>
        </div>
        <div className="table-container">
          <table className="report-table">
            <thead><tr><th>Method</th><th>Orders</th><th>Sales</th><th>Paid Orders</th><th>Paid Sales</th></tr></thead>
            <tbody>
              {Object.entries(r.paymentBreakdown || {}).map(([method, data]) => (
                <tr key={method}><td><span className="text-capitalize">{method}</span></td><td>{data.count}</td><td>{formatCurrency(data.sales)}</td><td>{data.paidCount}</td><td>{formatCurrency(data.paidSales)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="report-section">
        <div className="section-header">
          <h2>Order Type Breakdown</h2>
        </div>
        <div className="table-container">
          <table className="report-table">
            <thead><tr><th>Type</th><th>Orders</th><th>Sales</th></tr></thead>
            <tbody>
              {Object.entries(r.orderTypeBreakdown || {}).map(([type, data]) => (
                <tr key={type}><td><span className="text-capitalize">{type}</span></td><td>{data.count}</td><td>{formatCurrency(data.sales)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderDateRangeReport = (r) => (
    <div className="reports-view">
      <div className="report-cards">
        <div className="report-card"><span className="report-label">Total Orders</span><div className="report-value">{r.totalOrders}</div></div>
        <div className="report-card"><span className="report-label">Paid Orders</span><div className="report-value">{r.paidOrders}</div></div>
        <div className="report-card"><span className="report-label">Total Sales</span><div className="report-value">{formatCurrency(r.totalSales)}</div></div>
        <div className="report-card"><span className="report-label">Paid Sales</span><div className="report-value">{formatCurrency(r.paidSales)}</div></div>
      </div>
      <div className="report-section">
        <div className="section-header">
          <h2>Daily Breakdown</h2>
        </div>
        <div className="table-container">
          <table className="report-table">
            <thead><tr><th>Date</th><th>Orders</th><th>Paid Orders</th><th>Sales</th><th>Paid Sales</th></tr></thead>
            <tbody>
              {(r.dailyBreakdown || []).map(day => (
                <tr key={day.date}><td>{day.date}</td><td>{day.totalOrders}</td><td>{day.paidOrders}</td><td>{formatCurrency(day.totalSales)}</td><td>{formatCurrency(day.paidSales)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderCategoryReport = (r) => (
    <div className="reports-view">
      <div className="report-section">
        <div className="section-header">
          <h2>Sales by Category</h2>
          <button className="btn btn-sm btn-secondary" onClick={() => exportCSV(r.sales, "category_sales")}><IconDownload size={14} /> Export CSV</button>
        </div>
        <div className="table-container">
          <table className="report-table">
            <thead><tr><th>Category</th><th>Qty Sold</th><th>Total Sales</th><th>Orders</th></tr></thead>
            <tbody>
              {(r.sales || []).map(item => (
                <tr key={item._id}><td>{item.categoryName}</td><td>{item.totalQty}</td><td>{formatCurrency(item.totalSales)}</td><td>{item.orderCount}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderItemReport = (r) => (
    <div className="reports-view">
      <div className="report-section">
        <div className="section-header">
          <h2>Top Selling Items</h2>
          <button className="btn btn-sm btn-secondary" onClick={() => exportCSV(r.sales, "item_sales")}><IconDownload size={14} /> Export CSV</button>
        </div>
        <div className="table-container">
          <table className="report-table">
            <thead><tr><th>Item</th><th>Qty Sold</th><th>Total Sales</th><th>Avg Price</th><th>Orders</th></tr></thead>
            <tbody>
              {(r.sales || []).map(item => (
                <tr key={item._id}><td>{item.name}</td><td>{item.totalQty}</td><td>{formatCurrency(item.totalSales)}</td><td>{formatCurrency(item.avgPrice)}</td><td>{item.orderCount}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderPaymentReport = (r) => (
    <div className="reports-view">
      <div className="report-section">
        <div className="section-header">
          <h2>Payment Methods</h2>
        </div>
        <div className="table-container">
          <table className="report-table">
            <thead><tr><th>Method</th><th>Count</th><th>Total</th></tr></thead>
            <tbody>
              {(r.payments || []).map(p => (
                <tr key={p._id}><td><span className="text-capitalize">{p._id}</span></td><td>{p.count}</td><td>{formatCurrency(p.totalAmount)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="report-section">
        <div className="section-header">
          <h2>Gateway Payments</h2>
        </div>
        <div className="table-container">
          <table className="report-table">
            <thead><tr><th>Gateway</th><th>Count</th><th>Total</th></tr></thead>
            <tbody>
              {(r.gatewayPayments || []).map(p => (
                <tr key={p._id}><td><span className="text-capitalize">{p._id}</span></td><td>{p.count}</td><td>{formatCurrency(p.totalAmount)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderTaxReport = (r) => (
    <div className="reports-view">
      <div className="report-section">
        <div className="section-header">
          <h2>Tax Summary</h2>
        </div>
        <div className="table-container">
          <table className="report-table">
            <thead><tr><th>Metric</th><th>Amount</th></tr></thead>
            <tbody>
              <tr><td>CGST</td><td>{formatCurrency(r.taxSummary?.totalCgst)}</td></tr>
              <tr><td>SGST</td><td>{formatCurrency(r.taxSummary?.totalSgst)}</td></tr>
              <tr><td>IGST</td><td>{formatCurrency(r.taxSummary?.totalIgst)}</td></tr>
              <tr><td>Total Tax</td><td>{formatCurrency(r.taxSummary?.totalTax)}</td></tr>
              <tr><td>Total Sales</td><td>{formatCurrency(r.taxSummary?.totalSales)}</td></tr>
              <tr><td>Total Discount</td><td>{formatCurrency(r.taxSummary?.totalDiscount)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="report-section">
        <div className="section-header">
          <h2>Tax by Rate</h2>
        </div>
        <div className="table-container">
          <table className="report-table">
            <thead><tr><th>Rate %</th><th>Taxable Amount</th><th>Tax Amount</th></tr></thead>
            <tbody>
              {(r.taxByRate || []).map(item => (
                <tr key={item._id}><td>{item._id}%</td><td>{formatCurrency(item.taxableAmount)}</td><td>{formatCurrency(item.taxAmount)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderStaffReport = (r) => (
    <div className="reports-view">
      <div className="report-section">
        <div className="section-header">
          <h2>Staff Performance</h2>
        </div>
        <div className="table-container">
          <table className="report-table">
            <thead><tr><th>Staff</th><th>Orders</th><th>Total Sales</th><th>Avg Order</th></tr></thead>
            <tbody>
              {(r.staffSales || []).map(s => (
                <tr key={s._id}><td>{s.staffName}</td><td>{s.orderCount}</td><td>{formatCurrency(s.totalSales)}</td><td>{formatCurrency(s.avgOrderValue)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderCustomerReport = (r) => (
    <div className="reports-view">
      <div className="report-section">
        <div className="section-header">
          <h2>Top Customers</h2>
        </div>
        <div className="table-container">
          <table className="report-table">
            <thead><tr><th>Name</th><th>Phone</th><th>Orders</th><th>Total Spent</th><th>Loyalty Tier</th><th>Last Order</th></tr></thead>
            <tbody>
              {(r.topCustomers || []).map(c => (
                <tr key={c._id}><td>{c.name}</td><td>{c.phone}</td><td>{c.orderCount}</td><td>{formatCurrency(c.totalSpent)}</td><td><span className="badge">{c.loyaltyTier}</span></td><td>{new Date(c.lastOrder).toLocaleDateString()}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="report-section">
        <div className="section-header">
          <h2>New vs Returning</h2>
        </div>
        <div className="table-container">
          <table className="report-table">
            <thead><tr><th>Type</th><th>Count</th><th>Sales</th></tr></thead>
            <tbody>
              {(r.newVsReturning || []).map(item => (
                <tr key={item._id}><td><span className="text-capitalize">{item._id}</span></td><td>{item.count}</td><td>{formatCurrency(item.sales)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderHourlyReport = (r) => (
    <div className="reports-view">
      <div className="report-section">
        <div className="section-header">
          <h2>Hourly Sales</h2>
        </div>
        <div className="table-container">
          <table className="report-table">
            <thead><tr><th>Hour</th><th>Orders</th><th>Sales</th></tr></thead>
            <tbody>
              {(r.hourly || []).map(h => (
                <tr key={h.hour}><td>{h.label}</td><td>{h.count}</td><td>{formatCurrency(h.sales)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const reportNavItems = [
    { key: "today", label: "Today", icon: <IconDashboard size={17} /> },
    { key: "dateRange", label: "Date Range", icon: <IconCalendar size={17} /> },
    { key: "category", label: "By Category", icon: <IconCategories size={17} /> },
    { key: "item", label: "By Item", icon: <IconMenu size={17} /> },
    { key: "payment", label: "Payments", icon: <IconCart size={17} /> },
    { key: "tax", label: "Tax / GST", icon: <IconReports size={17} /> },
    { key: "staff", label: "Staff", icon: <IconStaff size={17} /> },
    { key: "customer", label: "Customers", icon: <IconCustomers size={17} /> },
    { key: "hourly", label: "Hourly", icon: <IconClock size={17} /> },
  ];

  return (
    <div className="reports-page">
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p className="page-subtitle">Sales analytics and business insights</p>
        </div>
        <button className="btn btn-secondary" onClick={() => fetchReport(activeReport)} disabled={loading}>
          <IconRefresh size={15} /> Refresh
        </button>
      </div>

      {error && <div className="toast error">{error}</div>}

      <div className="reports-layout">
        <aside className="reports-sidebar">
          <nav className="report-nav">
            {reportNavItems.map(item => (
              <button
                key={item.key}
                className={activeReport === item.key ? "active" : ""}
                onClick={() => setActiveReport(item.key)}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>

          {["dateRange", "category", "item", "payment", "tax", "staff", "customer", "hourly"].includes(activeReport) && (
            <form onSubmit={handleDateRangeSubmit} className="date-range-form">
              <h4>Date Range</h4>
              <div className="input-row">
                <input className="form-input" type="date" value={dateRange.startDate} onChange={e => setDateRange(d => ({ ...d, startDate: e.target.value }))} required />
                <input className="form-input" type="date" value={dateRange.endDate} onChange={e => setDateRange(d => ({ ...d, endDate: e.target.value }))} required />
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={loading}>Apply</button>
            </form>
          )}
        </aside>

        <main className="reports-content">
          {loading && !reports[activeReport] ? (
            <div className="loading"><span className="spinner spinner-lg"></span><span>Loading report...</span></div>
          ) : (
            renderReport()
          )}
        </main>
      </div>
    </div>
  );
}