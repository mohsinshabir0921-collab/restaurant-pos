import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { settingsAPI } from "../services/api";
import { usePosPushNotifications } from "../hooks/usePosPushNotifications";
import {
  IconKitchen,
  IconReports,
  IconPrint,
  IconBell,
  IconCart,
  IconSettings,
} from "../components/icons";

const SETTING_GROUPS = [
  { key: "restaurant", label: "Restaurant", icon: <IconKitchen size={17} /> },
  { key: "tax", label: "Tax & Charges", icon: <IconReports size={17} /> },
  { key: "printing", label: "Printing", icon: <IconPrint size={17} /> },
  { key: "notifications", label: "Notifications", icon: <IconBell size={17} /> },
  { key: "payment", label: "Payment", icon: <IconCart size={17} /> },
  { key: "general", label: "General", icon: <IconSettings size={17} /> },
];

const getLabel = (key) =>
  key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

// --- Restaurant Ordering helpers (IST, like server openingHours.js) ---
const getNowInIST = () => {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 5.5 * 60 * 60000);
};
const parseOpeningHoursPOS = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
  }
  return null;
};
const toMinutesPOS = (t) => {
  if (!t || typeof t !== "string") return null;
  const [h, m] = String(t).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
};
const isPOSOpenNow = (openingHoursValue) => {
  const hours = parseOpeningHoursPOS(openingHoursValue);
  if (!hours) return true;
  const now = getNowInIST();
  const dayKey = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"][now.getDay()];
  const today = hours[dayKey];
  if (!today) return true;
  const open = toMinutesPOS(today.open);
  const close = toMinutesPOS(today.close);
  if (open == null || close == null) return true;
  if (open === close) return false;
  const nowMin = now.getHours()*60 + now.getMinutes();
  return nowMin >= open && nowMin < close;
};
const getDisplayTimesFromHours = (value) => {
  const obj = parseOpeningHoursPOS(value);
  if (!obj) return { open: "11:00", close: "23:00" };
  const sample = obj.monday || obj.tuesday || obj.sunday || Object.values(obj)[0];
  if (sample && sample.open && sample.close) return { open: sample.open, close: sample.close };
  return { open: "11:00", close: "23:00" };
};
const buildOpeningHoursJson = (open, close) => {
  const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
  const out = {};
  days.forEach(d => { out[d] = { open, close }; });
  // Keep sunday as before but allow same; task example uses single global time
  return JSON.stringify(out);
};

export default function SettingsPage() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeGroup, setActiveGroup] = useState("restaurant");
  const [formData, setFormData] = useState({});
  const [testMsg, setTestMsg] = useState("");
  const [testing, setTesting] = useState(false);
  
  const {
    isSubscribed,
    permission,
    loading: pushLoading,
    subscribe,
    unsubscribe
  } = usePosPushNotifications();

  const navigate = useNavigate();

  const fetchSettings = async () => {
    try {
      const res = await settingsAPI.getAll();
      if (res.data.success) {
        const grouped = {};
        res.data.settings.forEach(s => {
          if (!grouped[s.group]) grouped[s.group] = {};
          grouped[s.group][s.key] = s.value;
        });
        setSettings(grouped);
        setFormData(grouped[activeGroup] || {});
      }
    } catch (err) {
      setError("Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    setFormData(settings[activeGroup] || {});
  }, [activeGroup, settings]);

  const handleChange = (key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const updates = Object.entries(formData)
        .map(([key, value]) => {
          const originalValue = settings[activeGroup]?.[key];
          return {
            key,
            value: typeof originalValue === "number" ? Number(value === "" ? 0 : value) : value,
          };
        });
      if (updates.length === 0) return;
      await settingsAPI.bulkUpdate(updates);
      setSettings(prev => ({ ...prev, [activeGroup]: formData }));
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleTestPrint = async () => {
    setTesting(true);
    setTestMsg("");
    setError("");
    try {
      const res = await settingsAPI.testPrinter();
      if (res.data?.success) setTestMsg("Test receipt sent to the thermal printer.");
      else setError(res.data?.message || "Test print failed");
    } catch (err) {
      setError(err.response?.data?.message || "Test print failed");
    } finally {
      setTesting(false);
    }
  };

  const getInputType = (key, value) => {
    if (typeof value === "boolean") return "checkbox";
    if (typeof value === "number") return "number";
    if (key.includes("email")) return "email";
    if (key.includes("phone")) return "tel";
    if (key.includes("url") || key.includes("port")) return "text";
    return "text";
  };

  if (loading) return <div className="loading">Loading...</div>;

  const groupSettings = settings[activeGroup] || {};
  const formValues = formData || {};

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      {error && <div className="toast error">{error}</div>}
      {testMsg && <div className="toast success">{testMsg}</div>}

      <div className="settings-layout">
        <aside className="settings-sidebar">
          <nav className="settings-nav">
            {SETTING_GROUPS.map(group => (
              <button
                key={group.key}
                className={activeGroup === group.key ? "active" : ""}
                onClick={() => {
                  setActiveGroup(group.key);
                  setFormData(settings[group.key] || {});
                }}
              >
                <span className="nav-icon">{group.icon}</span>
                {group.label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="settings-main">
          <div className="settings-header">
            <h2>{SETTING_GROUPS.find(g => g.key === activeGroup)?.label} Settings</h2>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </button>
            {activeGroup === "printing" && (
              <button className="btn btn-secondary" onClick={handleTestPrint} disabled={testing}>
                {testing ? "Printing..." : "Test Print"}
              </button>
            )}
          </div>

          {activeGroup === "restaurant" && (() => {
            const onlineEnabled = formData.online_ordering_enabled !== undefined ? formData.online_ordering_enabled : (groupSettings.online_ordering_enabled !== undefined ? groupSettings.online_ordering_enabled : true);
            const { open: displayOpen, close: displayClose } = getDisplayTimesFromHours(formData.opening_hours ?? groupSettings.opening_hours);
            const isOpenStatus = onlineEnabled => {
              if (onlineEnabled === false) return false;
              const val = formData.opening_hours ?? groupSettings.opening_hours;
              return isPOSOpenNow(val);
            };
            const currentlyOpen = isOpenStatus(onlineEnabled);
            return (
              <div className="restaurant-ordering-card" style={{background:"var(--color-surface, #fff)",border:"1px solid #e5e7eb",borderRadius:8,padding:16,marginBottom:16}}>
                <h3 style={{margin:"0 0 12px 0"}}>Restaurant Ordering</h3>
                <div className="setting-field">
                  <label>Accept Online Orders</label>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={!!onlineEnabled}
                      onChange={e => handleChange("online_ordering_enabled", e.target.checked)}
                    />
                    <span className="slider"></span>
                  </label>
                </div>
                <div className="setting-field">
                  <label>Opening Time</label>
                  <input
                    type="time"
                    value={displayOpen}
                    onChange={e => {
                      const newOpen = e.target.value;
                      const newClose = displayClose;
                      handleChange("opening_hours", buildOpeningHoursJson(newOpen, newClose));
                    }}
                  />
                </div>
                <div className="setting-field">
                  <label>Closing Time</label>
                  <input
                    type="time"
                    value={displayClose}
                    onChange={e => {
                      const newClose = e.target.value;
                      const newOpen = displayOpen;
                      handleChange("opening_hours", buildOpeningHoursJson(newOpen, newClose));
                    }}
                  />
                </div>
                <div className="ordering-status" style={{marginTop:12,padding:"8px 12px",borderRadius:6,background: currentlyOpen ? "#ecfdf5" : "#fef2f2",border: `1px solid ${currentlyOpen ? "#a7f3d0" : "#fecaca"}`,fontWeight:600}}>
                  Status: {currentlyOpen ? "🟢 Restaurant is currently OPEN" : "🔴 Restaurant is currently CLOSED"}
                </div>
              </div>
            );
          })()}

          {activeGroup === "notifications" && (
            <div className="setting-field push-notifications-section">
              <label>Push Notifications</label>
              <div className="push-notifications-card">
                <p>Receive instant browser notifications for new customer orders.</p>
                
                {permission === 'ios-install-required' && (
                  <div className="toast warning">
                    To receive push notifications on iPhone/iPad, add the POS to your Home Screen. Open <strong>https://khyennchyenn.co.in/pos</strong> in Safari, tap Share → Add to Home Screen, then open the POS from the Home Screen icon to enable notifications.
                  </div>
                )}

                {permission === 'unsupported' && (
                  <div className="toast warning">
                    Push notifications are not supported in this browser
                  </div>
                )}
                
                {permission === 'denied' && (
                  <div className="toast warning">
                    Notification permission denied. Please enable notifications in your browser settings.
                  </div>
                )}
                
                {permission === 'ios-install-required' ? null : isSubscribed ? (
                  <div className="push-status enabled">
                    <span className="status-indicator">✓</span>
                    <span>Push notifications enabled</span>
                    <button 
                      className="btn btn-secondary"
                      onClick={() => unsubscribe()}
                      disabled={pushLoading}
                    >
                      {pushLoading ? "Updating..." : "Disable"}
                    </button>
                  </div>
                ) : permission === 'granted' ? (
                  <button 
                    className="btn btn-primary"
                    onClick={() => subscribe()}
                    disabled={pushLoading}
                  >
                    {pushLoading ? "Enabling..." : "Enable Notifications"}
                  </button>
                ) : permission === 'default' ? (
                  <button 
                    className="btn btn-primary"
                    onClick={() => subscribe()}
                    disabled={pushLoading}
                  >
                    {pushLoading ? "Enabling..." : "Enable Notifications"}
                  </button>
                ) : null}
              </div>
            </div>
          )}

          {activeGroup === "payment" && (
            <div className="payment-methods-admin">
              <h3>Payment Methods</h3>
              <p className="field-hint">Manage the payment methods available to customers.</p>
              {(() => {
                const methods = settings.payment?.payment_methods;
                if (!Array.isArray(methods) || methods.length === 0) {
                  return <p className="field-hint">No payment methods configured yet.</p>;
                }
                return (
                  <div className="payment-methods-admin-list">
                    {methods.map((m) => (
                      <div key={m.id} className="payment-methods-admin-row">
                        <div className="payment-methods-admin-info">
                          <strong>{m.label}</strong>
                          <span>{m.description || m.id}</span>
                        </div>
                        <span className={`payment-methods-admin-status ${m.enabled === false ? "disabled" : ""}`}>
                          {m.enabled === false ? "Disabled" : "Enabled"}
                        </span>
                        <button
                          className="btn btn-secondary"
                          onClick={() => navigate(`/settings/payments/edit/${m.id}`)}
                        >
                          Edit
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          <div className="settings-form">
            {Object.entries(formValues).filter(([key]) => {
              // Hide the raw JSON and master switch when the dedicated Restaurant Ordering card is shown
              if (activeGroup === "restaurant" && (key === "opening_hours" || key === "online_ordering_enabled")) return false;
              return true;
            }).map(([key, value]) => {
              const inputType = getInputType(key, groupSettings[key]);
                return (
                  <div key={key} className="setting-field">
                    <label>{getLabel(key)}</label>
                    {key === "hero_image" || key === "hero_video" ? (
                      <MediaField
                        kind={key}
                        value={value}
                        onUploaded={(url) => handleChange(key, url)}
                        onRemoved={() => handleChange(key, "")}
                      />
                    ) : key === "about_content" ? (
                      <textarea
                        rows={5}
                        value={value}
                        onChange={e => handleChange(key, e.target.value)}
                      />
                    ) : inputType === "checkbox" ? (
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={value}
                        onChange={e => handleChange(key, e.target.checked)}
                      />
                      <span className="slider"></span>
                    </label>
                  ) : inputType === "number" ? (
                    <input
                      type="number"
                      step="any"
                      value={value}
                      onChange={e => handleChange(key, e.target.value)}
                    />
                  ) : (
                    <input
                      type={inputType}
                      value={value}
                      onChange={e => handleChange(key, e.target.value)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </main>
      </div>
    </div>
  );
}

const MEDIA_ACCEPT = {
  hero_image: "image/jpeg,image/png,image/webp,image/gif",
  hero_video: "video/mp4,video/webm",
};

function MediaField({ kind, value, onUploaded, onRemoved }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const isImage = kind === "hero_image";

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError("");
    setProgress(0);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", kind);
      const res = await settingsAPI.uploadMedia(fd, (e) => {
        if (e.total) setProgress(Math.round((e.loaded / e.total) * 100));
      });
      if (res.data?.success) {
        onUploaded(res.data.url);
        setFile(null);
      } else {
        setError(res.data?.message || "Upload failed");
      }
    } catch (err) {
      setError(err.response?.data?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    setError("");
    setUploading(true);
    try {
      const res = await settingsAPI.removeMedia(kind);
      if (res.data?.success) onRemoved();
      else setError(res.data?.message || "Remove failed");
    } catch (err) {
      setError(err.response?.data?.message || "Remove failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="media-field">
      {value ? (
        isImage ? (
          <img src={value} alt="Hero preview" className="media-preview" />
        ) : (
          <video src={value} controls className="media-preview" />
        )
      ) : (
        <div className="media-empty">No media configured — fallback will be used</div>
      )}

      <div className="media-controls">
        <input
          ref={inputRef}
          type="file"
          accept={MEDIA_ACCEPT[kind]}
          style={{ display: "none" }}
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            setError("");
          }}
          disabled={uploading}
        />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          Choose file
        </button>
        {file && <span className="media-filename">{file.name}</span>}
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleUpload}
          disabled={!file || uploading}
        >
          {uploading ? `Uploading ${progress}%` : "Upload"}
        </button>
        {value && (
          <button
            type="button"
            className="btn btn-danger"
            onClick={handleRemove}
            disabled={uploading}
          >
            Remove
          </button>
        )}
      </div>

      {uploading && <div className="media-progress">Uploading… {progress}%</div>}
      {error && <div className="toast error">{error}</div>}
    </div>
  );
}