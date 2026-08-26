import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { menuAPI, categoryAPI } from "../services/api";
import SearchBox from "../components/SearchBox";

export default function MenuPage() {
  const location = useLocation();
  const pendingItemId = useRef(location.state?.menuItemId || null);
  const [menuItems, setMenuItems] = useState([]);
  const [menuSearch, setMenuSearch] = useState("");
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
    displayOrder: "",
    tags: "",
    modifiers: [],
  });

  const fetchData = async () => {
    try {
      const catRes = await categoryAPI.getAll({ activeOnly: "false" });
      if (catRes.data.success) setCategories(catRes.data.categories);

      // Management must see the whole catalog (available + unavailable) so
      // items can be edited, re-ordered and re-enabled. The API caps each
      // page at MAX_LIMIT=100, so iterate pages until every item is loaded.
      const allItems = [];
      let page = 1;
      let total = Infinity;
      while (allItems.length < total) {
        const res = await menuAPI.getAll({ limit: 100, page, availableOnly: "false" });
        if (!res.data.success) break;
        const items = res.data.menuItems || [];
        total = res.data.pagination?.total ?? allItems.length + items.length;
        allItems.push(...items);
        if (items.length === 0 || allItems.length >= total) break;
        page += 1;
      }
      setMenuItems(allItems);
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

  const filteredMenuItems = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    if (!q) return menuItems;
    // Word-based prefix search: every typed word must match the start of a
    // word in the item name (case-insensitive). This avoids noisy substring
    // matches like a lone "t" hitting every dish.
    const queryWords = q.split(/[^a-z0-9]+/).filter(Boolean);
    return menuItems.filter(item => {
      const nameWords = (item.name || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      return queryWords.every(qw => nameWords.some(nw => nw.startsWith(qw)));
    });
  }, [menuItems, menuSearch]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    const data = {
      ...formData,
      price: Number(formData.price),
      prepTime: Number(formData.prepTime),
      taxRate: Number(formData.taxRate),
      tags: formData.tags.split(",").map(t => t.trim()).filter(Boolean),
      modifiers: formData.modifiers,
    };

    // Leave displayOrder unset for new items so the server assigns the next
    // slot instead of every new item colliding at order 0.
    if (formData.displayOrder === "") {
      delete data.displayOrder;
    } else {
      data.displayOrder = Number(formData.displayOrder);
    }

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
        displayOrder: item.displayOrder || "",
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
        displayOrder: "",
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
        <SearchBox
          value={menuSearch}
          onChange={setMenuSearch}
          placeholder="Search menu items…"
          ariaLabel="Search menu items"
        />
        <button className="btn btn-primary" onClick={() => openModal()}>Add Menu Item</button>
      </div>

      {error && <div className="toast error">{error}</div>}

      {menuItems.length === 0 ? (
        <div className="empty-state">No menu items yet. Click "Add Menu Item" to create one.</div>
      ) : filteredMenuItems.length === 0 ? (
        <div className="empty-state">No menu items found.</div>
      ) : (
        <div className="menu-items-grid">
          {filteredMenuItems.map(item => {
            const catName = item.category?.name || item.category;
            return (
              <div key={item._id} className="menu-item-card">
                <div className="menu-item-header">
                  {item.image ? (
                    <img src={item.image} alt={item.name} className="menu-item-image" />
                  ) : (
                    <div className="menu-item-image menu-item-image-fallback">{item.name.charAt(0).toUpperCase()}</div>
                  )}
                  <div className="menu-item-info">
                    <h4>{item.name}</h4>
                    {item.description && <p>{item.description}</p>}
                    <div className="menu-item-badges">
                      {catName && <span className="menu-item-badge">{catName}</span>}
                      <span className={`menu-item-badge ${item.isVeg ? "veg" : "nonveg"}`}>
                        {item.isVeg ? "Veg" : "Non-veg"}
                      </span>
                      {item.spiceLevel && item.spiceLevel !== "none" && (
                        <span className="menu-item-badge spice">{item.spiceLevel.replace("_", " ")}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="menu-item-body">
                  <div className="menu-item-price">₹{item.price}</div>
                  <div className="menu-item-meta">{item.prepTime} min</div>
                  <span className={`status-badge ${item.isAvailable ? "active" : "inactive"}`}>
                    {item.isAvailable ? "Available" : "Unavailable"}
                  </span>
                  <label className="toggle-switch" title={item.isAvailable ? "Click to make unavailable" : "Click to make available"}>
                    <input type="checkbox" checked={item.isAvailable} onChange={() => toggleAvailability(item)} />
                    <span className="slider"></span>
                  </label>
                  <div className="menu-item-actions">
                    <button className="btn btn-sm btn-secondary" onClick={() => openModal(item)}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(item._id)}>Delete</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

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
                  <input type="number" value={formData.displayOrder} onChange={e => setFormData(d => ({ ...d, displayOrder: e.target.value }))} placeholder="Auto" />
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