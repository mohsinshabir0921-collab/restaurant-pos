import { useState, useEffect } from "react";
import { bannerAPI } from "../services/api";

const toLocalInput = (value) => {
  if (!value) return "";
  const d = new Date(value);
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 16);
};

const fromLocalInput = (value) => (value ? new Date(value) : null);

const isExpired = (banner) =>
  Boolean(banner.endDate) && new Date(banner.endDate).getTime() < Date.now();

const EMPTY_FORM = {
  title: "",
  description: "",
  couponCode: "",
  ctaText: "",
  ctaLink: "",
  startDate: toLocalInput(new Date()),
  endDate: toLocalInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
  sortOrder: 0,
  isActive: true,
};

export default function BannersPage() {
  const [banners, setBanners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingBanner, setEditingBanner] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);

  const fetchBanners = async () => {
    try {
      const res = await bannerAPI.getAll();
      if (res.data.success) setBanners(res.data.banners);
    } catch {
      setError("Failed to load banners");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBanners();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    const data = {
      ...formData,
      startDate: fromLocalInput(formData.startDate),
      endDate: fromLocalInput(formData.endDate),
      sortOrder: Number(formData.sortOrder) || 0,
    };

    try {
      if (editingBanner) {
        await bannerAPI.update(editingBanner._id, data);
      } else {
        await bannerAPI.create(data);
      }
      setShowModal(false);
      fetchBanners();
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const openModal = (banner = null) => {
    if (banner) {
      setEditingBanner(banner);
      setFormData({
        title: banner.title || "",
        description: banner.description || "",
        couponCode: banner.couponCode || "",
        ctaText: banner.ctaText || "",
        ctaLink: banner.ctaLink || "",
        startDate: toLocalInput(banner.startDate),
        endDate: toLocalInput(banner.endDate),
        sortOrder: banner.sortOrder ?? 0,
        isActive: banner.isActive !== undefined ? banner.isActive : true,
      });
    } else {
      setEditingBanner(null);
      setFormData(EMPTY_FORM);
    }
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this banner?")) return;
    try {
      await bannerAPI.delete(id);
      fetchBanners();
    } catch (err) {
      setError(err.response?.data?.message || "Delete failed");
    }
  };

  const toggleStatus = async (banner) => {
    try {
      await bannerAPI.toggle(banner._id, !banner.isActive);
      fetchBanners();
    } catch (err) {
      setError(err.response?.data?.message || "Update failed");
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="coupons-page">
      <div className="page-header">
        <h1>Promotional Banners</h1>
        <button className="btn btn-primary" onClick={() => openModal()}>Create Banner</button>
      </div>

      {error && <div className="toast error">{error}</div>}

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Dates</th>
              <th>Coupon</th>
              <th>CTA</th>
              <th>Sort</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {banners.map(banner => {
              const expired = isExpired(banner);
              return (
                <tr key={banner._id} className={expired ? "row-expired" : ""}>
                  <td>
                    <strong>{banner.title}</strong>
                    {banner.description && (
                      <div className="cell-sub">{banner.description}</div>
                    )}
                  </td>
                  <td>
                    {new Date(banner.startDate).toLocaleDateString()} – {new Date(banner.endDate).toLocaleDateString()}
                  </td>
                  <td>{banner.couponCode ? <strong>{banner.couponCode}</strong> : "—"}</td>
                  <td>{banner.ctaText ? `${banner.ctaText}${banner.ctaLink ? ` → ${banner.ctaLink}` : ""}` : "—"}</td>
                  <td>{banner.sortOrder ?? 0}</td>
                  <td>
                    <span className={`badge ${expired ? "badge-danger" : banner.isActive ? "badge-success" : "badge-neutral"}`}>
                      {expired ? "Expired" : banner.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-sm btn-secondary" onClick={() => openModal(banner)}>Edit</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => toggleStatus(banner)}>
                      {banner.isActive ? "Deactivate" : "Activate"}
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(banner._id)}>Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal large" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingBanner ? "Edit Banner" : "Create Banner"}</h3>
              <button onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Title *</label>
                  <input type="text" value={formData.title} onChange={e => setFormData(d => ({ ...d, title: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Coupon Code</label>
                  <input type="text" value={formData.couponCode} onChange={e => setFormData(d => ({ ...d, couponCode: e.target.value.toUpperCase() }))} placeholder="e.g. SAVE20" />
                </div>
                <div className="form-group">
                  <label>Start Date / Time</label>
                  <input type="datetime-local" value={formData.startDate} onChange={e => setFormData(d => ({ ...d, startDate: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>End Date / Time</label>
                  <input type="datetime-local" value={formData.endDate} onChange={e => setFormData(d => ({ ...d, endDate: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>CTA Text</label>
                  <input type="text" value={formData.ctaText} onChange={e => setFormData(d => ({ ...d, ctaText: e.target.value }))} placeholder="e.g. Order Now" />
                </div>
                <div className="form-group">
                  <label>CTA Link</label>
                  <input type="text" value={formData.ctaLink} onChange={e => setFormData(d => ({ ...d, ctaLink: e.target.value }))} placeholder="e.g. /menu or https://..." />
                </div>
                <div className="form-group">
                  <label>Sort Order</label>
                  <input type="number" min="0" step="1" value={formData.sortOrder} onChange={e => setFormData(d => ({ ...d, sortOrder: e.target.value }))} />
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
                  <textarea value={formData.description} onChange={e => setFormData(d => ({ ...d, description: e.target.value }))} rows={2} placeholder="Optional banner message" />
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