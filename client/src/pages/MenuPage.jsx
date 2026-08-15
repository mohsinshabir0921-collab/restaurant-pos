import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { menuAPI, categoryAPI } from "../services/api";

export default function MenuPage() {
  const location = useLocation();
  const pendingItemId = useRef(location.state?.menuItemId || null);
  const [menuItems, setMenuItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    price: "",
    category: "",
    isVeg: true,
    spiceLevel: "none",
    prepTime: 10,
    isAvailable: true,
    taxRate: 0,
    image: "",
    displayOrder: 0,
    tags: "",
    modifiers: [],
  });

  const fetchData = async () => {
    try {
      const [menuRes, catRes] = await Promise.all([
        menuAPI.getAll({ limit: 200 }),
        categoryAPI.getAll({ activeOnly: "false" }),
      ]);
      if (menuRes.data.success) setMenuItems(menuRes.data.menuItems);
      if (catRes.data.success) setCategories(catRes.data.categories);
    } catch (err) {
      setError("Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const targetId = pendingItemId.current;
    if (!targetId || menuItems.length === 0) return;
    const item = menuItems.find((i) => i._id === targetId);
    if (!item) return;
    pendingItemId.current = null;
    openModal(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuItems]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    const data = {
      ...formData,
      price: Number(formData.price),
      prepTime: Number(formData.prepTime),
      taxRate: Number(formData.taxRate),
      displayOrder: Number(formData.displayOrder),
      tags: formData.tags.split(",").map(t => t.trim()).filter(Boolean),
      modifiers: formData.modifiers,
    };

    try {
      if (editingItem) {
        await menuAPI.update(editingItem._id, data);
      } else {
        await menuAPI.create(data);
      }
      setShowModal(false);
      fetchData();
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const openModal = (item = null) => {
    if (item) {
      setEditingItem(item);
      setFormData({
        name: item.name,
        description: item.description || "",
        price: item.price,
        category: item.category?._id || item.category || "",
        isVeg: item.isVeg !== false,
        spiceLevel: item.spiceLevel || "none",
        prepTime: item.prepTime || 10,
        isAvailable: item.isAvailable !== false,
        taxRate: item.taxRate || 0,
        image: item.image || "",
        displayOrder: item.displayOrder || 0,
        tags: (item.tags || []).join(", "),
        modifiers: item.modifiers || [],
      });
    } else {
      setEditingItem(null);
      setFormData({
        name: "",
        description: "",
        price: "",
        category: "",
        isVeg: true,
        spiceLevel: "none",
        prepTime: 10,
        isAvailable: true,
        taxRate: 0,
        image: "",
        displayOrder: 0,
        tags: "",
        modifiers: [],
      });
    }
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this menu item?")) return;
    try {
      await menuAPI.delete(id);
      fetchData();
    } catch (err) {
      setError(err.response?.data?.message || "Delete failed");
    }
  };

  const toggleAvailability = async (item) => {
    try {
      await menuAPI.toggleAvailability(item._id, !item.isAvailable);
      fetchData();
    } catch (err) {
      setError(err.response?.data?.message || "Update failed");
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="menu-page">
      <div className="page-header">
        <h1>Menu Management</h1>
        <button className="btn btn-primary" onClick={() => openModal()}>Add Menu Item</button>
      </div>

      {error && <div className="toast error">{error}</div>}

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Image</th>
              <th>Name</th>
              <th>Category</th>
              <th>Price</th>
              <th>Veg</th>
              <th>Spice</th>
              <th>Prep Time</th>
              <th>Available</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {menuItems.map(item => (
              <tr key={item._id}>
                <td>{item.image && <img src={item.image} alt={item.name} className="thumb" />}</td>
                <td>{item.name}</td>
                <td>{item.category?.name || item.category}</td>
                <td>₹{item.price}</td>
                <td>{item.isVeg ? "🟢" : "🔴"}</td>
                <td>{item.spiceLevel}</td>
                <td>{item.prepTime} min</td>
                <td>
                  <label className="toggle">
                    <input type="checkbox" checked={item.isAvailable} onChange={() => toggleAvailability(item)} />
                    <span className="slider"></span>
                  </label>
                </td>
                <td>
                  <button className="btn btn-sm btn-secondary" onClick={() => openModal(item)}>Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={() => handleDelete(item._id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingItem ? "Edit Menu Item" : "Add Menu Item"}</h3>
              <button onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Name *</label>
                  <input type="text" value={formData.name} onChange={e => setFormData(d => ({ ...d, name: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Category *</label>
                  <select value={formData.category} onChange={e => setFormData(d => ({ ...d, category: e.target.value }))} required>
                    <option value="">Select Category</option>
                    {categories.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Price *</label>
                  <input type="number" step="0.01" min="0" value={formData.price} onChange={e => setFormData(d => ({ ...d, price: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Prep Time (min)</label>
                  <input type="number" min="0" value={formData.prepTime} onChange={e => setFormData(d => ({ ...d, prepTime: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Veg</label>
                  <select value={formData.isVeg} onChange={e => setFormData(d => ({ ...d, isVeg: e.target.value === "true" }))}>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Spice Level</label>
                  <select value={formData.spiceLevel} onChange={e => setFormData(d => ({ ...d, spiceLevel: e.target.value }))}>
                    <option value="none">None</option>
                    <option value="mild">Mild</option>
                    <option value="medium">Medium</option>
                    <option value="hot">Hot</option>
                    <option value="extra_hot">Extra Hot</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Tax Rate %</label>
                  <input type="number" step="0.01" min="0" max="100" value={formData.taxRate} onChange={e => setFormData(d => ({ ...d, taxRate: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Display Order</label>
                  <input type="number" value={formData.displayOrder} onChange={e => setFormData(d => ({ ...d, displayOrder: e.target.value }))} />
                </div>
                <div className="form-group full-width">
                  <label>Description</label>
                  <textarea value={formData.description} onChange={e => setFormData(d => ({ ...d, description: e.target.value }))} rows={2} />
                </div>
                <div className="form-group full-width">
                  <label>Tags (comma separated)</label>
                  <input type="text" value={formData.tags} onChange={e => setFormData(d => ({ ...d, tags: e.target.value }))} />
                </div>
                <div className="form-group full-width">
                  <label>Image URL</label>
                  <input type="text" value={formData.image} onChange={e => setFormData(d => ({ ...d, image: e.target.value }))} />
                </div>
                <div className="form-group full-width">
                  <label>Available</label>
                  <select value={formData.isAvailable} onChange={e => setFormData(d => ({ ...d, isAvailable: e.target.value === "true" }))}>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}