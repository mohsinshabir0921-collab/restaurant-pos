import { useState, useEffect, useRef } from "react";
import { settingsAPI } from "../services/api";
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

export default function SettingsPage() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeGroup, setActiveGroup] = useState("restaurant");
  const [formData, setFormData] = useState({});
  const [testMsg, setTestMsg] = useState("");
  const [testing, setTesting] = useState(false);

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

          <div className="settings-form">
            {Object.entries(formValues).map(([key, value]) => {
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