import { useState, useEffect } from "react";
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

export default function SettingsPage() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeGroup, setActiveGroup] = useState("restaurant");
  const [formData, setFormData] = useState({});

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
          </div>

          <div className="settings-form">
            {Object.entries(formValues).map(([key, value]) => {
              const inputType = getInputType(key, groupSettings[key]);
              return (
                <div key={key} className="setting-field">
                  <label>{key.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}</label>
                  {inputType === "checkbox" ? (
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