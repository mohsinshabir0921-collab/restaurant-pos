import { useState, useEffect } from "react";
import { loyaltyAPI, customerAPI } from "../services/api";

const formatCurrency = (v) => `₹${Number(v||0).toLocaleString("en-IN")}`;
const tierColors = { bronze: "#cd7f32", silver: "#c0c0c0", gold: "#ffd700", platinum: "#e5e4e2" };

export default function LoyaltyPage() {
  const [config, setConfig] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("config");
  const [search, setSearch] = useState("");
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [pointsAdjustment, setPointsAdjustment] = useState({ points: 0, reason: "" });

  const fetchData = async () => {
    try {
      const [c, cu] = await Promise.all([loyaltyAPI.getConfig(), customerAPI.getAll({ limit: 200 })]);
      if (c.data.success) setConfig(c.data.config);
      if (cu.data.success) setCustomers(cu.data.customers);
    } catch (err) { setError("Failed to load"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const updateConfig = (field, value) => setConfig(d => ({ ...d, [field]: value }));
  const updateConfigNumber = (field, value) => setConfig(d => ({ ...d, [field]: Number(value) || 0 }));
  const updateConfigBoolean = (field, value) => setConfig(d => ({ ...d, [field]: value === "true" }));

  const handleConfigSave = async (e) => {
    e.preventDefault(); setSaving(true); setError("");
    try {
      const data = { ...config };
      await loyaltyAPI.updateConfig(data);
      setConfig(data);
    } catch (err) { setError(err.response?.data?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  const handlePointsAdjust = async () => {
    if (!editingCustomer || !pointsAdjustment.points || !pointsAdjustment.reason) return;
    try {
      await loyaltyAPI.adjustPoints(editingCustomer._id, { points: Number(pointsAdjustment.points), reason: pointsAdjustment.reason });
      fetchData();
      setEditingCustomer(null);
      setPointsAdjustment({ points: 0, reason: "" });
    } catch (err) { setError(err.response?.data?.message || "Adjustment failed"); }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="loyalty-page">
      <div className="page-header"><h1>Loyalty Program</h1></div>
      {error && <div className="toast error">{error}</div>}
      <div className="tabs">
        <button className={activeTab === "config" ? "active" : ""} onClick={() => setActiveTab("config")}>Configuration</button>
        <button className={activeTab === "customers" ? "active" : ""} onClick={() => setActiveTab("customers")}>Customers</button>
        <button className={activeTab === "tiers" ? "active" : ""} onClick={() => setActiveTab("tiers")}>Tiers</button>
      </div>

      {activeTab === "config" && config && (
        <div className="config-form">
          <form onSubmit={handleConfigSave}>
            <div className="form-grid">
              <div className="form-group"><label>Program Enabled</label><select value={config.isEnabled ? "true" : "false"} onChange={e => updateConfigBoolean("isEnabled", e.target.value)}><option value="true">Yes</option><option value="false">No</option></select></div>
              <div className="form-group"><label>Points per ₹</label><input type="number" step="0.01" value={config.pointsPerRupee} onChange={e => updateConfigNumber("pointsPerRupee", e.target.value)} /></div>
              <div className="form-group"><label>₹ per Point (Redemption)</label><input type="number" step="0.01" value={config.rupeePerPoint} onChange={e => updateConfigNumber("rupeePerPoint", e.target.value)} /></div>
              <div className="form-group"><label>Min Points to Redeem</label><input type="number" value={config.minPointsToRedeem} onChange={e => updateConfigNumber("minPointsToRedeem", e.target.value)} /></div>
              <div className="form-group"><label>Max Points/Order</label><input type="number" value={config.maxPointsPerOrder} onChange={e => updateConfigNumber("maxPointsPerOrder", e.target.value)} /></div>
              <div className="form-group"><label>Points Expiry (days)</label><input type="number" value={config.pointsExpiryDays} onChange={e => updateConfigNumber("pointsExpiryDays", e.target.value)} /></div>
              <div className="form-group"><label>Birthday Bonus Points</label><input type="number" value={config.birthdayBonusPoints} onChange={e => updateConfigNumber("birthdayBonusPoints", e.target.value)} /></div>
              <div className="form-group"><label>Referral Bonus Points</label><input type="number" value={config.referralBonusPoints} onChange={e => updateConfigNumber("referralBonusPoints", e.target.value)} /></div>
              <div className="form-group"><label>First Order Bonus</label><input type="number" value={config.firstOrderBonusPoints} onChange={e => updateConfigNumber("firstOrderBonusPoints", e.target.value)} /></div>
            </div>
            <div className="modal-actions"><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save Configuration"}</button></div>
          </form>
        </div>
      )}

      {activeTab === "tiers" && config && (
        <div className="tiers-grid">
          {config.tiers.map((tier, idx) => (
            <div key={idx} className="tier-card" style={{ borderLeft: `4px solid ${tierColors[tier.name]}`, background: `${tierColors[tier.name]}15` }}>
              <h4 style={{ color: tierColors[tier.name] }}>{tier.name.charAt(0).toUpperCase() + tier.name.slice(1)}</h4>
              <p><strong>Min Spend:</strong> {formatCurrency(tier.minSpend)}</p>
              <p><strong>Min Visits:</strong> {tier.minVisits}</p>
              <p><strong>Points Multiplier:</strong> {tier.pointsMultiplier}x</p>
              <p><strong>Benefits:</strong></p>
              <ul>{tier.benefits.map((b, i) => <li key={i}>{b}</li>)}</ul>
            </div>
          ))}
        </div>
      )}

      {activeTab === "customers" && (
        <div>
          <div className="filters"><input type="text" placeholder="Search customers..." value={search} onChange={e => setSearch(e.target.value)} /></div>
          <div className="table-container"><table><thead><tr><th>Name</th><th>Phone</th><th>Tier</th><th>Points</th><th>Total Spent</th><th>Visits</th><th>Actions</th></tr></thead><tbody>
            {customers.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)).map(c => (
              <tr key={c._id}>
                <td>{c.name}</td>
                <td>{c.phone}</td>
                <td><span className="tier-badge" style={{ background: tierColors[c.loyaltyTier] }}>{c.loyaltyTier}</span></td>
                <td>{c.loyaltyPoints}</td>
                <td>{formatCurrency(c.totalSpent)}</td>
                <td>{c.visitCount}</td>
                <td><button className="btn btn-sm btn-primary" onClick={() => { setEditingCustomer(c); setPointsAdjustment({ points: 0, reason: "" }); }}>Adjust Points</button></td>
              </tr>
            ))}
          </tbody></table></div>
        </div>
      )}

      {editingCustomer && (
        <div className="modal-overlay" onClick={() => setEditingCustomer(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Adjust Points: {editingCustomer.name}</h3><button onClick={() => setEditingCustomer(null)}>×</button></div>
            <form onSubmit={e => { e.preventDefault(); handlePointsAdjust(); }}>
              <div className="form-grid">
                <div className="form-group"><label>Points (+/-)</label><input type="number" value={pointsAdjustment.points} onChange={e => setPointsAdjustment(d => ({...d, points: Number(e.target.value)}))} required /></div>
                <div className="form-group"><label>Reason</label><input value={pointsAdjustment.reason} onChange={e => setPointsAdjustment(d => ({...d, reason: e.target.value}))} required /></div>
              </div>
              <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setEditingCustomer(null)}>Cancel</button><button type="submit" className="btn btn-primary">Apply</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}