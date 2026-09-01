import { useState, useEffect } from "react";
import { wasteAPI, inventoryAPI } from "../services/api";

const formatCurrency = (v) => `₹${Number(v||0).toLocaleString("en-IN")}`;
const reasons = ["expired", "spoiled", "damaged", "overcooked", "wrong_order", "customer_return", "quality", "theft", "other"];

export default function WasteLogPage() {
  const [logs, setLogs] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingLog, setEditingLog] = useState(null);
  const [viewingLog, setViewingLog] = useState(null);
  const [activeTab, setActiveTab] = useState("list");
  const [reasonFilter, setReasonFilter] = useState("");
  const [approvedFilter, setApprovedFilter] = useState("");
  const [formData, setFormData] = useState({ items: [], reason: "", reasonDetail: "", location: "", notes: "" });
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  const fetchData = async () => {
    try {
      const [l, i] = await Promise.all([
        wasteAPI.getAll({ reason: reasonFilter, isApproved: approvedFilter || undefined, limit: 100 }),
        inventoryAPI.getAll({ limit: 200 })
      ]);
      if (l.data.success) setLogs(l.data.logs);
      if (i.data.success) setInventoryItems(i.data.items);
    } catch (err) { setError("Failed to load"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [reasonFilter, approvedFilter]);

  const openModal = (log = null) => {
    if (log) { setEditingLog(log); setFormData({ ...log, items: log.items.map(it => ({ ...it, item: it.item._id || it.item })) }); }
    else { setEditingLog(null); setFormData({ items: [], reason: "", reasonDetail: "", location: "", notes: "" }); }
    setShowModal(true); setActiveTab("create");
  };

  const viewLog = (log) => setViewingLog(log);

  const addItem = () => setFormData(d => ({ ...d, items: [...d.items, { item: "", quantity: 0, batchNumber: "", expiryDate: "" }] }));
  const removeItem = (idx) => setFormData(d => ({ ...d, items: d.items.filter((_, i) => i !== idx) }));
  const updateItem = (idx, field, value) => setFormData(d => { const its = [...d.items]; its[idx] = { ...its[idx], [field]: value }; return { ...d, items: its }; });

  const calcTotals = () => {
    let totalQty = 0, totalCost = 0;
    formData.items.forEach(it => { if (it.item) { const inv = inventoryItems.find(i => i._id === it.item); if (inv) { it.unitCost = inv.costPerUnit; it.totalCost = it.quantity * inv.costPerUnit; totalQty += it.quantity; totalCost += it.totalCost; } } });
    return { totalQty, totalCost };
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true); setError("");
    try {
      const data = { ...formData, items: formData.items.filter(i => i.item).map(i => ({ ...i, quantity: Number(i.quantity), unitCost: Number(i.unitCost), totalCost: Number(i.totalCost) })) };
      if (editingLog) await wasteAPI.update(editingLog._id, data);
      else await wasteAPI.create(data);
      setShowModal(false); fetchData();
    } catch (err) { setError(err.response?.data?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  const handleApprove = async (id) => { try { await wasteAPI.approve(id); fetchData(); } catch (err) { setError(err.response?.data?.message || "Approve failed"); } };
  const handleDelete = async (id) => { if (!confirm("Delete?")) return; try { await wasteAPI.delete(id); fetchData(); } catch (err) { setError(err.response?.data?.message || "Delete failed"); } };
  const toggleSelection = (id) => setSelectedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const handleSelectAll = () => { if (selectedIds.size === logs.length && logs.length > 0) setSelectedIds(new Set()); else setSelectedIds(new Set(logs.map((l) => l._id))); };
  const handleDeselectAll = () => setSelectedIds(new Set());
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true); setError(""); setBulkResult(null);
    try {
      const res = await wasteAPI.bulkDelete([...selectedIds]);
      setBulkResult(res.data);
      if (res.data.blocked?.length) setError(`${res.data.blocked.length} waste log(s) blocked: ${res.data.blocked.map((b) => `${b.wasteNumber}: ${b.reason}`).join("; ")}`);
      setSelectedIds(new Set()); setShowBulkConfirm(false); await fetchData();
    } catch (err) { setError(err.response?.data?.message || "Bulk delete failed"); } finally { setBulkDeleting(false); }
  };

  const totals = calcTotals();

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="waste-log-page">
      <div className="page-header"><h1>Waste Log</h1><button className="btn btn-primary" onClick={() => { setActiveTab("create"); openModal(); }}>Log Waste</button></div>
      {error && <div className="toast error">{error}</div>}
      {bulkResult && !error && bulkResult.deletedCount > 0 && <div className="toast success">{bulkResult.deletedCount} waste log(s) deleted.</div>}
      <div className="filters">
        <select value={reasonFilter} onChange={e => setReasonFilter(e.target.value)}><option value="">All Reasons</option>{reasons.map(r => <option key={r} value={r}>{r}</option>)}</select>
        <select value={approvedFilter} onChange={e => setApprovedFilter(e.target.value)}><option value="">All</option><option value="true">Approved</option><option value="false">Pending</option></select>
      </div>
      {logs.length > 0 && (
        <div className="bulk-toolbar" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 0", borderTop: "1px solid #e5e7eb", borderBottom: "1px solid #e5e7eb", margin: "10px 0" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none" }}>
            <input type="checkbox" checked={logs.length > 0 && selectedIds.size === logs.length} onChange={handleSelectAll} aria-label={selectedIds.size === logs.length ? "Deselect all" : "Select all"} style={{ width: 18, height: 18, cursor: "pointer" }} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>{selectedIds.size === logs.length ? "Deselect All" : "Select All"}</span>
          </label>
          <span style={{ fontSize: 13, color: "#6b7280" }}>{selectedIds.size} selected</span>
          <button className="btn btn-sm btn-danger" disabled={selectedIds.size === 0 || bulkDeleting} onClick={() => setShowBulkConfirm(true)} style={{ marginLeft: 8, opacity: selectedIds.size === 0 ? 0.5 : 1 }}>
            {bulkDeleting ? "Deleting…" : `Delete Selected${selectedIds.size ? ` (${selectedIds.size})` : ""}`}
          </button>
          {selectedIds.size > 0 && <button className="btn btn-sm btn-secondary" onClick={handleDeselectAll} disabled={bulkDeleting}>Clear Selection</button>}
        </div>
      )}

      {activeTab === "list" && (
        <div className="table-container"><table><thead><tr><th style={{ width: 36 }}><input type="checkbox" checked={logs.length > 0 && selectedIds.size === logs.length} onChange={handleSelectAll} aria-label="Select all waste logs" style={{ width: 16, height: 16, cursor: "pointer" }} /></th><th>Waste #</th><th>Date</th><th>Reason</th><th>Items</th><th>Qty</th><th>Cost</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {logs.map(log => (
            <tr key={log._id} style={selectedIds.has(log._id) ? { background: "#f0fdfa" } : undefined}>
              <td><input type="checkbox" checked={selectedIds.has(log._id)} onChange={() => toggleSelection(log._id)} aria-label={`Select ${log.wasteNumber}`} style={{ width: 16, height: 16, cursor: "pointer" }} /></td>
              <td><strong>{log.wasteNumber}</strong></td>
              <td>{new Date(log.wasteDate).toLocaleDateString()}</td>
              <td><span className="category-badge">{log.reason}</span></td>
              <td>{log.items.map(it => it.item?.name).join(", ")}</td>
              <td>{log.totalQuantity}</td>
              <td>{formatCurrency(log.totalCost)}</td>
              <td><span className={`status-badge ${log.isApproved ? "active" : "pending"}`}>{log.isApproved ? "Approved" : "Pending"}</span></td>
              <td>
                <button className="btn btn-sm btn-secondary" onClick={() => viewLog(log)}>View</button>
                {!log.isApproved && <button className="btn btn-sm btn-success" onClick={() => handleApprove(log._id)}>Approve</button>}
                {!log.isApproved && <button className="btn btn-sm btn-secondary" onClick={() => openModal(log)}>Edit</button>}
                {!log.isApproved && <button className="btn btn-sm btn-danger" onClick={() => handleDelete(log._id)}>Delete</button>}
              </td>
            </tr>
          ))}
        </tbody></table></div>
      )}

      {(activeTab === "create" || editingLog) && showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); setEditingLog(null); setActiveTab("list"); }}>
          <div className="modal xl" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>{editingLog ? "Edit Waste Log" : "Log Waste"}</h3><button onClick={() => { setShowModal(false); setEditingLog(null); setActiveTab("list"); }}>×</button></div>
            <form onSubmit={handleSubmit}>
              <div className="form-group full-width"><label>Items</label>
                {formData.items.map((it, idx) => (
                  <div key={idx} className="ingredient-row">
                    <select value={it.item} onChange={e => updateItem(idx, "item", e.target.value)}><option value="">Select Item</option>{inventoryItems.map(i => <option key={i._id} value={i._id}>{i.name} ({i.unit}) - Stock: {i.currentStock}</option>)}</select>
                    <input type="number" step="any" min="0" placeholder="Qty" value={it.quantity} onChange={e => updateItem(idx, "quantity", e.target.value)} />
                    <input type="text" placeholder="Batch #" value={it.batchNumber} onChange={e => updateItem(idx, "batchNumber", e.target.value)} />
                    <input type="date" placeholder="Expiry" value={it.expiryDate} onChange={e => updateItem(idx, "expiryDate", e.target.value)} />
                    <span className="item-cost">{it.unitCost ? formatCurrency(it.totalCost) : "-"}</span>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => removeItem(idx)}>Remove</button>
                  </div>
                ))}
                <button type="button" className="btn btn-secondary btn-sm" onClick={addItem}>+ Add Item</button>
              </div>
              <div className="form-grid">
                <div className="form-group"><label>Reason *</label><select value={formData.reason} onChange={e => setFormData(d => ({...d, reason: e.target.value}))} required>{reasons.map(r => <option key={r} value={r}>{r}</option>)}</select></div>
                <div className="form-group"><label>Location</label><input value={formData.location} onChange={e => setFormData(d => ({...d, location: e.target.value}))} /></div>
                <div className="form-group full-width"><label>Detail</label><textarea value={formData.reasonDetail} onChange={e => setFormData(d => ({...d, reasonDetail: e.target.value}))} rows={2} /></div>
                <div className="form-group full-width"><label>Notes</label><textarea value={formData.notes} onChange={e => setFormData(d => ({...d, notes: e.target.value}))} rows={2} /></div>
              </div>
              <div className="totals-row"><strong>Total Qty: {totals.totalQty}</strong> <strong>Est. Cost: {formatCurrency(totals.totalCost)}</strong></div>
              <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => { setShowModal(false); setEditingLog(null); setActiveTab("list"); }}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save"}</button></div>
            </form>
          </div>
        </div>
      )}

      {showBulkConfirm && (
        <div className="modal-overlay" onClick={() => !bulkDeleting && setShowBulkConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h3>Delete {selectedIds.size} selected records?</h3><button onClick={() => setShowBulkConfirm(false)} disabled={bulkDeleting}>×</button></div>
            <div className="modal-body"><p>Delete {selectedIds.size} selected waste log{selectedIds.size === 1 ? "" : "s"}? Approved logs (inventory already deducted) will be blocked.</p></div>
            <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setShowBulkConfirm(false)} disabled={bulkDeleting}>Cancel</button><button className="btn btn-danger" onClick={handleBulkDelete} disabled={bulkDeleting}>{bulkDeleting ? "Deleting…" : "Delete"}</button></div>
          </div>
        </div>
      )}

      {viewingLog && (
        <div className="modal-overlay" onClick={() => setViewingLog(null)}>
          <div className="modal large" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Waste: {viewingLog.wasteNumber}</h3><button onClick={() => setViewingLog(null)}>×</button></div>
            <div className="po-detail">
              <div className="detail-section"><h4>Items</h4><table><thead><tr><th>Item</th><th>Qty</th><th>Unit Cost</th><th>Total</th></tr></thead><tbody>
                {viewingLog.items.map((it, idx) => (<tr key={idx}><td>{it.item?.name}</td><td>{it.quantity}</td><td>{formatCurrency(it.unitCost)}</td><td>{formatCurrency(it.totalCost)}</td></tr>))}
              </tbody></table></div>
              <div className="detail-section"><h4>Details</h4><p>Reason: <span className="category-badge">{viewingLog.reason}</span></p><p>Detail: {viewingLog.reasonDetail}</p><p>Location: {viewingLog.location}</p><p>Status: <span className={`status-badge ${viewingLog.isApproved ? "active" : "pending"}`}>{viewingLog.isApproved ? "Approved" : "Pending"}</span></p><p>Reported: {new Date(viewingLog.wasteDate).toLocaleString()}</p><p>Approved: {viewingLog.approvedAt ? new Date(viewingLog.approvedAt).toLocaleString() : "Not yet"}</p></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}