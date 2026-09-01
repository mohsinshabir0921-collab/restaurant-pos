import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { settingsAPI } from "../services/api";

export default function PaymentMethodsEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [formData, setFormData] = useState({ id: "", label: "", description: "", enabled: true });
  const [paymentMethods, setPaymentMethods] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await settingsAPI.get("payment_methods");
        if (cancelled) return;
        if (!res.data?.success) {
          setNotFound(true);
          return;
        }
        const methods = Array.isArray(res.data.setting?.value) ? res.data.setting.value : [];
        setPaymentMethods(methods);
        const method = methods.find((m) => String(m.id) === String(id));
        if (!method) {
          setNotFound(true);
          return;
        }
        setFormData({
          id: method.id || "",
          label: method.label || "",
          description: method.description || "",
          enabled: method.enabled !== false,
        });
      } catch (err) {
        if (cancelled) return;
        if (err.response?.status === 404) {
          setNotFound(true);
        } else {
          setError(err.response?.data?.message || "Failed to load payment method");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleChange = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!formData.label.trim()) {
      setError("Label is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const next = paymentMethods.map((m) =>
        String(m.id) === String(id)
          ? { ...m, label: formData.label.trim(), description: formData.description.trim(), enabled: formData.enabled }
          : m
      );
      await settingsAPI.update("payment_methods", next, "Configurable payment methods available for the store (JSON array)", "payment");
      navigate("/settings");
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
      setSaving(false);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  if (notFound) {
    return (
      <div className="settings-page">
        <div className="page-header">
          <h1>Edit Payment Method</h1>
        </div>
        <div className="settings-main" style={{ maxWidth: 640 }}>
          <div className="toast error">Payment method not found.</div>
          <button className="btn btn-secondary" onClick={() => navigate("/settings")}>
            Back to Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>Edit Payment Method</h1>
      </div>

      {error && <div className="toast error">{error}</div>}

      <div className="settings-main" style={{ maxWidth: 640 }}>
        <div className="settings-header">
          <h2>{formData.label || formData.id}</h2>
        </div>

        <div className="settings-form">
          <div className="setting-field">
            <label className="form-label">Method ID</label>
            <input type="text" value={formData.id} readOnly disabled />
          </div>

          <div className="setting-field">
            <label className="form-label">Label</label>
            <input
              type="text"
              value={formData.label}
              onChange={(e) => handleChange("label", e.target.value)}
              placeholder="e.g. UPI"
            />
          </div>

          <div className="setting-field">
            <label className="form-label">Description</label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => handleChange("description", e.target.value)}
              placeholder="Short description shown to customers"
            />
          </div>

          <div className="setting-field">
            <label className="form-label">Enabled</label>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={formData.enabled}
                onChange={(e) => handleChange("enabled", e.target.checked)}
              />
              <span className="slider" />
            </label>
          </div>
        </div>

        <div className="settings-actions" style={{ display: "flex", gap: 12, marginTop: 16 }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </button>
          <button className="btn btn-secondary" onClick={() => navigate("/settings")} disabled={saving}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
