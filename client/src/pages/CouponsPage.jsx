import { useState, useEffect } from "react";
import { couponAPI } from "../services/api";

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;

const toIdList = (arr) => Array.isArray(arr)
  ? arr.map(item => (item && typeof item === "object" && item._id ? item._id : item)).filter(Boolean)
  : [];

export default function CouponsPage() {
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState(null);
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    description: "",
    type: "percent",
    value: "",
    buyCount: 1,
    maxDiscount: "",
    minOrderAmount: 0,
    applicableOrderTypes: ["dinein", "takeaway", "delivery"],
    applicableCategories: [],
    applicableItems: [],
    excludedCategories: [],
    excludedItems: [],
    usageLimit: "",
    usageLimitPerCustomer: 1,
    validFrom: new Date().toISOString().slice(0, 16),
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
    isActive: true,
    firstOrderOnly: false,
    customerTags: "",
    autoApply: false,
    stackable: false,
  });

  const fetchCoupons = async () => {
    try {
      const res = await couponAPI.getAll({ limit: 50 });
      if (res.data.success) setCoupons(res.data.coupons);
    } catch (err) {
      setError("Failed to load coupons");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCoupons();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    const data = {
      ...formData,
      value: Number(formData.value),
      buyCount: Number(formData.buyCount) || 1,
      maxDiscount: formData.maxDiscount ? Number(formData.maxDiscount) : null,
      minOrderAmount: Number(formData.minOrderAmount),
      usageLimit: formData.usageLimit ? Number(formData.usageLimit) : null,
      usageLimitPerCustomer: Number(formData.usageLimitPerCustomer),
      validFrom: formData.validFrom ? new Date(formData.validFrom) : new Date(),
      validUntil: formData.validUntil ? new Date(formData.validUntil) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      customerTags: formData.customerTags.split(",").map(t => t.trim()).filter(Boolean),
    };

    try {
      if (editingCoupon) {
        await couponAPI.update(editingCoupon._id, data);
      } else {
        await couponAPI.create(data);
      }
      setShowModal(false);
      fetchCoupons();
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const openModal = (coupon = null) => {
    if (coupon) {
      setEditingCoupon(coupon);
      const defaultValidFrom = new Date().toISOString().slice(0, 16);
      const defaultValidUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
      setFormData({
        code: coupon.code || "",
        name: coupon.name || coupon.title || "",
        description: coupon.description || "",
        type: coupon.type || coupon.discountType || "percent",
        value: coupon.value ?? "",
        buyCount: coupon.buyCount ?? 1,
        maxDiscount: coupon.maxDiscount || "",
        minOrderAmount: coupon.minOrderAmount ?? coupon.minOrderValue ?? 0,
        applicableOrderTypes: coupon.applicableOrderTypes?.length ? coupon.applicableOrderTypes : ["dinein", "takeaway", "delivery"],
        applicableCategories: toIdList(coupon.applicableCategories),
        applicableItems: toIdList(coupon.applicableItems),
        excludedCategories: toIdList(coupon.excludedCategories),
        excludedItems: toIdList(coupon.excludedItems),
        usageLimit: coupon.usageLimit || "",
        usageLimitPerCustomer: coupon.usageLimitPerCustomer ?? 1,
        validFrom: coupon.validFrom ? new Date(coupon.validFrom).toISOString().slice(0, 16) : defaultValidFrom,
        validUntil: coupon.validUntil ? new Date(coupon.validUntil).toISOString().slice(0, 16) : defaultValidUntil,
        isActive: coupon.isActive !== undefined ? coupon.isActive : true,
        firstOrderOnly: coupon.firstOrderOnly || false,
        customerTags: (coupon.customerTags || []).join(", "),
        autoApply: coupon.autoApply || false,
        stackable: coupon.stackable || false,
      });
    } else {
      setEditingCoupon(null);
      setFormData({
        code: "",
        name: "",
        description: "",
        type: "percent",
        value: "",
        buyCount: 1,
        maxDiscount: "",
        minOrderAmount: 0,
        applicableOrderTypes: ["dinein", "takeaway", "delivery"],
        applicableCategories: [],
        applicableItems: [],
        excludedCategories: [],
        excludedItems: [],
        usageLimit: "",
        usageLimitPerCustomer: 1,
        validFrom: new Date().toISOString().slice(0, 16),
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
        isActive: true,
        firstOrderOnly: false,
        customerTags: "",
        autoApply: false,
        stackable: false,
      });
    }
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this coupon?")) return;
    try {
      await couponAPI.delete(id);
      fetchCoupons();
    } catch (err) {
      setError(err.response?.data?.message || "Delete failed");
    }
  };

  const toggleStatus = async (coupon) => {
    try {
      await couponAPI.toggle(coupon._id, !coupon.isActive);
      fetchCoupons();
    } catch (err) {
      setError(err.response?.data?.message || "Update failed");
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="coupons-page">
      <div className="page-header">
        <h1>Coupon Management</h1>
        <button className="btn btn-primary" onClick={() => openModal()}>Create Coupon</button>
      </div>

      {error && <div className="toast error">{error}</div>}

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Type</th>
              <th>Value</th>
              <th>Max Discount</th>
              <th>Min Order</th>
              <th>Valid Until</th>
              <th>Usage</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {coupons.map(coupon => (
              <tr key={coupon._id}>
                <td><strong>{coupon.code}</strong></td>
                <td>{coupon.name}</td>
                <td>{coupon.type === "percent" ? `${coupon.value}%` : coupon.type === "buy_x_get_y" ? `Buy ${coupon.buyCount || 1} Get ${coupon.value || 1}` : formatCurrency(coupon.value)}</td>
                <td>{coupon.type}</td>
                <td>{coupon.maxDiscount ? formatCurrency(coupon.maxDiscount) : "No limit"}</td>
                <td>{coupon.minOrderAmount ? formatCurrency(coupon.minOrderAmount) : "No minimum"}</td>
                <td>{new Date(coupon.validUntil).toLocaleDateString()}</td>
                <td>{coupon.usageCount} / {coupon.usageLimit || "∞"}</td>
                <td>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={coupon.isActive} onChange={() => toggleStatus(coupon)} />
                    <span className="slider"></span>
                  </label>
                </td>
                <td>
                  <button className="btn btn-sm btn-secondary" onClick={() => openModal(coupon)}>Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={() => handleDelete(coupon._id)}>Delete</button>
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
              <h3>{editingCoupon ? "Edit Coupon" : "Create Coupon"}</h3>
              <button onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Code *</label>
                  <input type="text" value={formData.code} onChange={e => setFormData(d => ({ ...d, code: e.target.value.toUpperCase() }))} required />
                </div>
                <div className="form-group">
                  <label>Name *</label>
                  <input type="text" value={formData.name} onChange={e => setFormData(d => ({ ...d, name: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Type *</label>
                  <select value={formData.type} onChange={e => setFormData(d => ({ ...d, type: e.target.value }))}>
                    <option value="percent">Percentage</option>
                    <option value="flat">Flat Amount</option>
                    <option value="buy_x_get_y">Buy X Get Y</option>
                  </select>
                </div>
                {formData.type === "buy_x_get_y" ? (
                  <>
                    <div className="form-group">
                      <label>Buy (paid items) *</label>
                      <input type="number" min="1" step="1" value={formData.buyCount} onChange={e => setFormData(d => ({ ...d, buyCount: e.target.value }))} required />
                    </div>
                    <div className="form-group">
                      <label>Get (free items) *</label>
                      <input type="number" min="1" step="1" value={formData.value} onChange={e => setFormData(d => ({ ...d, value: e.target.value }))} required />
                    </div>
                  </>
                ) : (
                  <div className="form-group">
                    <label>Value *</label>
                    <input type="number" step="0.01" min="0" value={formData.value} onChange={e => setFormData(d => ({ ...d, value: e.target.value }))} required />
                  </div>
                )}
                <div className="form-group">
                  <label>Max Discount</label>
                  <input type="number" step="0.01" min="0" value={formData.maxDiscount} onChange={e => setFormData(d => ({ ...d, maxDiscount: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Min Order Amount</label>
                  <input type="number" step="0.01" min="0" value={formData.minOrderAmount} onChange={e => setFormData(d => ({ ...d, minOrderAmount: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Usage Limit</label>
                  <input type="number" min="1" value={formData.usageLimit} onChange={e => setFormData(d => ({ ...d, usageLimit: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Limit Per Customer</label>
                  <input type="number" min="1" value={formData.usageLimitPerCustomer} onChange={e => setFormData(d => ({ ...d, usageLimitPerCustomer: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Valid From</label>
                  <input type="datetime-local" value={formData.validFrom} onChange={e => setFormData(d => ({ ...d, validFrom: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Valid Until</label>
                  <input type="datetime-local" value={formData.validUntil} onChange={e => setFormData(d => ({ ...d, validUntil: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Active</label>
                  <select value={formData.isActive} onChange={e => setFormData(d => ({ ...d, isActive: e.target.value === "true" }))}>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>First Order Only</label>
                  <select value={formData.firstOrderOnly} onChange={e => setFormData(d => ({ ...d, firstOrderOnly: e.target.value === "true" }))}>
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Auto Apply</label>
                  <select value={formData.autoApply} onChange={e => setFormData(d => ({ ...d, autoApply: e.target.value === "true" }))}>
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Stackable</label>
                  <select value={formData.stackable} onChange={e => setFormData(d => ({ ...d, stackable: e.target.value === "true" }))}>
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </select>
                </div>
                <div className="form-group full-width">
                  <label>Applicable Order Types</label>
                  <div className="checkbox-group">
                    {["dinein", "takeaway", "delivery"].map(type => (
                      <label key={type}>
                        <input type="checkbox" checked={formData.applicableOrderTypes.includes(type)} onChange={e => setFormData(d => ({ ...d, applicableOrderTypes: e.target.checked ? [...d.applicableOrderTypes, type] : d.applicableOrderTypes.filter(t => t !== type) }))} />
                        {type}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="form-group full-width">
                  <label>Description</label>
                  <textarea value={formData.description} onChange={e => setFormData(d => ({ ...d, description: e.target.value }))} rows={2} />
                </div>
                <div className="form-group full-width">
                  <label>Customer Tags (comma separated)</label>
                  <input type="text" value={formData.customerTags} onChange={e => setFormData(d => ({ ...d, customerTags: e.target.value }))} />
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