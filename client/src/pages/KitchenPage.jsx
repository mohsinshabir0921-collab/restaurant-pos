import { useState, useEffect, useMemo, useRef } from "react";
import { orderAPI, tableAPI } from "../services/api";
import { getOrderItemSize, getOrderItemAddons } from "../utils/orderItem";

export default function KitchenPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [updatingItem, setUpdatingItem] = useState(null);
  const [error, setError] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [stationFilter, setStationFilter] = useState("all");
  const notificationAudioRef = useRef(null);

  useEffect(() => {
    notificationAudioRef.current = new Audio("/notification.mp3");
  }, []);

  const playNotificationSound = () => {
    if (!soundEnabled || !notificationAudioRef.current) return;
    notificationAudioRef.current.currentTime = 0;
    notificationAudioRef.current.play().catch(() => {});
  };

  const fetchKitchenOrders = async () => {
    try {
      setError("");
      const res = await orderAPI.getKitchenOrders();
      if (res.data.success) {
        const newOrders = res.data.orders;
        
        // Check for new orders
        const prevIds = orders.map(o => o._id);
        const newIds = newOrders.map(o => o._id);
        const hasNew = newIds.some(id => !prevIds.includes(id));
        if (hasNew && orders.length > 0) playNotificationSound();
        
        setOrders(newOrders);
      }
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load kitchen orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKitchenOrders();
    const interval = setInterval(fetchKitchenOrders, 5000);
    return () => clearInterval(interval);
  }, []);

  const stationOptions = useMemo(() => {
    const stations = new Set();
    orders.forEach((o) => (o.items || []).forEach((i) => { if (i.kitchenStation) stations.add(i.kitchenStation); }));
    return [...stations];
  }, [orders]);

  const displayOrders = useMemo(() => {
    if (!stationFilter || stationFilter === "all") return orders;
    return orders.filter((o) => (o.items || []).some((i) => i.kitchenStation === stationFilter));
  }, [orders, stationFilter]);

  const groupedOrders = useMemo(() => ({
    pending: displayOrders.filter(o => ["pending", "confirmed"].includes(o.orderStatus)),
    preparing: displayOrders.filter(o => o.orderStatus === "preparing"),
    ready: displayOrders.filter(o => o.orderStatus === "ready"),
    served: displayOrders.filter(o => o.orderStatus === "served"),
  }), [displayOrders]);

  const updateStatus = async (orderId, orderStatus) => {
    try {
      setUpdatingId(orderId);
      const res = await orderAPI.updateStatus(orderId, orderStatus);
      if (res.data.success) {
        await fetchKitchenOrders();
      }
    } catch (err) {
      setError(err.response?.data?.message || "Status update failed");
    } finally {
      setUpdatingId(null);
    }
  };

  const updateItemStatus = async (orderId, itemIndex, kitchenStatus) => {
    const key = `${orderId}-${itemIndex}`;
    try {
      setUpdatingItem(key);
      const res = await orderAPI.updateItemStatus(orderId, itemIndex, kitchenStatus);
      if (res.data.success) {
        setOrders(prev => prev.map(o => o._id === orderId ? res.data.order : o));
      }
    } catch (err) {
      setError(err.response?.data?.message || "Item status update failed");
    } finally {
      setUpdatingItem(null);
    }
  };

  const getMinutesAgo = (dateString) => {
    const now = new Date();
    const created = new Date(dateString);
    const diffMs = now - created;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "Just now";
    if (mins === 1) return "1 min ago";
    if (mins < 60) return `${mins} mins ago`;
    const hours = Math.floor(mins / 60);
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  };

  const getStationColor = (item) => {
    const station = item.kitchenStation || "";
    if (station.includes("grill") || station.includes("tandoor")) return "border-red";
    if (station.includes("fry")) return "border-orange";
    if (station.includes("curry") || station.includes("gravy")) return "border-yellow";
    if (station.includes("cold") || station.includes("beverage") || station.includes("bar")) return "border-blue";
    if (station.includes("dessert")) return "border-pink";
    return "border-gray";
  };

  const renderOrderCard = (order, columnStatus) => (
    <div key={order._id} className={`kitchen-ticket ${columnStatus}`}>
      <div className="ticket-header">
        <div className="ticket-title-block">
          <span className="ticket-number">#{order.orderNumber || order._id.slice(-6)}</span>
          <span className="ticket-type">{order.orderType === "dinein" ? `Table ${order.tableNo}` : order.orderType.charAt(0).toUpperCase() + order.orderType.slice(1)}</span>
        </div>
        <span className={`status-badge ${order.orderStatus}`}>{order.orderStatus}</span>
      </div>
      <div className="ticket-meta">
        <span className="meta-item">🕒 {getMinutesAgo(order.createdAt)}</span>
        <span className="meta-item">₹{Number(order.total || 0).toLocaleString("en-IN")}</span>
        <span className="meta-item">{order.paymentMethod}</span>
      </div>
      {order.orderType === "dinein" ? (
        <p className="customer-name">Waiter: {order.servedBy?.name || "-"}</p>
      ) : (
        <p className="customer-name">{order.customerName || "Walk-in Customer"}</p>
      )}

      <div className="ticket-items">
        {(order.items || []).map((item, index) => {
          const itemStatus = item.kitchenStatus || "pending";
          const updating = updatingItem === `${order._id}-${index}`;
          const size = getOrderItemSize(item);
          const addons = getOrderItemAddons(item);
          return (
            <div key={index} className={`ticket-item ${getStationColor(item)}`}>
              <div className="ticket-item-info">
                <span className="qty">{item.qty}×</span>
                <span className="item-name">{item.name}</span>
                {item.kitchenStation && <span className="item-note">@{item.kitchenStation}</span>}
                {size && <span className="item-note item-size">Size: {size}</span>}
                {addons.length > 0 && <span className="item-note">{addons.join(", ")}</span>}
                {item.notes && <span className="item-note item-note-special">Note: {item.notes}</span>}
              </div>
              <div className="ticket-item-side">
                <div className="ticket-item-total">₹{Number(item.price || 0) * Number(item.qty || 0)}</div>
                <span className={`status-badge ${itemStatus}`}>{itemStatus}</span>
                {itemStatus === "pending" && (
                  <button onClick={() => updateItemStatus(order._id, index, "preparing")} disabled={updating} className="btn btn-primary btn-sm">
                    {updating ? "..." : "Start"}
                  </button>
                )}
                {itemStatus === "preparing" && (
                  <button onClick={() => updateItemStatus(order._id, index, "ready")} disabled={updating} className="btn btn-success btn-sm">
                    {updating ? "..." : "Ready"}
                  </button>
                )}
                {itemStatus === "ready" && (
                  <button onClick={() => updateItemStatus(order._id, index, "served")} disabled={updating} className="btn btn-info btn-sm">
                    {updating ? "..." : "Served"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="ticket-actions">
        {order.orderStatus === "pending" && (
          <button onClick={() => updateStatus(order._id, "confirmed")} disabled={updatingId === order._id} className="btn btn-primary btn-sm">
            {updatingId === order._id ? "..." : "Confirm"}
          </button>
        )}
        {order.orderStatus === "confirmed" && (
          <button onClick={() => updateStatus(order._id, "preparing")} disabled={updatingId === order._id} className="btn btn-primary btn-sm">
            {updatingId === order._id ? "..." : "Start Preparing"}
          </button>
        )}
        {order.orderStatus === "preparing" && (
          <button onClick={() => updateStatus(order._id, "ready")} disabled={updatingId === order._id} className="btn btn-success btn-sm">
            {updatingId === order._id ? "..." : "Mark Ready"}
          </button>
        )}
        {order.orderStatus === "ready" && (
          <button onClick={() => updateStatus(order._id, "served")} disabled={updatingId === order._id} className="btn btn-info btn-sm">
            {updatingId === order._id ? "..." : "Mark Served"}
          </button>
        )}
        {order.orderStatus === "served" && (
          <button onClick={() => updateStatus(order._id, "paid")} disabled={updatingId === order._id} className="btn btn-primary btn-sm">
            {updatingId === order._id ? "..." : "Mark Paid"}
          </button>
        )}
      </div>
    </div>
  );

  const columns = [
    { key: "pending", label: "Pending", orders: groupedOrders.pending },
    { key: "preparing", label: "Preparing", orders: groupedOrders.preparing.filter(o => o.orderStatus === "preparing") },
    { key: "ready", label: "Ready", orders: groupedOrders.ready },
    { key: "served", label: "Served", orders: groupedOrders.served },
  ];

  const totalActive = groupedOrders.pending.length + groupedOrders.preparing.filter(o => o.orderStatus === "preparing").length + groupedOrders.ready.length;

  return (
    <div className="kitchen-view">
      <div className="page-header">
        <div>
          <h1>Kitchen Display</h1>
          <p className="page-subtitle">Live order tickets across all kitchen stations</p>
        </div>
        <div className="header-controls">
          <div className="header-stats">
            <span className="stat-chip"><strong>{totalActive}</strong> active</span>
            <span className="stat-chip"><strong>{groupedOrders.pending.length}</strong> pending</span>
            <span className="stat-chip"><strong>{groupedOrders.ready.length}</strong> ready</span>
          </div>
          <label className="sound-toggle">
            <input type="checkbox" checked={soundEnabled} onChange={(e) => setSoundEnabled(e.target.checked)} />
            <span className="sound-toggle-switch"></span>
            Sound
          </label>
          <select
            className="form-select"
            value={stationFilter}
            onChange={(e) => setStationFilter(e.target.value)}
            aria-label="Filter by station"
          >
            <option value="all">All Stations</option>
            {stationOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button className="btn btn-secondary" onClick={fetchKitchenOrders}>Refresh</button>
        </div>
      </div>

      {loading ? (
        <div className="loading"><span className="spinner spinner-lg"></span><span>Loading kitchen orders...</span></div>
      ) : error ? (
        <div className="toast error">{error}</div>
      ) : (
        <div className="kitchen-board">
          {columns.map(col => (
            <div className={`kitchen-column ${col.key}`} key={col.key}>
              <div className="column-header" data-status={col.key}>
                <span>{col.label}</span>
                <span className="count">{col.orders.length}</span>
              </div>
              <div className="column-body">
                {col.orders.length > 0 ? col.orders.map(o => renderOrderCard(o, col.key)) : (
                  <div className="empty-state column-empty">
                    <div className="empty-state-icon">{col.key === "ready" ? "✅" : col.key === "served" ? "🛎️" : "🍳"}</div>
                    <p className="empty-state-title">No {col.label.toLowerCase()} orders</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}