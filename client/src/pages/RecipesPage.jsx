import { useState, useEffect } from "react";
import { recipeAPI, menuAPI, inventoryAPI } from "../services/api";

export default function RecipesPage() {
  const [recipes, setRecipes] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState(null);
  const [formData, setFormData] = useState({
    menuItem: "", ingredients: [], yieldQuantity: 1, yieldUnit: "portion", prepInstructions: "", prepTime: 0, isActive: true
  });

  const fetchData = async () => {
    try {
      const [r, m, i] = await Promise.all([
        recipeAPI.getAll({ limit: 100 }),
        menuAPI.getAll({ availableOnly: "true", limit: 200 }),
        inventoryAPI.getAll({ limit: 200 })
      ]);
      if (r.data.success) setRecipes(r.data.recipes);
      if (m.data.success) setMenuItems(m.data.menuItems);
      if (i.data.success) setInventoryItems(i.data.items);
    } catch (err) { setError("Failed to load data"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const openModal = (recipe = null) => {
    if (recipe) {
      setEditingRecipe(recipe);
      setFormData({
        menuItem: recipe.menuItem._id || recipe.menuItem,
        ingredients: recipe.ingredients.map(ing => ({ item: ing.item._id || ing.item, quantity: ing.quantity, unit: ing.unit, notes: ing.notes || "" })),
        yieldQuantity: recipe.yieldQuantity, yieldUnit: recipe.yieldUnit,
        prepInstructions: recipe.prepInstructions?.join("\n") || "", prepTime: recipe.prepTime, isActive: recipe.isActive
      });
    } else {
      setEditingRecipe(null);
      setFormData({ menuItem: "", ingredients: [], yieldQuantity: 1, yieldUnit: "portion", prepInstructions: "", prepTime: 0, isActive: true });
    }
    setShowModal(true);
  };

  const addIngredient = () => setFormData(d => ({ ...d, ingredients: [...d.ingredients, { item: "", quantity: 0, unit: "", notes: "" }] }));
  const removeIngredient = (idx) => setFormData(d => ({ ...d, ingredients: d.ingredients.filter((_, i) => i !== idx) }));
  const updateIngredient = (idx, field, value) => setFormData(d => { const ing = [...d.ingredients]; ing[idx] = { ...ing[idx], [field]: value }; return { ...d, ingredients: ing }; });

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true); setError("");
    try {
      const data = { ...formData, ingredients: formData.ingredients.filter(i => i.item).map(i => ({ ...i, quantity: Number(i.quantity) })), yieldQuantity: Math.max(1, Number(formData.yieldQuantity) || 1), prepInstructions: formData.prepInstructions.split("\n").filter(Boolean), prepTime: Number(formData.prepTime) };
      if (editingRecipe) await recipeAPI.update(editingRecipe._id, data);
      else await recipeAPI.create(data);
      setShowModal(false); fetchData();
    } catch (err) { setError(err.response?.data?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => { if (!confirm("Delete recipe?")) return; try { await recipeAPI.delete(id); fetchData(); } catch (err) { setError(err.response?.data?.message || "Delete failed"); } };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="recipes-page">
      <div className="page-header"><h1>Recipe Management</h1><button className="btn btn-primary" onClick={() => openModal()}>Create Recipe</button></div>
      {error && <div className="toast error">{error}</div>}
      <div className="table-container">
        <table><thead><tr><th>Menu Item</th><th>Yield</th><th>Ingredients</th><th>Prep Time</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {recipes.map(r => (
            <tr key={r._id}>
              <td>{r.menuItem?.name || "Unknown"}</td>
              <td>{r.yieldQuantity} {r.yieldUnit}</td>
              <td>{r.ingredients.map(ing => `${ing.item?.name || "Unknown"} (${ing.quantity} ${ing.unit})`).join(", ")}</td>
              <td>{r.prepTime} min</td>
              <td><span className={`status-badge ${r.isActive ? "active" : "inactive"}`}>{r.isActive ? "Active" : "Inactive"}</span></td>
              <td><button className="btn btn-sm btn-secondary" onClick={() => openModal(r)}>Edit</button><button className="btn btn-sm btn-danger" onClick={() => handleDelete(r._id)}>Delete</button></td>
            </tr>
          ))}
        </tbody></table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal large" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>{editingRecipe ? "Edit Recipe" : "Create Recipe"}</h3><button onClick={() => setShowModal(false)}>×</button></div>
            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                <div className="form-group"><label>Menu Item *</label><select value={formData.menuItem} onChange={e => setFormData(d => ({...d, menuItem: e.target.value}))} required><option value="">Select Menu Item</option>{menuItems.map(m => <option key={m._id} value={m._id}>{m.name}</option>)}</select></div>
                <div className="form-group"><label>Yield Quantity</label><input type="number" min="1" value={formData.yieldQuantity} onChange={e => setFormData(d => ({...d, yieldQuantity: e.target.value}))} /></div>
                <div className="form-group"><label>Yield Unit</label><input type="text" value={formData.yieldUnit} onChange={e => setFormData(d => ({...d, yieldUnit: e.target.value}))} /></div>
                <div className="form-group"><label>Prep Time (min)</label><input type="number" value={formData.prepTime} onChange={e => setFormData(d => ({...d, prepTime: e.target.value}))} /></div>
                <div className="form-group"><label>Active</label><select value={formData.isActive} onChange={e => setFormData(d => ({...d, isActive: e.target.value === "true"}))}><option value="true">Yes</option><option value="false">No</option></select></div>
              </div>
              <div className="form-group full-width"><label>Ingredients</label>
                {formData.ingredients.map((ing, idx) => (
                  <div key={idx} className="ingredient-row">
                    <select value={ing.item} onChange={e => updateIngredient(idx, "item", e.target.value)}><option value="">Select Ingredient</option>{inventoryItems.map(i => <option key={i._id} value={i._id}>{i.name} ({i.unit})</option>)}</select>
                    <input type="number" step="any" min="0" placeholder="Qty" value={ing.quantity} onChange={e => updateIngredient(idx, "quantity", e.target.value)} />
                    <input type="text" placeholder="Unit" value={ing.unit} onChange={e => updateIngredient(idx, "unit", e.target.value)} />
                    <input type="text" placeholder="Notes" value={ing.notes} onChange={e => updateIngredient(idx, "notes", e.target.value)} />
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => removeIngredient(idx)}>Remove</button>
                  </div>
                ))}
                <button type="button" className="btn btn-secondary btn-sm" onClick={addIngredient}>+ Add Ingredient</button>
              </div>
              <div className="form-group full-width"><label>Prep Instructions (one per line)</label><textarea value={formData.prepInstructions} onChange={e => setFormData(d => ({...d, prepInstructions: e.target.value}))} rows={4} /></div>
              <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save"}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}