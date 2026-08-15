import { useState, useEffect } from "react";
import { inventoryAPI } from "../services/api";

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;

export default function InventoryPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [activeTab, setActiveTab] = useState("list");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [formData, setFormData] = useState({
    name: "", sku: "", unit: "kg", category: "vegetables",
    currentStock: 0, minStock: 10, maxStock: 1000, reorderLevel: 20,
    costPerUnit: 0, sellingPrice: 0, 
    supplier: { name: "", contact: "", email: "", leadTimeDays: 2 },
    storageLocation: "", expiryTracking: false, batchTracking: false, isActive: true, notes: ""
  });

  const fetchItems = async () => {
    try {
      const params = { search, limit: 200 };
      if (categoryFilter) params.category = categoryFilter;
      if (lowStockOnly) params.lowStock = "true";
      const res = await inventoryAPI.getAll(params);
      if (res.data.success) setItems(res.data.items);
    } catch (err) {
      setError("Failed to load inventory");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchItems(); }, [search, categoryFilter, lowStockOnly]);

  const categories = [...new Set(items.map(i => i.category))].sort();

  const updateField = (field, value) => setFormData(d => ({ ...d, [field]: value }));
  const updateSupplier = (field, value) => setFormData(d => ({ ...d, supplier: { ...d.supplier, [field]: value } }));
  const updateNumberField = (field, value) => setFormData(d => ({ ...d, [field]: Number(value) || 0 }));
  const updateSupplierNumber = (field, value) => setFormData(d => ({ ...d, supplier: { ...d.supplier, [field]: Number(value) || 0 } }));
  const updateBooleanField = (field, value) => setFormData(d => ({ ...d, [field]: value === "true" }));
  const updateSupplierBoolean = (field, value) => setFormData(d => ({ ...d, supplier: { ...d.supplier, [field]: value === "true" } }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const data = { ...formData };
      if (editingItem) await inventoryAPI.update(editingItem._id, data);
      else await inventoryAPI.create(data);
      setShowModal(false);
      fetchItems();
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
    } finally { setSaving(false); }
  };

  const openModal = (item = null) => {
    setError("");
    if (item) {
      setEditingItem(item);
      setFormData({ 
        name: item.name, sku: item.sku || "", unit: item.unit, category: item.category,
        currentStock: item.currentStock, minStock: item.minStock, maxStock: item.maxStock, reorderLevel: item.reorderLevel,
        costPerUnit: item.costPerUnit, sellingPrice: item.sellingPrice,
        supplier: item.supplier || { name: "", contact: "", email: "", leadTimeDays: 2 },
        storageLocation: item.storageLocation || "", expiryTracking: item.expiryTracking || false, batchTracking: item.batchTracking || false, isActive: item.isActive !== false, notes: item.notes || ""
      });
    } else {
      setEditingItem(null);
      setFormData({ name: "", sku: "", unit: "kg", category: "vegetables", currentStock: 0, minStock: 10, maxStock: 1000, reorderLevel: 20, costPerUnit: 0, sellingPrice: 0, supplier: { name: "", contact: "", email: "", leadTimeDays: 2 }, storageLocation: "", expiryTracking: false, batchTracking: false, isActive: true, notes: "" });
    }
    setShowModal(true);
  };

  const handleAdjustStock = async (item, qty, reason) => {
    try {
      await inventoryAPI.adjust(item._id, { quantity: qty, reason, referenceType: "manual_adjustment" });
      fetchItems();
    } catch (err) { setError(err.response?.data?.message || "Adjustment failed"); }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this item?")) return;
    try { await inventoryAPI.delete(id); fetchItems(); } catch (err) { setError(err.response?.data?.message || "Delete failed"); }
  };

  if (loading) return <div className="loading">Loading...</div>;

  const lowStockItems = items.filter(i => i.isLowStock);
  const outOfStockItems = items.filter(i => i.isOutOfStock);

  return (
    <div className="inventory-page">
      <div className="page-header">
        <h1>Inventory Management</h1>
        <div className="header-stats">
          <span className="stat-chip"><strong>{items.length}</strong> items</span>
          <span className="stat-chip warn"><strong>{lowStockItems.length}</strong> low stock</span>
          <span className="stat-chip danger"><strong>{outOfStockItems.length}</strong> out of stock</span>
        </div>
        <button className="btn btn-primary" onClick={() => openModal()}>Add Item</button>
      </div>

      {error && <div className="toast error">{error}</div>}

      <div className="filters">
        <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label><input type="checkbox" checked={lowStockOnly} onChange={e => setLowStockOnly(e.target.checked)} /> Low Stock Only</label>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr><th>Name</th><th>SKU</th><th>Category</th><th>Unit</th><th>Stock</th><th>Min/Reorder</th><th>Cost/Unit</th><th>Value</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item._id} className={item.isOutOfStock ? "out-stock" : item.isLowStock ? "low-stock" : ""}>
                <td><strong>{item.name}</strong></td>
                <td>{item.sku || "-"}</td>
                <td><span className="category-badge">{item.category}</span></td>
                <td>{item.unit}</td>
                <td>{item.currentStock} {item.unit}</td>
                <td>{item.minStock} / {item.reorderLevel}</td>
                <td>{formatCurrency(item.costPerUnit)}</td>
                <td>{formatCurrency(item.stockValue)}</td>
                <td>
                  {item.isOutOfStock && <span className="status-badge out">Out of Stock</span>}
                  {item.isLowStock && !item.isOutOfStock && <span className="status-badge low">Low Stock</span>}
                  {!item.isLowStock && <span className="status-badge ok">OK</span>}
                </td>
                <td>
                  <button className="btn btn-sm btn-secondary" onClick={() => openModal(item)}>Edit</button>
                  <button className="btn btn-sm btn-info" onClick={() => {
                    const qty = prompt("Adjust quantity (+/-):");
                    const reason = prompt("Reason:");
                    if (qty) handleAdjustStock(item, Number(qty), reason || "Manual adjustment");
                  }}>Adjust</button>
                  <button className="btn btn-sm btn-danger" onClick={() => handleDelete(item._id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal large" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{editingItem ? "Edit Item" : "Add Inventory Item"}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)} aria-label="Close">
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                {error && <div className="toast error">{error}</div>}
                <div className="form-grid">
                  <div className="form-group"><label>Name *</label><input type="text" value={formData.name} onChange={e => updateField("name", e.target.value)} required /></div>
                  <div className="form-group"><label>SKU</label><input type="text" value={formData.sku} onChange={e => updateField("sku", e.target.value)} /></div>
                  <div className="form-group"><label>Category</label><select value={formData.category} onChange={e => updateField("category", e.target.value)}><option value="vegetables">Vegetables</option><option value="meat">Meat</option><option value="dairy">Dairy</option><option value="spices">Spices</option><option value="beverages">Beverages</option><option value="dry_goods">Dry Goods</option><option value="frozen">Frozen</option><option value="bakery">Bakery</option><option value="other">Other</option></select></div>
                  <div className="form-group"><label>Unit</label><select value={formData.unit} onChange={e => updateField("unit", e.target.value)}><option value="kg">kg</option><option value="g">g</option><option value="l">l</option><option value="ml">ml</option><option value="pcs">pcs</option><option value="pack">pack</option><option value="box">box</option><option value="dozen">dozen</option></select></div>
                  <div className="form-group"><label>Current Stock</label><input type="number" step="any" value={formData.currentStock} onChange={e => updateNumberField("currentStock", e.target.value)} /></div>
                  <div className="form-group"><label>Min Stock</label><input type="number" value={formData.minStock} onChange={e => updateNumberField("minStock", e.target.value)} /></div>
                  <div className="form-group"><label>Max Stock</label><input type="number" value={formData.maxStock} onChange={e => updateNumberField("maxStock", e.target.value)} /></div>
                  <div className="form-group"><label>Reorder Level</label><input type="number" value={formData.reorderLevel} onChange={e => updateNumberField("reorderLevel", e.target.value)} /></div>
                  <div className="form-group"><label>Cost/Unit</label><input type="number" step="0.01" value={formData.costPerUnit} onChange={e => updateNumberField("costPerUnit", e.target.value)} /></div>
                  <div className="form-group"><label>Selling Price</label><input type="number" step="0.01" value={formData.sellingPrice} onChange={e => updateNumberField("sellingPrice", e.target.value)} /></div>
                  <div className="form-group"><label>Supplier Name</label><input type="text" value={formData.supplier.name} onChange={e => updateSupplier("name", e.target.value)} /></div>
                  <div className="form-group"><label>Supplier Contact</label><input type="text" value={formData.supplier.contact} onChange={e => updateSupplier("contact", e.target.value)} /></div>
                  <div className="form-group"><label>Supplier Email</label><input type="email" value={formData.supplier.email} onChange={e => updateSupplier("email", e.target.value)} /></div>
                  <div className="form-group"><label>Lead Time (days)</label><input type="number" value={formData.supplier.leadTimeDays} onChange={e => updateSupplierNumber("leadTimeDays", e.target.value)} /></div>
                  <div className="form-group"><label>Storage Location</label><input type="text" value={formData.storageLocation} onChange={e => updateField("storageLocation", e.target.value)} /></div>
                  <div className="form-group"><label>Expiry Tracking</label><select value={formData.expiryTracking ? "true" : "false"} onChange={e => updateBooleanField("expiryTracking", e.target.value)}><option value="false">No</option><option value="true">Yes</option></select></div>
                  <div className="form-group"><label>Batch Tracking</label><select value={formData.batchTracking ? "true" : "false"} onChange={e => updateBooleanField("batchTracking", e.target.value)}><option value="false">No</option><option value="true">Yes</option></select></div>
                  <div className="form-group"><label>Active</label><select value={formData.isActive ? "true" : "false"} onChange={e => updateBooleanField("isActive", e.target.value)}><option value="true">Yes</option><option value="false">No</option></select></div>
                  <div className="form-group full-width"><label>Notes</label><textarea value={formData.notes} onChange={e => updateField("notes", e.target.value)} rows={2} /></div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? "Saving..." : editingItem ? "Update Item" : "Add Item"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}