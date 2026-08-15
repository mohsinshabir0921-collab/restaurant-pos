import { useState, useEffect } from "react";
import { categoryAPI } from "../services/api";

export default function CategoriesPage() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    displayOrder: 0,
    isActive: true,
    image: "",
    parentCategory: "",
  });

  const fetchCategories = async () => {
    try {
      const res = await categoryAPI.getAll({ activeOnly: "false" });
      if (res.data.success) setCategories(res.data.categories);
    } catch (err) {
      setError("Failed to load categories");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    const data = {
      ...formData,
      displayOrder: Number(formData.displayOrder),
      parentCategory: formData.parentCategory || null,
    };

    try {
      if (editingCategory) {
        await categoryAPI.update(editingCategory._id, data);
      } else {
        await categoryAPI.create(data);
      }
      setShowModal(false);
      fetchCategories();
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const openModal = (category = null) => {
    if (category) {
      setEditingCategory(category);
      setFormData({
        name: category.name,
        description: category.description || "",
        displayOrder: category.displayOrder || 0,
        isActive: category.isActive !== false,
        image: category.image || "",
        parentCategory: category.parentCategory?._id || category.parentCategory || "",
      });
    } else {
      setEditingCategory(null);
      setFormData({
        name: "",
        description: "",
        displayOrder: categories.length,
        isActive: true,
        image: "",
        parentCategory: "",
      });
    }
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this category? Items in this category must be moved first.")) return;
    try {
      await categoryAPI.delete(id);
      fetchCategories();
    } catch (err) {
      setError(err.response?.data?.message || "Delete failed");
    }
  };

  const handleReorder = async (newOrder) => {
    try {
      await categoryAPI.reorder(newOrder);
      fetchCategories();
    } catch (err) {
      setError(err.response?.data?.message || "Reorder failed");
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="categories-page">
      <div className="page-header">
        <h1>Category Management</h1>
        <button className="btn btn-primary" onClick={() => openModal()}>Add Category</button>
      </div>

      {error && <div className="toast error">{error}</div>}

      <div className="categories-list">
        {categories.map((cat) => {
          const parentName = cat.parentCategory
            ? typeof cat.parentCategory === "object"
              ? cat.parentCategory.name
              : categories.find((c) => c._id === cat.parentCategory)?.name
            : "";
          return (
          <div key={cat._id} className="category-card">
            <div className="category-header">
              <div className="category-info">
                {cat.image && <img src={cat.image} alt={cat.name} className="cat-image" />}
                <div>
                  <h4>{cat.name}</h4>
                  <p>{cat.description}</p>
                  <span className={`status-badge ${cat.isActive ? "active" : "inactive"}`}>
                    {cat.isActive ? "Active" : "Inactive"}
                  </span>
                  {parentName && (
                    <span className="parent-badge">Sub of: {parentName}</span>
                  )}
                </div>
              </div>
              <div className="category-actions">
                <input
                  type="number"
                  value={cat.displayOrder}
                  onChange={e => {
                    const newOrder = categories.map((c, i) => 
                      c._id === cat._id ? { id: c._id, order: Number(e.target.value) } 
                      : { id: c._id, order: i }
                    );
                    handleReorder(newOrder);
                  }}
                  className="order-input"
                  title="Display order"
                />
                <button className="btn btn-sm btn-secondary" onClick={() => openModal(cat)}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(cat._id)}>Delete</button>
              </div>
            </div>
          </div>
          );
        })}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingCategory ? "Edit Category" : "Add Category"}</h3>
              <button onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Name *</label>
                  <input type="text" value={formData.name} onChange={e => setFormData(d => ({ ...d, name: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Display Order</label>
                  <input type="number" value={formData.displayOrder} onChange={e => setFormData(d => ({ ...d, displayOrder: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Parent Category</label>
                  <select value={formData.parentCategory} onChange={e => setFormData(d => ({ ...d, parentCategory: e.target.value }))}>
                    <option value="">None (Top Level)</option>
                    {categories
                      .filter(c => c._id !== (editingCategory?._id || ""))
                      .map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Active</label>
                  <select value={formData.isActive} onChange={e => setFormData(d => ({ ...d, isActive: e.target.value === "true" }))}>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
                <div className="form-group full-width">
                  <label>Description</label>
                  <textarea value={formData.description} onChange={e => setFormData(d => ({ ...d, description: e.target.value }))} rows={2} />
                </div>
                <div className="form-group full-width">
                  <label>Image URL</label>
                  <input type="text" value={formData.image} onChange={e => setFormData(d => ({ ...d, image: e.target.value }))} />
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