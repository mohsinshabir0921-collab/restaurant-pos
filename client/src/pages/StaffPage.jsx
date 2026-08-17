import { useState, useEffect } from "react";
import { authAPI } from "../services/api";

export default function StaffPage() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordData, setPasswordData] = useState({ currentPassword: "", newPassword: "" });
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    role: "cashier",
    isActive: true,
  });

  const fetchStaff = async () => {
    try {
      const res = await authAPI.getStaff({ limit: 50 });
      if (res.data.success) setStaff(res.data.staff);
    } catch (err) {
      setError("Failed to load staff");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStaff();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      if (editingStaff) {
        await authAPI.updateStaff(editingStaff._id, formData);
      } else {
        await authAPI.registerUser(formData);
      }
      setShowModal(false);
      fetchStaff();
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const openModal = (member = null) => {
    if (member) {
      setEditingStaff(member);
      setFormData({
        name: member.name,
        email: member.email,
        role: member.role,
        isActive: member.isActive,
      });
    } else {
      setEditingStaff(null);
      setFormData({
        name: "",
        email: "",
        role: "cashier",
        isActive: true,
      });
    }
    setShowModal(true);
  };

  const openPasswordModal = (member) => {
    setEditingStaff(member);
    setPasswordData({ currentPassword: "", newPassword: "" });
    setShowPasswordModal(true);
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (!passwordData.currentPassword || !passwordData.newPassword) return;
    try {
      await authAPI.changePassword(editingStaff._id, passwordData);
      setShowPasswordModal(false);
    } catch (err) {
      setError(err.response?.data?.message || "Password change failed");
    }
  };

  const handleDeactivate = async (id) => {
    if (!confirm("Deactivate this staff member?")) return;
    try {
      await authAPI.deactivateStaff(id);
      fetchStaff();
    } catch (err) {
      setError(err.response?.data?.message || "Deactivation failed");
    }
  };

  const handleToggleActive = async (member) => {
    try {
      if (member.isActive) {
        await authAPI.deactivateStaff(member._id);
      } else {
        await authAPI.updateStaff(member._id, { isActive: true });
      }
      fetchStaff();
    } catch (err) {
      setError(err.response?.data?.message || "Update failed");
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="staff-page">
      <div className="page-header">
        <h1>Staff Management</h1>
        <button className="btn btn-primary" onClick={() => openModal()}>Add Staff</button>
      </div>

      {error && <div className="toast error">{error}</div>}

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map(member => (
              <tr key={member._id}>
                <td>{member.name}</td>
                <td>{member.email}</td>
                <td><span className={`role-badge ${member.role}`}>{member.role}</span></td>
                <td>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={member.isActive} onChange={() => handleToggleActive(member)} />
                    <span className="slider"></span>
                  </label>
                </td>
                <td>
                  <button className="btn btn-sm btn-secondary" onClick={() => openModal(member)}>Edit</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => openPasswordModal(member)}>Password</button>
                  {member.isActive && (
                    <button className="btn btn-sm btn-danger" onClick={() => handleDeactivate(member._id)}>Deactivate</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingStaff ? "Edit Staff" : "Add Staff"}</h3>
              <button onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Name *</label>
                  <input type="text" value={formData.name} onChange={e => setFormData(d => ({ ...d, name: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Email *</label>
                  <input type="email" value={formData.email} onChange={e => setFormData(d => ({ ...d, email: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Role *</label>
                  <select value={formData.role} onChange={e => setFormData(d => ({ ...d, role: e.target.value }))}>
                    <option value="admin">Admin</option>
                    <option value="cashier">Cashier</option>
                    <option value="kitchen">Kitchen</option>
                    <option value="delivery">Delivery</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Active</label>
                  <select value={formData.isActive} onChange={e => setFormData(d => ({ ...d, isActive: e.target.value === "true" }))}>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
                {editingStaff ? (
                    <div className="form-group full-width">
                      <label>Password</label>
                      <p className="form-hint">Leave blank to keep current password</p>
                      <input type="password" placeholder="New password (min 6 chars)" onChange={e => setFormData(d => ({ ...d, password: e.target.value }))} />
                    </div>
                  ) : (
                    <div className="form-group full-width">
                      <label>Password *</label>
                      <input type="password" placeholder="Password (min 6 chars)" onChange={e => setFormData(d => ({ ...d, password: e.target.value }))} required minLength={6} />
                    </div>
                  )}
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPasswordModal && editingStaff && (
        <div className="modal-overlay" onClick={() => setShowPasswordModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Change Password for {editingStaff.name}</h3>
              <button onClick={() => setShowPasswordModal(false)}>×</button>
            </div>
            <form onSubmit={handlePasswordChange}>
              <div className="form-grid">
                <div className="form-group full-width">
                  <label>Current Password *</label>
                  <input type="password" value={passwordData.currentPassword} onChange={e => setPasswordData(d => ({ ...d, currentPassword: e.target.value }))} required />
                </div>
                <div className="form-group full-width">
                  <label>New Password *</label>
                  <input type="password" value={passwordData.newPassword} onChange={e => setPasswordData(d => ({ ...d, newPassword: e.target.value }))} required minLength={6} />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowPasswordModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Change Password</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}