import { useState, useEffect } from "react";
import { customerAPI } from "../services/api";
import SearchBox from "../components/SearchBox";

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;

export default function CustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [viewingCustomer, setViewingCustomer] = useState(null);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  const fetchCustomers = async () => {
    try {
      setLoading(true);
      const res = await customerAPI.getAll({ page, limit: 20, search });
      if (res.data.success) {
        setCustomers(res.data.customers);
        setTotalPages(res.data.pagination.pages);
      }
    } catch (err) {
      setError("Failed to load customers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, [page, search]);

  const handleSearch = (val) => {
    setSearch(typeof val === "string" ? val : val.target.value);
    setPage(1);
  };

  const viewCustomer = async (id) => {
    try {
      const res = await customerAPI.getById(id);
      if (res.data.success) {
        setViewingCustomer(res.data.customer);
        setShowModal(true);
      }
    } catch (err) {
      setError("Failed to load customer details");
    }
  };

  const handleRedeemPoints = async (id, points) => {
    if (!confirm(`Redeem ${points} loyalty points?`)) return;
    try {
      await customerAPI.redeemPoints(id, points);
      fetchCustomers();
      if (viewingCustomer?._id === id) {
        const res = await customerAPI.getById(id);
        if (res.data.success) setViewingCustomer(res.data.customer);
      }
    } catch (err) {
      setError(err.response?.data?.message || "Redemption failed");
    }
  };

  const handleAddPoints = async (id, points) => {
    // Would need a backend endpoint for manual points addition
    alert("Manual points addition requires backend endpoint");
  };

  const toggleSelection = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const handleSelectAll = () => {
    if (selectedIds.size === customers.length && customers.length > 0) setSelectedIds(new Set());
    else setSelectedIds(new Set(customers.map((c) => c._id)));
  };
  const handleDeselectAll = () => setSelectedIds(new Set());
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    setError("");
    setBulkResult(null);
    try {
      const res = await customerAPI.bulkDelete([...selectedIds]);
      setBulkResult(res.data);
      if (res.data.blocked?.length) {
        setError(`${res.data.blocked.length} customer(s) blocked: ${res.data.blocked.map((b) => `${b.name}: ${b.reason}`).join("; ")}`);
      } else {
        setError("");
      }
      setSelectedIds(new Set());
      setShowBulkConfirm(false);
      await fetchCustomers();
    } catch (err) {
      setError(err.response?.data?.message || "Bulk delete failed");
    } finally {
      setBulkDeleting(false);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="customers-page">
      <div className="page-header">
        <h1>Customer Management</h1>
        <SearchBox
          value={search}
          onChange={handleSearch}
          placeholder="Search by name, phone, email…"
          ariaLabel="Search customers"
        />
      </div>

      {error && <div className="toast error">{error}</div>}
      {bulkResult && !error && bulkResult.deletedCount > 0 && (
        <div className="toast success">{bulkResult.deletedCount} customer(s) deleted.</div>
      )}
      {customers.length > 0 && (
        <div className="bulk-toolbar" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 0", borderTop: "1px solid #e5e7eb", borderBottom: "1px solid #e5e7eb", margin: "10px 0" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none" }}>
            <input type="checkbox" checked={customers.length > 0 && selectedIds.size === customers.length} onChange={handleSelectAll} aria-label={selectedIds.size === customers.length ? "Deselect all" : "Select all"} style={{ width: 18, height: 18, cursor: "pointer" }} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>{selectedIds.size === customers.length ? "Deselect All" : "Select All"}</span>
          </label>
          <span style={{ fontSize: 13, color: "#6b7280" }}>{selectedIds.size} selected</span>
          <button className="btn btn-sm btn-danger" disabled={selectedIds.size === 0 || bulkDeleting} onClick={() => setShowBulkConfirm(true)} style={{ marginLeft: 8, opacity: selectedIds.size === 0 ? 0.5 : 1 }}>
            {bulkDeleting ? "Deleting…" : `Delete Selected${selectedIds.size ? ` (${selectedIds.size})` : ""}`}
          </button>
          {selectedIds.size > 0 && <button className="btn btn-sm btn-secondary" onClick={handleDeselectAll} disabled={bulkDeleting}>Clear Selection</button>}
        </div>
      )}

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input type="checkbox" checked={customers.length > 0 && selectedIds.size === customers.length} onChange={handleSelectAll} aria-label="Select all customers" style={{ width: 16, height: 16, cursor: "pointer" }} />
              </th>
              <th>Name</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Visits</th>
              <th>Total Spent</th>
              <th>Loyalty Points</th>
              <th>Tier</th>
              <th>Last Visit</th>
              <th>Actions</th>
            </tr>
          </thead>
              <tbody>
                {customers.length === 0 ? (
                  <tr><td colSpan={10} className="no-results">No customers found.</td></tr>
                ) : (
                  customers.map(customer => (
                  <tr key={customer._id} style={selectedIds.has(customer._id) ? { background: "#f0fdfa" } : undefined}>
                    <td><input type="checkbox" checked={selectedIds.has(customer._id)} onChange={() => toggleSelection(customer._id)} aria-label={`Select ${customer.name}`} style={{ width: 16, height: 16, cursor: "pointer" }} /></td>
                    <td>{customer.name}</td>
                    <td>{customer.phone}</td>
                    <td>{customer.email || "-"}</td>
                    <td>{customer.visitCount}</td>
                    <td>{formatCurrency(customer.totalSpent)}</td>
                    <td>{customer.loyaltyPoints}</td>
                    <td><span className={`tier-badge ${customer.loyaltyTier}`}>{customer.loyaltyTier}</span></td>
                    <td>{customer.lastVisit ? new Date(customer.lastVisit).toLocaleDateString() : "Never"}</td>
                    <td>
                      <button className="btn btn-sm btn-secondary" onClick={() => viewCustomer(customer._id)}>View</button>
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
        </table>
      </div>

      <div className="pagination">
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</button>
        <span>Page {page} of {totalPages}</span>
        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</button>
      </div>

      {showBulkConfirm && (
        <div className="modal-overlay" onClick={() => !bulkDeleting && setShowBulkConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h3>Delete {selectedIds.size} selected records?</h3><button onClick={() => setShowBulkConfirm(false)} disabled={bulkDeleting}>×</button></div>
            <div className="modal-body"><p>Delete {selectedIds.size} selected customer{selectedIds.size === 1 ? "" : "s"}? Customers with linked orders, payments or notifications will be blocked and not deleted.</p></div>
            <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setShowBulkConfirm(false)} disabled={bulkDeleting}>Cancel</button><button className="btn btn-danger" onClick={handleBulkDelete} disabled={bulkDeleting}>{bulkDeleting ? "Deleting…" : "Delete"}</button></div>
          </div>
        </div>
      )}

      {showModal && viewingCustomer && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); setViewingCustomer(null); }}>
          <div className="modal large" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{viewingCustomer.name}</h3>
              <button onClick={() => { setShowModal(false); setViewingCustomer(null); }}>×</button>
            </div>
            <div className="customer-detail">
              <div className="detail-section">
                <h4>Contact Info</h4>
                <p><strong>Phone:</strong> {viewingCustomer.phone}</p>
                <p><strong>Email:</strong> {viewingCustomer.email || "Not provided"}</p>
                <p><strong>GSTIN:</strong> {viewingCustomer.gstin || "Not provided"}</p>
              </div>
              <div className="detail-section">
                <h4>Loyalty</h4>
                <p><strong>Points:</strong> {viewingCustomer.loyaltyPoints}</p>
                <p><strong>Tier:</strong> <span className={`tier-badge ${viewingCustomer.loyaltyTier}`}>{viewingCustomer.loyaltyTier}</span></p>
                <p><strong>Total Spent:</strong> {formatCurrency(viewingCustomer.totalSpent)}</p>
                <p><strong>Visits:</strong> {viewingCustomer.visitCount}</p>
                <div className="loyalty-actions">
                  <input type="number" placeholder="Points to redeem" onKeyDown={e => e.key === "Enter" && handleRedeemPoints(viewingCustomer._id, Number(e.target.value))} />
                  <button className="btn btn-secondary" onClick={() => handleAddPoints(viewingCustomer._id, 100)}>Add 100 Points</button>
                </div>
              </div>
              <div className="detail-section">
                <h4>Addresses</h4>
                {viewingCustomer.addresses?.length > 0 ? (
                  viewingCustomer.addresses.map((addr, i) => (
                    <div key={i} className="address-card">
                      <strong>{addr.label}</strong>
                      <p>{addr.line1}, {addr.city} - {addr.pincode}</p>
                      {addr.isDefault && <span className="default-badge">Default</span>}
                    </div>
                  ))
                ) : (
                  <p>No addresses saved</p>
                )}
              </div>
              <div className="detail-section">
                <h4>Preferences</h4>
                <p><strong>Dietary:</strong> {viewingCustomer.dietaryPreferences?.join(", ") || "None"}</p>
                <p><strong>Allergies:</strong> {viewingCustomer.allergies?.join(", ") || "None"}</p>
                <p><strong>Preferred Payment:</strong> {viewingCustomer.preferredPaymentMethod}</p>
              </div>
              <div className="detail-section">
                <h4>Special Dates</h4>
                <p><strong>Birthday:</strong> {viewingCustomer.birthday ? new Date(viewingCustomer.birthday).toLocaleDateString() : "Not set"}</p>
                <p><strong>Anniversary:</strong> {viewingCustomer.anniversary ? new Date(viewingCustomer.anniversary).toLocaleDateString() : "Not set"}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}