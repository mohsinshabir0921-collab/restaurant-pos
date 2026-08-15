import { useState, useEffect } from "react";
import { purchaseOrderAPI, inventoryAPI } from "../services/api";

const formatCurrency = (v) => `₹${Number(v||0).toLocaleString("en-IN")}`;
const statusColors = { draft: "gray", sent: "blue", partially_received: "orange", received: "green", cancelled: "red", on_hold: "purple" };

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingPO, setEditingPO] = useState(null);
  const [viewingPO, setViewingPO] = useState(null);
  const [activeTab, setActiveTab] = useState("list");
  const [statusFilter, setStatusFilter] = useState("");
  const [formData, setFormData] = useState({
    supplier: { name: "", contact: "", email: "", phone: "", address: "" },
    items: [], expectedDate: "", paymentTerms: "net_30", tax: 0, shipping: 0, discount: 0, notes: "", internalNotes: ""
  });

  const fetchData = async () => {
    try {
      const [o, i] = await Promise.all([
        purchaseOrderAPI.getAll({ status: statusFilter, limit: 100 }),
        inventoryAPI.getAll({ limit: 200 })
      ]);
      if (o.data.success) setOrders(o.data.orders);
      if (i.data.success) setInventoryItems(i.data.items);
    } catch (err) { setError("Failed to load"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [statusFilter]);

  const updateField = (field, value) => setFormData(d => ({ ...d, [field]: value }));
  const updateSupplier = (field, value) => setFormData(d => ({ ...d, supplier: { ...d.supplier, [field]: value } }));
  const updateNumberField = (field, value) => setFormData(d => ({ ...d, [field]: Number(value) || 0 }));
  const updateSupplierNumber = (field, value) => setFormData(d => ({ ...d, supplier: { ...d.supplier, [field]: Number(value) || 0 } }));

  const openModal = (po = null) => {
    if (po) {
      setEditingPO(po);
      setFormData({ ...po, items: po.items.map(it => ({ ...it, item: it.item._id || it.item })) });
    } else {
      setEditingPO(null);
      setFormData({ supplier: { name: "", contact: "", email: "", phone: "", address: "" }, items: [], expectedDate: "", paymentTerms: "net_30", tax: 0, shipping: 0, discount: 0, notes: "", internalNotes: "" });
    }
    setShowModal(true);
  };

  const viewPO = (po) => setViewingPO(po);

  const addItem = () => setFormData(d => ({ ...d, items: [...d.items, { item: "", orderedQty: 1, costPerUnit: 0, batchNumber: "", expiryDate: "", notes: "" }] }));
  const removeItem = (idx) => setFormData(d => ({ ...d, items: d.items.filter((_, i) => i !== idx) }));
  const updateItem = (idx, field, value) => setFormData(d => { const its = [...d.items]; its[idx] = { ...its[idx], [field]: value }; if (field === "orderedQty" || field === "costPerUnit") its[idx].totalCost = its[idx].orderedQty * its[idx].costPerUnit; return { ...d, items: its }; });

  const calcTotals = () => {
    const subtotal = formData.items.reduce((s, it) => s + (it.totalCost || it.orderedQty * it.costPerUnit), 0);
    const total = subtotal + Number(formData.tax) + Number(formData.shipping) - Number(formData.discount);
    return { subtotal, total };
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true); setError("");
    try {
      const data = { ...formData, items: formData.items.filter(i => i.item).map(i => ({ ...i, orderedQty: Number(i.orderedQty), costPerUnit: Number(i.costPerUnit), totalCost: Number(i.orderedQty) * Number(i.costPerUnit) })), tax: Number(formData.tax), shipping: Number(formData.shipping), discount: Number(formData.discount), expectedDate: formData.expectedDate ? new Date(formData.expectedDate) : null };
      if (editingPO) await purchaseOrderAPI.update(editingPO._id, data);
      else await purchaseOrderAPI.create(data);
      setShowModal(false); fetchData();
    } catch (err) { setError(err.response?.data?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  const handleSend = async (id) => { try { await purchaseOrderAPI.send(id); fetchData(); } catch (err) { setError(err.response?.data?.message || "Send failed"); } };
  const handleReceive = async (id) => {
    const po = orders.find(o => o._id === id); if (!po) return;
    const receivedItems = po.items.map(it => ({ itemId: it._id, qty: it.orderedQty - it.receivedQty }));
    try { await purchaseOrderAPI.receive(id, { items: receivedItems }); fetchData(); } catch (err) { setError(err.response?.data?.message || "Receive failed"); }
  };
  const handleCancel = async (id) => { const reason = prompt("Reason:"); if (!reason) return; try { await purchaseOrderAPI.cancel(id, { reason }); fetchData(); } catch (err) { setError(err.response?.data?.message || "Cancel failed"); } };
  const handleDelete = async (id) => { if (!confirm("Delete?")) return; try { await purchaseOrderAPI.delete(id); fetchData(); } catch (err) { setError(err.response?.data?.message || "Delete failed"); } };

  const totals = calcTotals();

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="purchase-orders-page">
      <div className="page-header"><h1>Purchase Orders</h1><button className="btn btn-primary" onClick={() => { setActiveTab("create"); openModal(); }}>Create PO</button></div>
      {error && <div className="toast error">{error}</div>}
      <div className="filters"><select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">All Status</option><option value="draft">Draft</option><option value="sent">Sent</option><option value="partially_received">Partial</option><option value="received">Received</option><option value="cancelled">Cancelled</option></select></div>

      {activeTab === "list" && (
        <div className="table-container"><table><thead><tr><th>PO #</th><th>Supplier</th><th>Date</th><th>Expected</th><th>Status</th><th>Total</th><th>Actions</th></tr></thead><tbody>
          {orders.map(po => (
            <tr key={po._id}>
              <td><strong>{po.poNumber}</strong></td>
              <td>{po.supplier.name}</td>
              <td>{new Date(po.orderDate).toLocaleDateString()}</td>
              <td>{po.expectedDate ? new Date(po.expectedDate).toLocaleDateString() : "-"}</td>
              <td><span className={`status-badge`} style={{background: statusColors[po.status]}}>{po.status.replace("_", " ")}</span></td>
              <td>{formatCurrency(po.total)}</td>
              <td>
                <button className="btn btn-sm btn-secondary" onClick={() => viewPO(po)}>View</button>
                {po.status === "draft" && <button className="btn btn-sm btn-primary" onClick={() => handleSend(po._id)}>Send</button>}
                {(po.status === "sent" || po.status === "partially_received") && <button className="btn btn-sm btn-success" onClick={() => handleReceive(po._id)}>Receive</button>}
                {!["received", "cancelled"].includes(po.status) && <button className="btn btn-sm btn-danger" onClick={() => handleCancel(po._id)}>Cancel</button>}
                {["draft", "cancelled"].includes(po.status) && <button className="btn btn-sm btn-secondary" onClick={() => openModal(po)}>Edit</button>}
                {["draft", "cancelled"].includes(po.status) && <button className="btn btn-sm btn-danger" onClick={() => handleDelete(po._id)}>Delete</button>}
              </td>
            </tr>
          ))}
        </tbody></table></div>
      )}

      {(activeTab === "create" || editingPO) && showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); setEditingPO(null); setActiveTab("list"); }}>
          <div className="modal xl" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>{editingPO ? "Edit PO" : "Create Purchase Order"}</h3><button onClick={() => { setShowModal(false); setEditingPO(null); setActiveTab("list"); }}>×</button></div>
            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                <div className="form-group"><label>Supplier Name *</label><input value={formData.supplier.name} onChange={e => updateSupplier("name", e.target.value)} required /></div>
                <div className="form-group"><label>Contact</label><input value={formData.supplier.contact} onChange={e => updateSupplier("contact", e.target.value)} /></div>
                <div className="form-group"><label>Email</label><input type="email" value={formData.supplier.email} onChange={e => updateSupplier("email", e.target.value)} /></div>
                <div className="form-group"><label>Phone</label><input value={formData.supplier.phone} onChange={e => updateSupplier("phone", e.target.value)} /></div>
                <div className="form-group"><label>Address</label><textarea value={formData.supplier.address} onChange={e => updateSupplier("address", e.target.value)} rows={2} /></div>
                <div className="form-group"><label>Expected Date</label><input type="date" value={formData.expectedDate} onChange={e => updateField("expectedDate", e.target.value)} /></div>
                <div className="form-group"><label>Payment Terms</label><select value={formData.paymentTerms} onChange={e => updateField("paymentTerms", e.target.value)}><option value="cod">COD</option><option value="net_7">Net 7</option><option value="net_15">Net 15</option><option value="net_30">Net 30</option><option value="prepaid">Prepaid</option></select></div>
                <div className="form-group"><label>Tax</label><input type="number" step="0.01" value={formData.tax} onChange={e => updateNumberField("tax", e.target.value)} /></div>
                <div className="form-group"><label>Shipping</label><input type="number" step="0.01" value={formData.shipping} onChange={e => updateNumberField("shipping", e.target.value)} /></div>
                <div className="form-group"><label>Discount</label><input type="number" step="0.01" value={formData.discount} onChange={e => updateNumberField("discount", e.target.value)} /></div>
              </div>
              <div className="form-group full-width"><label>Items</label>
                {formData.items.map((it, idx) => (
                  <div key={idx} className="ingredient-row">
                    <select value={it.item} onChange={e => updateItem(idx, "item", e.target.value)}><option value="">Select Item</option>{inventoryItems.map(i => <option key={i._id} value={i._id}>{i.name} ({i.unit}) - Stock: {i.currentStock}</option>)}</select>
                    <input type="number" min="1" placeholder="Qty" value={it.orderedQty} onChange={e => updateItem(idx, "orderedQty", e.target.value)} />
                    <input type="number" step="0.01" min="0" placeholder="Cost/Unit" value={it.costPerUnit} onChange={e => updateItem(idx, "costPerUnit", e.target.value)} />
                    <input type="text" placeholder="Batch" value={it.batchNumber} onChange={e => updateItem(idx, "batchNumber", e.target.value)} />
                    <input type="date" placeholder="Expiry" value={it.expiryDate} onChange={e => updateItem(idx, "expiryDate", e.target.value)} />
                    <input type="text" placeholder="Notes" value={it.notes} onChange={e => updateItem(idx, "notes", e.target.value)} />
                    <span className="item-total">{formatCurrency(it.orderedQty * it.costPerUnit)}</span>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => removeItem(idx)}>Remove</button>
                  </div>
                ))}
                <button type="button" className="btn btn-secondary btn-sm" onClick={addItem}>+ Add Item</button>
              </div>
              <div className="form-group full-width"><label>Notes</label><textarea value={formData.notes} onChange={e => updateField("notes", e.target.value)} rows={2} /></div>
              <div className="form-group full-width"><label>Internal Notes</label><textarea value={formData.internalNotes} onChange={e => updateField("internalNotes", e.target.value)} rows={2} /></div>
              <div className="totals-row"><strong>Subtotal: {formatCurrency(totals.subtotal)}</strong> <strong>Total: {formatCurrency(totals.total)}</strong></div>
              <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => { setShowModal(false); setEditingPO(null); setActiveTab("list"); }}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save"}</button></div>
            </form>
          </div>
        </div>
      )}

      {viewingPO && (
        <div className="modal-overlay" onClick={() => setViewingPO(null)}>
          <div className="modal large" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>PO: {viewingPO.poNumber}</h3><button onClick={() => setViewingPO(null)}>×</button></div>
            <div className="po-detail">
              <div className="detail-section"><h4>Supplier</h4><p><strong>{viewingPO.supplier.name}</strong></p><p>{viewingPO.supplier.contact}</p><p>{viewingPO.supplier.email}</p><p>{viewingPO.supplier.phone}</p><p>{viewingPO.supplier.address}</p></div>
              <div className="detail-section"><h4>Details</h4><p>Status: <span className={`status-badge`} style={{background: statusColors[viewingPO.status]}}>{viewingPO.status}</span></p><p>Order Date: {new Date(viewingPO.orderDate).toLocaleString()}</p><p>Expected: {viewingPO.expectedDate ? new Date(viewingPO.expectedDate).toLocaleDateString() : "-"}</p><p>Payment Terms: {viewingPO.paymentTerms}</p></div>
              <div className="detail-section"><h4>Items</h4><table><thead><tr><th>Item</th><th>Ordered</th><th>Received</th><th>Cost/Unit</th><th>Total</th></tr></thead><tbody>
                {viewingPO.items.map((it, idx) => (
                  <tr key={idx}><td>{it.item?.name}</td><td>{it.orderedQty} {it.unit}</td><td>{it.receivedQty} {it.unit}</td><td>{formatCurrency(it.costPerUnit)}</td><td>{formatCurrency(it.totalCost)}</td></tr>
                ))}
              </tbody></table></div>
              <div className="detail-section"><h4>Totals</h4><p>Subtotal: {formatCurrency(viewingPO.subtotal)}</p><p>Tax: {formatCurrency(viewingPO.tax)}</p><p>Shipping: {formatCurrency(viewingPO.shipping)}</p><p>Discount: {formatCurrency(viewingPO.discount)}</p><p><strong>Total: {formatCurrency(viewingPO.total)}</strong></p></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}