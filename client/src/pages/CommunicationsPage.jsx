import { useState, useEffect } from "react";
import { communicationAPI, settingsAPI } from "../services/api";

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
  const [view, setView] = useState("templates");
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
      <div className="page-header"><h1>Communications</h1></div>

      <div className="comm-tabs" role="tablist" aria-label="Communications sections">
        <button
          type="button"
          role="tab"
          aria-selected={view === "templates"}
          className={`comm-tab${view === "templates" ? " active" : ""}`}
          onClick={() => setView("templates")}
        >
          Templates
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "channels"}
          className={`comm-tab${view === "channels" ? " active" : ""}`}
          onClick={() => setView("channels")}
        >
          Channels &amp; Contact
        </button>
      </div>

      {view === "channels" ? (
        <ChannelsContact />
      ) : (
        <>
          <div className="comm-toolbar">
            <div className="filters">
              <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}><option value="">All Types</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="push">Push</option></select>
              <select value={triggerFilter} onChange={e => setTriggerFilter(e.target.value)}><option value="">All Triggers</option>{triggers.map(t => <option key={t} value={t}>{t}</option>)}</select>
            </div>
            <button className="btn btn-primary" onClick={() => { setActiveTab("create"); openModal(); }}>Create Template</button>
          </div>
          {error && <div className="toast error">{error}</div>}

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
        </>
      )}
    </div>
  );
}

const toDigits = (value) => String(value || "").replace(/\D/g, "");

const getExternalHttpUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    return null;
  }
  return null;
};

function ChannelsContact() {
  const [form, setForm] = useState({ whatsapp_number: "", instagram_url: "", restaurant_email: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const fetchChannels = async () => {
    try {
      const res = await settingsAPI.getAll();
      if (res.data.success) {
        const map = {};
        res.data.settings.forEach(s => { map[s.key] = s.value; });
        setForm({
          whatsapp_number: map.whatsapp_number || "",
          instagram_url: map.instagram_url || "",
          restaurant_email: map.restaurant_email || "",
        });
      }
    } catch (err) {
      setError("Failed to load channel settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchChannels(); }, []);

  const updateField = (key, value) => setForm(d => ({ ...d, [key]: value }));

  const handleSave = async () => {
    setSaving(true); setMessage(""); setError("");
    try {
      await settingsAPI.bulkUpdate([
        { key: "whatsapp_number", value: form.whatsapp_number.trim() },
        { key: "instagram_url", value: form.instagram_url.trim() },
        { key: "restaurant_email", value: form.restaurant_email.trim() },
      ]);
      setMessage("Channel settings saved");
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  const whatsappDigits = toDigits(form.whatsapp_number);
  const instagramUrl = getExternalHttpUrl(form.instagram_url);
  const instagramInvalid = Boolean(form.instagram_url.trim()) && !instagramUrl;
  const emailAddress = form.restaurant_email.trim();

  const openInstagram = () => {
    if (instagramUrl) window.open(instagramUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="channels-contact">
      <p className="channels-intro">
        Configure the restaurant's public contact channels. These reuse the existing settings — the
        actions below are contact/redirect links only (WhatsApp opens wa.me, Instagram opens the
        profile, Email opens a mailto:). No automated sending is wired up yet.
      </p>

      {error && <div className="channels-message error">{error}</div>}
      {message && <div className="channels-message success">{message}</div>}

      <div className="channel-grid">
        <div className="channel-card">
          <div className="channel-card-head">
            <span className="channel-icon channel-whatsapp" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                <path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1zm5 0a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1z" />
              </svg>
            </span>
            <div>
              <h3>WhatsApp</h3>
              <p>Open a WhatsApp chat with the restaurant.</p>
            </div>
          </div>
          <div className="form-group">
            <label>WhatsApp number (with country code)</label>
            <input type="tel" value={form.whatsapp_number} onChange={e => updateField("whatsapp_number", e.target.value)} placeholder="e.g. +91 98765 43210" />
          </div>
          {whatsappDigits ? (
            <a className="btn btn-primary" href={`https://wa.me/${whatsappDigits}`} target="_blank" rel="noopener noreferrer">Open WhatsApp</a>
          ) : (
            <button className="btn btn-primary" disabled>Open WhatsApp</button>
          )}
        </div>

        <div className="channel-card">
          <div className="channel-card-head">
            <span className="channel-icon channel-instagram" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
              </svg>
            </span>
            <div>
              <h3>Instagram</h3>
              <p>External profile / DM link. Not an API integration.</p>
            </div>
          </div>
          <div className="form-group">
            <label>Instagram URL</label>
            <input type="url" value={form.instagram_url} onChange={e => updateField("instagram_url", e.target.value)} placeholder="https://instagram.com/yourpage" />
          </div>
          {instagramUrl ? (
            <button type="button" className="btn btn-primary" onClick={openInstagram}>Open Instagram</button>
          ) : (
            <button type="button" className="btn btn-primary" disabled>Open Instagram</button>
          )}
          {instagramUrl ? (
            <span className="channels-hint">Opens {instagramUrl} in a new tab.</span>
          ) : instagramInvalid ? (
            <span className="channels-hint error">The Instagram URL must be a full URL starting with https:// (e.g. https://instagram.com/yourpage).</span>
          ) : (
            <span className="channels-hint">Set an Instagram URL to enable this link.</span>
          )}
        </div>

        <div className="channel-card">
          <div className="channel-card-head">
            <span className="channel-icon channel-email" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            </span>
            <div>
              <h3>Email</h3>
              <p>Send an email to the restaurant.</p>
            </div>
          </div>
          <div className="form-group">
            <label>Restaurant email</label>
            <input type="email" value={form.restaurant_email} onChange={e => updateField("restaurant_email", e.target.value)} placeholder="orders@restaurant.com" />
          </div>
          {emailAddress ? (
            <a className="btn btn-primary" href={`mailto:${emailAddress}`}>Send Email</a>
          ) : (
            <button className="btn btn-primary" disabled>Send Email</button>
          )}
        </div>
      </div>

      <div className="channels-save">
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Channel Settings"}
        </button>
      </div>
    </div>
  );
}