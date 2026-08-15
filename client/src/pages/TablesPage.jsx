import { useState, useEffect, useRef } from "react";
import { tableAPI } from "../services/api";

export default function TablesPage() {
  const [tables, setTables] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingTable, setEditingTable] = useState(null);
  const [formData, setFormData] = useState({
    number: "",
    name: "",
    capacity: 4,
    zone: "Main Hall",
    shape: "rectangle",
    position: { x: 100, y: 100 },
    dimensions: { width: 80, height: 80 },
    rotation: 0,
    isActive: true,
  });
  const [editMode, setEditMode] = useState(false);
  const canvasRef = useRef(null);
  const [selectedTableId, setSelectedTableId] = useState(null);
  const [dragState, setDragState] = useState(null);

  const fetchTables = async () => {
    try {
      const res = await tableAPI.getFloorPlan();
      if (res.data.success) {
        setTables(res.data.tables);
        // Convert zones object to array
        const zonesArray = Object.entries(res.data.zones || {}).map(([name, tables]) => ({ name, tables }));
        setZones(zonesArray);
      }
    } catch (err) {
      setError("Failed to load tables");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTables();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    const data = {
      ...formData,
      number: Number(formData.number),
      capacity: Number(formData.capacity),
      position: formData.position,
      dimensions: formData.dimensions,
      rotation: Number(formData.rotation),
    };

    try {
      if (editingTable) {
        await tableAPI.update(editingTable._id, data);
      } else {
        await tableAPI.create(data);
      }
      setShowModal(false);
      fetchTables();
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field, value) => setFormData(d => ({ ...d, [field]: value }));
  const updateNumberField = (field, value) => setFormData(d => ({ ...d, [field]: Number(value) || 0 }));
  const updatePosition = (field, value) => setFormData(d => ({ ...d, position: { ...d.position, [field]: Number(value) || 0 } }));
  const updateDimensions = (field, value) => setFormData(d => ({ ...d, dimensions: { ...d.dimensions, [field]: Number(value) || 0 } }));
  const updateBooleanField = (field, value) => setFormData(d => ({ ...d, [field]: value === "true" }));

  const openModal = (table = null) => {
    if (table) {
      setEditingTable(table);
      setFormData({
        number: table.number,
        name: table.name || "",
        capacity: table.capacity,
        zone: table.zone,
        shape: table.shape,
        position: table.position || { x: 100, y: 100 },
        dimensions: table.dimensions || { width: 80, height: 80 },
        rotation: table.rotation || 0,
        isActive: table.isActive !== false,
      });
    } else {
      setEditingTable(null);
      const maxNum = tables.length > 0 ? Math.max(...tables.map(t => t.number)) : 0;
      setFormData({
        number: maxNum + 1,
        name: "",
        capacity: 4,
        zone: zones[0]?.name || "Main Hall",
        shape: "rectangle",
        position: { x: 100, y: 100 },
        dimensions: { width: 80, height: 80 },
        rotation: 0,
        isActive: true,
      });
    }
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this table?")) return;
    try {
      await tableAPI.delete(id);
      fetchTables();
    } catch (err) {
      setError(err.response?.data?.message || "Delete failed");
    }
  };

  const handleStatusChange = async (id, status) => {
    try {
      await tableAPI.updateStatus(id, status);
      fetchTables();
    } catch (err) {
      setError(err.response?.data?.message || "Status update failed");
    }
  };

  const startDrag = (e, table) => {
    if (!editMode) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    setDragState({
      tableId: table._id,
      startX: e.clientX - rect.left,
      startY: e.clientY - rect.top,
      tableX: table.position.x,
      tableY: table.position.y,
    });
  };

  const handleDrag = (e) => {
    if (!dragState) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - dragState.startX + dragState.tableX;
    const y = e.clientY - rect.top - dragState.startY + dragState.tableY;
    
    setTables(prev => prev.map(t => 
      t._id === dragState.tableId 
        ? { ...t, position: { x: Math.max(0, x), y: Math.max(0, y) } } 
        : t
    ));
  };

  const endDrag = () => {
    if (dragState) {
      const table = tables.find(t => t._id === dragState.tableId);
      if (table) {
        tableAPI.update(table._id, { position: table.position });
      }
    }
    setDragState(null);
  };

  useEffect(() => {
    if (dragState) {
      window.addEventListener("mousemove", handleDrag);
      window.addEventListener("mouseup", endDrag);
      return () => {
        window.removeEventListener("mousemove", handleDrag);
        window.removeEventListener("mouseup", endDrag);
      };
    }
  }, [dragState]);

  const renderTable = (table) => {
    const { x, y } = table.position;
    const { width, height } = table.dimensions;
    const rotation = table.rotation || 0;
    const isSelected = selectedTableId === table._id;
    const isOccupied = table.status === "occupied";

    const style = {
      left: x,
      top: y,
      width,
      height,
      transform: `rotate(${rotation}deg)`,
    };

    return (
      <div
        key={table._id}
        className={`table-shape ${table.shape} ${table.status} ${isSelected ? "selected" : ""} ${isOccupied ? "occupied" : ""}`}
        style={style}
        onClick={() => editMode && setSelectedTableId(table._id)}
        onMouseDown={e => startDrag(e, table)}
      >
        <span className="table-number">{table.number}</span>
        <span className="table-capacity">{table.capacity}</span>
        {isOccupied && <span className="occupied-badge">Occupied</span>}
      </div>
    );
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="tables-page">
      <div className="page-header">
        <h1>Table Management</h1>
        <div className="header-actions">
          <label className="toggle-switch">
            <input type="checkbox" checked={editMode} onChange={e => setEditMode(e.target.checked)} />
            <span className="slider"></span>
            Edit Mode
          </label>
          <button className="btn btn-primary" onClick={() => openModal()}>Add Table</button>
        </div>
      </div>

      {error && <div className="toast error">{error}</div>}

      <div className="tables-layout">
        <aside className="tables-sidebar">
          <h3>Zones</h3>
          {zones.map(zone => (
            <div key={zone.name} className="zone-card">
              <h4>{zone.name} ({zone.tables.length})</h4>
              <div className="zone-tables">
                {zone.tables.map(table => (
                  <div key={table._id} className={`zone-table ${table.status}`}>
                    <span>T{table.number}</span>
                    <span>{table.capacity} seats</span>
                    <select
                      value={table.status}
                      onChange={e => handleStatusChange(table._id, e.target.value)}
                      className="status-select"
                    >
                      <option value="free">Free</option>
                      <option value="occupied">Occupied</option>
                      <option value="reserved">Reserved</option>
                      <option value="cleaning">Cleaning</option>
                      <option value="maintenance">Maintenance</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </aside>

        <main className="tables-main">
          {editMode ? (
            <div className="floor-plan-editor">
              <div className="editor-toolbar">
                <h3>Floor Plan Editor</h3>
                <p>Click a table to select, drag to move. Changes auto-save.</p>
              </div>
              <div className="canvas-container" ref={canvasRef}>
                {zones.map(zone => (
                  <div key={zone.name} className="zone-area">
                    <h4>{zone.name}</h4>
                    <div className="zone-canvas">
                      {zone.tables.map(renderTable)}
                    </div>
                  </div>
                ))}
              </div>
              
              {selectedTableId && (
                <div className="table-properties">
                  <h4>Table Properties</h4>
                  <table>
                    <tbody>
                      <tr><td>Number</td><td>{tables.find(t => t._id === selectedTableId)?.number}</td></tr>
                      <tr><td>Zone</td><td>{tables.find(t => t._id === selectedTableId)?.zone}</td></tr>
                      <tr><td>Status</td><td>{tables.find(t => t._id === selectedTableId)?.status}</td></tr>
                      <tr><td>Position</td><td>X: {tables.find(t => t._id === selectedTableId)?.position.x}, Y: {tables.find(t => t._id === selectedTableId)?.position.y}</td></tr>
                    </tbody>
                  </table>
                  <button className="btn btn-secondary" onClick={() => setSelectedTableId(null)}>Deselect</button>
                </div>
              )}
            </div>
          ) : (
            <div className="tables-grid">
              {zones.map(zone => (
                <div key={zone.name} className="zone-section">
                  <h3>{zone.name}</h3>
                  <div className="tables-grid-inner">
                    {zone.tables.map(table => (
                      <div key={table._id} className={`table-card ${table.status}`}>
                        <div className="table-icon">
                          <span className={`shape-indicator ${table.shape}`}></span>
                          <span className="table-num">{table.number}</span>
                        </div>
                        <div className="table-info">
                          <h4>{table.name || `Table ${table.number}`}</h4>
                          <p>Capacity: {table.capacity}</p>
                          <span className={`status-badge ${table.status}`}>{table.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal large" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingTable ? "Edit Table" : "Add Table"}</h3>
              <button onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Table Number *</label>
                  <input type="number" min="1" value={formData.number} onChange={e => updateField("number", e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Name</label>
                  <input type="text" value={formData.name} onChange={e => updateField("name", e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Capacity *</label>
                  <input type="number" min="1" value={formData.capacity} onChange={e => updateNumberField("capacity", e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Zone</label>
                  <select value={formData.zone} onChange={e => updateField("zone", e.target.value)}>
                    {zones.map(z => <option key={z.name} value={z.name}>{z.name}</option>)}
                    <option value="New Zone">+ New Zone</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Shape</label>
                  <select value={formData.shape} onChange={e => updateField("shape", e.target.value)}>
                    <option value="rectangle">Rectangle</option>
                    <option value="circle">Circle</option>
                    <option value="square">Square</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Rotation</label>
                  <input type="number" step="90" value={formData.rotation} onChange={e => updateNumberField("rotation", e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Active</label>
                  <select value={formData.isActive ? "true" : "false"} onChange={e => updateBooleanField("isActive", e.target.value)}>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
                <div className="form-group full-width">
                  <label>Position (X, Y)</label>
                  <div className="input-row">
                    <input type="number" placeholder="X" value={formData.position.x} onChange={e => updatePosition("x", e.target.value)} />
                    <input type="number" placeholder="Y" value={formData.position.y} onChange={e => updatePosition("y", e.target.value)} />
                  </div>
                </div>
                <div className="form-group full-width">
                  <label>Dimensions (W, H)</label>
                  <div className="input-row">
                    <input type="number" placeholder="Width" value={formData.dimensions.width} onChange={e => updateDimensions("width", e.target.value)} />
                    <input type="number" placeholder="Height" value={formData.dimensions.height} onChange={e => updateDimensions("height", e.target.value)} />
                  </div>
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