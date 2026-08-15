import { useState, useEffect } from "react";
import { communicationAPI } from "../services/api";

const triggers = ["order_placed", "order_confirmed", "order_preparing", "order_ready", "order_served", "order_paid", "order_cancelled", "delivery_assigned", "delivery_picked", "delivery_delivered", "pickup_ready", "payment_received", "payment_failed", "refund_initiated", "refund_completed", "loyalty_points_earned", "loyalty_points_redeemed", "loyalty_tier_upgraded", "birthday_wish", "anniversary_wish", "welcome", "feedback_request", "promotional", "low_stock_alert", "waste_alert", "daily_summary", "shift_summary"];

export default function CommunicationsPage() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [viewingTemplate, setViewingTemplate] = useState(null);
  const [previewData, setPreviewData] = useState({});
  const [activeTab, setActiveTab] = useState("list");
  const [typeFilter, setTypeFilter] = useState("");
  const [triggerFilter, setTriggerFilter] = useState("");
  const [formData, setFormData] = useState({ name: "", type: "sms", trigger: "order_placed", subject: "", content: "", variables: [], isActive: true, sendDelayMinutes: 0, conditions: [], priority: "normal", fallbackTemplate: null });

  const fetchData = async () => {
    try {
      const res = await communicationAPI.getAll({ type: typeFilter, trigger: triggerFilter, limit: 100 });
      if (res.data.success) setTemplates(res.data.templates);
    } catch (err) { setError("Failed to load"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [typeFilter, triggerFilter]);

  const updateField = (field, value) => setFormData(d => ({ ...d, [field]: value }));
  const updateNumberField = (field, value) => setFormData(d => ({ ...d, [field]: Number(value) || 0 }));
  const updateBooleanField = (field, value) => setFormData(d => ({ ...d, [field]: value === "true" }));
  const updateOptionalField = (field, value) => setFormData(d => ({ ...d, [field]: value || null }));

  const openModal = (tmpl = null) => {
    if (tmpl) { setEditingTemplate(tmpl); setFormData({ ...tmpl, fallbackTemplate: tmpl.fallbackTemplate?._id || null }); }
    else { setEditingTemplate(null); setFormData({ name: "", type: "sms", trigger: "order_placed", subject: "", content: "", variables: [], isActive: true, sendDelayMinutes: 0, conditions: [], priority: "normal", fallbackTemplate: null }); }
    setShowModal(true); setActiveTab("create");
  };

  const viewTemplate = async (tmpl) => {
    setViewingTemplate(tmpl);
    const vars = tmpl.variables.reduce((acc, v) => { acc[v.name] = v.example || ""; return acc; }, {});
    setPreviewData(vars);
  };

  const addVariable = () => setFormData(d => ({ ...d, variables: [...d.variables, { name: "", description: "", example: "", required: true }] }));
  const removeVariable = (idx) => setFormData(d => ({ ...d, variables: d.variables.filter((_, i) => i !== idx) }));
  const updateVariable = (idx, field, value) => setFormData(d => { const vs = [...d.variables]; vs[idx] = { ...vs[idx], [field]: value }; return { ...d, variables: vs }; });

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true); setError("");
    try {
      const data = { ...formData, variables: formData.variables.filter(v => v.name), conditions: formData.conditions || [], fallbackTemplate: formData.fallbackTemplate || null };
      if (editingTemplate) await communicationAPI.update(editingTemplate._id, data);
      else await communicationAPI.create(data);
      setShowModal(false); fetchData();
    } catch (err) { setError(err.response?.data?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  const handlePreview = async () => {
    try {
      const res = await communicationAPI.preview(editingTemplate?._id || "new", { data: previewData });
      if (res.data.success) {
        alert(`Subject: ${res.data.preview.subject}\n\n${res.data.preview.content}`);
      }
    } catch (err) { setError(err.response?.data?.message || "Preview failed"); }
  };

  const handleDelete = async (id) => { if (!confirm("Delete?")) return; try { await communicationAPI.delete(id); fetchData(); } catch (err) { setError(err.response?.data?.message || "Delete failed"); } };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="communications-page">
      <div className="page-header"><h1>Communication Templates</h1><button className="btn btn-primary" onClick={() => { setActiveTab("create"); openModal(); }}>Create Template</button></div>
      {error && <div className="toast error">{error}</div>}
      <div className="filters">
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}><option value="">All Types</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="push">Push</option></select>
        <select value={triggerFilter} onChange={e => setTriggerFilter(e.target.value)}><option value="">All Triggers</option>{triggers.map(t => <option key={t} value={t}>{t}</option>)}</select>
      </div>

      {activeTab === "list" && (
        <div className="table-container"><table><thead><tr><th>Name</th><th>Type</th><th>Trigger</th><th>Subject</th><th>Delay</th><th>Priority</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {templates.map(t => (
            <tr key={t._id}>
              <td><strong>{t.name}</strong></td>
              <td><span className="category-badge">{t.type}</span></td>
              <td>{t.trigger}</td>
              <td>{t.subject || "-"}</td>
              <td>{t.sendDelayMinutes} min</td>
              <td><span className={`status-badge priority-${t.priority}`}>{t.priority}</span></td>
              <td><span className={`status-badge ${t.isActive ? "active" : "inactive"}`}>{t.isActive ? "Active" : "Inactive"}</span></td>
              <td>
                <button className="btn btn-sm btn-secondary" onClick={() => viewTemplate(t)}>Preview</button>
                <button className="btn btn-sm btn-secondary" onClick={() => openModal(t)}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(t._id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody></table></div>
      )}

      {(activeTab === "create" || editingTemplate) && showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); setEditingTemplate(null); setActiveTab("list"); }}>
          <div className="modal xl" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>{editingTemplate ? "Edit Template" : "Create Template"}</h3><button onClick={() => { setShowModal(false); setEditingTemplate(null); setActiveTab("list"); }}>×</button></div>
            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                <div className="form-group"><label>Name *</label><input value={formData.name} onChange={e => updateField("name", e.target.value)} required /></div>
                <div className="form-group"><label>Type *</label><select value={formData.type} onChange={e => updateField("type", e.target.value)}><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="push">Push</option></select></div>
                <div className="form-group"><label>Trigger *</label><select value={formData.trigger} onChange={e => updateField("trigger", e.target.value)}>{triggers.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                <div className="form-group"><label>Subject (Email/Push)</label><input value={formData.subject} onChange={e => updateField("subject", e.target.value)} /></div>
                <div className="form-group"><label>Delay (minutes)</label><input type="number" min="0" value={formData.sendDelayMinutes} onChange={e => updateNumberField("sendDelayMinutes", e.target.value)} /></div>
                <div className="form-group"><label>Priority</label><select value={formData.priority} onChange={e => updateField("priority", e.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
                <div className="form-group"><label>Active</label><select value={formData.isActive ? "true" : "false"} onChange={e => updateBooleanField("isActive", e.target.value)}><option value="true">Yes</option><option value="false">No</option></select></div>
                <div className="form-group"><label>Fallback Template</label><select value={formData.fallbackTemplate} onChange={e => updateOptionalField("fallbackTemplate", e.target.value)}><option value="">None</option>{templates.filter(t => t._id !== (editingTemplate?._id || "")).map(t => <option key={t._id} value={t._id}>{t.name}</option>)}</select></div>
              </div>
              <div className="form-group full-width"><label>Content *</label><textarea value={formData.content} onChange={e => updateField("content", e.target.value)} rows={8} required placeholder="Use {{variable_name}} for placeholders"/></div>
              <div className="form-group full-width"><label>Variables</label>
                {formData.variables.map((v, idx) => (
                  <div key={idx} className="ingredient-row">
                    <input placeholder="Name (e.g. customer_name)" value={v.name} onChange={e => updateVariable(idx, "name", e.target.value)} />
                    <input placeholder="Description" value={v.description} onChange={e => updateVariable(idx, "description", e.target.value)} />
                    <input placeholder="Example" value={v.example} onChange={e => updateVariable(idx, "example", e.target.value)} />
                    <select value={v.required ? "true" : "false"} onChange={e => updateVariable(idx, "required", e.target.value === "true")}><option value="true">Required</option><option value="false">Optional</option></select>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => removeVariable(idx)}>Remove</button>
                  </div>
                ))}
                <button type="button" className="btn btn-secondary btn-sm" onClick={addVariable}>+ Add Variable</button>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => { setShowModal(false); setEditingTemplate(null); setActiveTab("list"); }}>Cancel</button>
                <button type="button" className="btn btn-info" onClick={handlePreview}>Preview</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewingTemplate && (
        <div className="modal-overlay" onClick={() => setViewingTemplate(null)}>
          <div className="modal xl" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Preview: {viewingTemplate.name}</h3><button onClick={() => setViewingTemplate(null)}>×</button></div>
            <div className="preview-section">
              <div className="form-group"><label>Test Data (JSON)</label><textarea value={JSON.stringify(previewData, null, 2)} onChange={e => { try { setPreviewData(JSON.parse(e.target.value)); } catch {} }} rows={10} /></div>
              <button className="btn btn-primary" onClick={handlePreview}>Render Preview</button>
              <div className="preview-output">
                {viewingTemplate.subject && <div className="preview-field"><strong>Subject:</strong> {viewingTemplate.subject.replace(/{{(\w+)}}/g, (_, k) => previewData[k] || "")}</div>}
                <div className="preview-field"><strong>Content:</strong><pre>{viewingTemplate.content.replace(/{{(\w+)}}/g, (_, k) => previewData[k] || "")}</pre></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}