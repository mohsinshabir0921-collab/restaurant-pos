import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import { useLocation, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { menuAPI, orderAPI, tableAPI, customerAPI, settingsAPI, paymentAPI, couponAPI, loyaltyAPI, categoryAPI, authAPI } from "../services/api";
import {
  IconPOS,
  IconKitchen,
  IconReports,
  IconMenu,
  IconRefresh,
  IconPlus,
  IconCustomers,
  IconLoyalty,
  IconTrash,
  IconChevronDown,
  IconCheck,
  IconRestaurant,
  IconBag,
  IconDelivery,
  IconBell,
} from "../components/icons";
import { OUTCOME, decidePaymentOutcome } from "../lib/paymentOutcome";
import SearchBox from "../components/SearchBox";
import { getOrderItemSize, getOrderItemAddons } from "../utils/orderItem";

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;

const formatAddress = (addr) => {
  if (!addr) return "";
  const cityState = [addr.city, addr.state].filter(Boolean).join(", ");
  const parts = [addr.line1, addr.line2, cityState].filter(Boolean);
  const str = parts.join(", ");
  return addr.pincode ? `${str} - ${addr.pincode}` : str;
};

const ORDER_TYPE_LABELS = { dinein: "Dine-in", takeaway: "Takeaway", delivery: "Delivery" };

const STATUS_GROUPS = {
  all: null,
  active: ["pending", "confirmed", "preparing", "ready", "served"],
  settled: ["paid", "completed"],
  cancelled: ["cancelled", "refunded"],
};

const PAYMENT_METHOD_LABELS = { cash: "Cash", upi: "UPI", card: "Card" };

// Order statuses staff may edit from the POS. Matches the server-side
// EDITABLE_ORDER_STATUSES in orderController.js.
const EDITABLE_ORDER_STATUSES = ["pending", "confirmed", "preparing", "paid"];

const timeAgo = (iso) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

// Dedicated "waiter" role for front-of-house staff serving Dine-In tables.
const WAITER_ROLES = ["waiter"];

const SEEN_ORDERS_KEY = "pos_seen_orders_v1";
const SOUND_ENABLED_KEY = "pos_sound_enabled_v2";
const POS_ALERT_DEDUP_MS = 5000;

const toLocalDateInput = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const toLocalTimeInput = (d = new Date()) => {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
};

  const printStyleFor = (thermal) => ({ fontFamily: "Arial, Helvetica, sans-serif", fontSize: thermal ? 11 : 12, color: "#000", width: thermal ? "58mm" : "100%", margin: "0 auto", lineHeight: 1.3, padding: thermal ? "2mm" : 0 });

  const numberToWords = (num) => {
    const n = Math.max(0, Math.round(Number(num) || 0));
    if (n === 0) return "Zero Rupees Only";
    const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
    const helper = (x) => {
      if (x < 20) return ones[x];
      if (x < 100) return tens[Math.floor(x / 10)] + (x % 10 ? " " + ones[x % 10] : "");
      if (x < 1000) return ones[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " " + helper(x % 100) : "");
      if (x < 100000) return helper(Math.floor(x / 1000)) + " Thousand" + (x % 1000 ? " " + helper(x % 1000) : "");
      return helper(Math.floor(x / 100000)) + " Lakh" + (x % 100000 ? " " + helper(x % 100000) : "");
    };
    return helper(n) + " Rupees Only";
  };
const printRow = (display, flex, space) => ({ display, justifyContent: space ? "space-between" : undefined, ...flex });

const KOTReceipt = ({ order, thermal = true }) => (
    <div style={printStyleFor(thermal)}>
    <div style={{ textAlign: "center" }}>
      <div style={{ fontWeight: 800, fontSize: 14 }}>KITCHEN ORDER TICKET</div>
      <div style={{ fontWeight: 700 }}>#{order.orderNumber || order._id}</div>
      <div style={{ fontWeight: 700 }}>{order.orderType === "dinein" ? `Table: ${order.tableNo || "-"}` : order.orderType.toUpperCase()}</div>
      {order.orderType === "dinein" && (
        <div>Waiter: {order.servedBy?.name || "-"}</div>
      )}
      <div style={{ fontSize: 10 }}>{new Date(order.createdAt).toLocaleString()}</div>
    </div>
    {order.notes ? (
      <div style={{ marginTop: 4, fontSize: 10, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>Note: {order.notes}</div>
    ) : null}
    <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
    {(order.items || []).map((item, i) => {
      const size = getOrderItemSize(item);
      const addons = getOrderItemAddons(item);
      return (
      <div key={i} style={{ marginBottom: 3 }}>
        <div style={{ fontWeight: 700 }}>{item.qty} x {item.name}{size ? ` [${size}]` : ""}</div>
        {addons.length > 0 && (
          <div style={{ paddingLeft: 6, fontSize: 10 }}>{addons.join(", ")}</div>
        )}
        {item.kitchenStation && (
          <div style={{ paddingLeft: 6, fontSize: 10 }}>Station: {item.kitchenStation}</div>
        )}
        {item.notes ? (
          <div style={{ paddingLeft: 6, fontSize: 10, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>Note: {item.notes}</div>
        ) : null}
      </div>
      );
    })}
    <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
    <div style={{ fontWeight: 700 }}>Status: {order.orderStatus}</div>
    <div style={{ textAlign: "center", marginTop: 6, fontWeight: 700 }}>--- END ---</div>
  </div>
);

const InvoiceReceipt = ({ order, restaurantName = "", restaurantAddress = "", restaurantPhone = "", gstin = "", header = "", footer = "", thermal = true }) => {
  const money = (v) => formatCurrency(v);
  const orderTypeLabel = ORDER_TYPE_LABELS[order.orderType] || order.orderType;
  const cgst = Number(order.cgst || 0);
  const sgst = Number(order.sgst || 0);
  const igst = Number(order.igst || 0);
  const taxBreakdown = cgst + sgst + igst;
  const taxTotal = Number(order.tax ?? taxBreakdown);
  const hasTax = taxBreakdown > 0 || taxTotal > 0;
  const hasServiceCharge = Number(order.serviceCharge) > 0;
  const hasDeliveryFee = Number(order.deliveryFee) > 0;
  const hasLoyalty = Number(order.loyaltyPointsUsed) > 0;
  const hasDiscount = Number(order.discount) > 0 || order.couponCode;
  const grandTotal = Number(order.total || 0);
  const created = order.createdAt ? new Date(order.createdAt) : null;
  const dateStr = created ? created.toLocaleDateString("en-IN") : "";
  const timeStr = created ? created.toLocaleTimeString("en-IN") : "";

  return (
    <div style={printStyleFor(thermal)}>
      {/* HEADER */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>{restaurantName || "Restaurant"}</div>
        {restaurantAddress && <div style={{ fontSize: 10 }}>{restaurantAddress}</div>}
        {restaurantPhone && <div style={{ fontSize: 10 }}>Ph: {restaurantPhone}</div>}
        {gstin && <div style={{ fontSize: 10 }}>GSTIN: {gstin}</div>}
        {header && <div style={{ fontSize: 10, marginTop: 1 }}>{header}</div>}
      </div>
      <div style={{ borderTop: "1px dashed #000", borderBottom: "1px dashed #000", margin: "4px 0", padding: "3px 0", textAlign: "center" }}>
        <div style={{ fontWeight: 800, fontSize: 12 }}>TAX INVOICE</div>
        <div style={{ fontWeight: 700, fontSize: 10 }}>Bill No: {order.orderNumber || order._id}</div>
        <div style={{ fontWeight: 700, fontSize: 10 }}>Date: {dateStr}  Time: {timeStr}</div>
      </div>

      {/* BILL DETAILS */}
      <div style={{ fontSize: 10, marginBottom: 4 }}>
        <div style={printRow("flex", {}, true)}><span style={{ fontWeight: 700 }}>Order Type</span><span style={{ fontWeight: 700 }}>{orderTypeLabel}</span></div>
        {order.orderType === "dinein" && order.tableNo ? (
          <div style={printRow("flex", {}, true)}><span style={{ fontWeight: 700 }}>Table</span><span style={{ fontWeight: 700 }}>{order.tableNo}</span></div>
        ) : null}
        {order.orderType === "dinein" ? (
          <div style={printRow("flex", {}, true)}><span>Waiter</span><span>{order.servedBy?.name || "-"}</span></div>
        ) : null}
        {order.orderType === "takeaway" && order.pickupAt ? (
          <div style={printRow("flex", {}, true)}><span>Pickup</span><span>{new Date(order.pickupAt).toLocaleString("en-IN")}</span></div>
        ) : null}
        {order.customerName && (
          <div style={printRow("flex", {}, true)}><span>Customer</span><span>{order.customerName}</span></div>
        )}
        {order.customerPhone && (
          <div style={printRow("flex", {}, true)}><span>Phone</span><span>{order.customerPhone}</span></div>
        )}
        {order.orderType === "delivery" && order.deliveryAddress && (
          <div style={{ marginTop: 2 }}>
            <div style={{ fontWeight: 700, fontSize: 10 }}>Deliver To:</div>
            <div style={{ paddingLeft: 4, fontSize: 10 }}>{formatAddress(order.deliveryAddress)}</div>
            {order.deliveryAddress?.distanceKm ? (
              <div style={{ paddingLeft: 4, fontSize: 10 }}>Distance: {order.deliveryAddress.distanceKm} km</div>
            ) : null}
          </div>
        )}
        {order.notes ? (
          <div style={{ marginTop: 2, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 10 }}>Note: </span>
            <span style={{ fontSize: 10 }}>{order.notes}</span>
          </div>
        ) : null}
      </div>

      <div style={{ borderTop: "1px solid #000", margin: "3px 0" }} />

      {/* ITEM TABLE */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "44%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "24%" }} />
        </colgroup>
        <thead>
          <tr style={{ borderBottom: "1px dashed #000" }}>
            <th style={{ textAlign: "left", padding: "2px 0", fontWeight: 700 }}>Item</th>
            <th style={{ textAlign: "right", padding: "2px 0", fontWeight: 700 }}>Qty</th>
            <th style={{ textAlign: "right", padding: "2px 0", fontWeight: 700 }}>Rate</th>
            <th style={{ textAlign: "right", padding: "2px 0", fontWeight: 700 }}>Amt</th>
          </tr>
        </thead>
        <tbody>
          {(order.items || []).map((item, i) => {
            const size = getOrderItemSize(item);
            const addons = getOrderItemAddons(item);
            return (
              <tr key={i} style={{ borderBottom: "1px dotted #ccc" }}>
                <td style={{ padding: "2px 2px 2px 0", verticalAlign: "top", wordBreak: "break-word", whiteSpace: "normal" }}>
                  <div style={{ fontWeight: 700 }}>{item.name}</div>
                  {(size || addons.length > 0 || item.notes) && (
                    <div style={{ fontSize: 9, marginTop: 1, lineHeight: 1.2 }}>
                      {size ? <div>Size: {size}</div> : null}
                      {addons.length > 0 ? <div>Add-ons: {addons.join(", ")}</div> : null}
                      {item.notes ? <div>Note: {item.notes}</div> : null}
                    </div>
                  )}
                </td>
                <td style={{ textAlign: "right", padding: "2px 0", verticalAlign: "top" }}>{item.qty}</td>
                <td style={{ textAlign: "right", padding: "2px 0", verticalAlign: "top" }}>{money(item.price)}</td>
                <td style={{ textAlign: "right", padding: "2px 0", verticalAlign: "top" }}>{money((item.price || 0) * (item.qty || 0))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ borderTop: "1px solid #000", margin: "3px 0" }} />

      {/* TOTAL SECTION */}
      <div style={{ fontSize: 10 }}>
        <div style={printRow("flex", {}, true)}><span style={{ fontWeight: 700 }}>Subtotal</span><span style={{ fontWeight: 700 }}>{money(order.subtotal)}</span></div>
        {hasDiscount && (
          <div style={printRow("flex", {}, true)}><span>Discount{order.couponCode ? ` (${order.couponCode})` : ""}</span><span>-{money(order.discount)}</span></div>
        )}
        {hasTax && taxBreakdown > 0 && (
          <>
            {cgst > 0 && <div style={printRow("flex", {}, true)}><span style={{ fontWeight: 700 }}>CGST</span><span style={{ fontWeight: 700 }}>{money(cgst)}</span></div>}
            {sgst > 0 && <div style={printRow("flex", {}, true)}><span style={{ fontWeight: 700 }}>SGST</span><span style={{ fontWeight: 700 }}>{money(sgst)}</span></div>}
            {igst > 0 && <div style={printRow("flex", {}, true)}><span style={{ fontWeight: 700 }}>IGST</span><span style={{ fontWeight: 700 }}>{money(igst)}</span></div>}
          </>
        )}
        {hasTax && taxBreakdown === 0 && <div style={printRow("flex", {}, true)}><span style={{ fontWeight: 700 }}>Tax</span><span style={{ fontWeight: 700 }}>{money(taxTotal)}</span></div>}
        {hasServiceCharge && <div style={printRow("flex", {}, true)}><span style={{ fontWeight: 700 }}>Service Charge</span><span style={{ fontWeight: 700 }}>{money(order.serviceCharge)}</span></div>}
        {hasDeliveryFee && <div style={printRow("flex", {}, true)}><span style={{ fontWeight: 700 }}>Delivery Charge</span><span style={{ fontWeight: 700 }}>{money(order.deliveryFee)}</span></div>}
        {hasLoyalty && <div style={printRow("flex", {}, true)}><span>Loyalty Used</span><span>{order.loyaltyPointsUsed} pts</span></div>}
      </div>

      <div style={{ borderTop: "1px solid #000", borderBottom: "2px solid #000", margin: "3px 0", padding: "3px 0", fontWeight: 800, fontSize: 12, display: "flex", justifyContent: "space-between" }}>
        <span>GRAND TOTAL</span><span>{money(grandTotal)}</span>
      </div>

      {/* PAYMENT */}
      <div style={{ fontSize: 10, marginTop: 3 }}>
        <div style={printRow("flex", {}, true)}><span style={{ fontWeight: 700 }}>Payment Mode</span><span style={{ fontWeight: 700 }}>{order.paymentMethod || "-"}</span></div>
        <div style={printRow("flex", {}, true)}><span style={{ fontWeight: 700 }}>Payment Status</span><span style={{ fontWeight: 700 }}>{order.paymentStatus || "-"}</span></div>
        {order.paymentStatus === "paid" ? (
          <div style={printRow("flex", {}, true)}><span style={{ fontWeight: 700 }}>Amount Paid</span><span style={{ fontWeight: 700 }}>{money(grandTotal)}</span></div>
        ) : (
          <div style={printRow("flex", {}, true)}><span style={{ fontWeight: 700 }}>Balance Due</span><span style={{ fontWeight: 700 }}>{money(grandTotal)}</span></div>
        )}
      </div>

      {/* FOOTER */}
      <div style={{ borderTop: "1px dashed #000", margin: "4px 0 0", paddingTop: 3, textAlign: "center", fontSize: 10 }}>
        <div style={{ fontSize: 9 }}>Amount in words: {numberToWords(grandTotal)}</div>
        <div style={{ marginTop: 3 }}>{footer || "Thank You, Visit Us Again!"}</div>
        <div style={{ marginTop: 2 }}>*</div>
      </div>
    </div>
  );
};

export default function POSPage() {
  const { user, hasRole } = useAuth();
  const isAdminOrCashier = hasRole(["admin", "cashier"]);
  const isKitchen = hasRole(["kitchen"]);

  const [activeTab, setActiveTab] = useState("pos");
  const [highlightedOrderId, setHighlightedOrderId] = useState(null);
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [menuLoading, setMenuLoading] = useState(true);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [error, setError] = useState("");

  const [menuItems, setMenuItems] = useState([]);
  const [allCategories, setAllCategories] = useState([]);
  const [tables, setTables] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef(null);
  const [selectedTable, setSelectedTable] = useState(null);
  const [selectedWaiter, setSelectedWaiter] = useState(null);
  const [waiterStaff, setWaiterStaff] = useState([]);

  const [cartItems, setCartItems] = useState([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerId, setCustomerId] = useState(null);
  const [orderType, setOrderType] = useState("dinein");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [splitPayments, setSplitPayments] = useState([
    { method: "cash", amount: "", reference: "" },
    { method: "cash", amount: "", reference: "" },
  ]);
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState(0);
  const [discountType, setDiscountType] = useState("flat");
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [posSettings, setPosSettings] = useState(null);
  const [loyaltyConfig, setLoyaltyConfig] = useState(null);
  const [couponCode, setCouponCode] = useState("");
  const [loyaltyPointsUsed, setLoyaltyPointsUsed] = useState(0);
  const [deliveryAddress, setDeliveryAddress] = useState(null);
  const [addressForm, setAddressForm] = useState({ line1: "", city: "", state: "", pincode: "" });
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("");

  const [orders, setOrders] = useState([]);
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [orderTypeFilter, setOrderTypeFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const [ordersUpdatedAt, setOrdersUpdatedAt] = useState(null);
  const orderFiltersRef = useRef({ type: "all", date: "all" });
  const [orderSearchResults, setOrderSearchResults] = useState([]);
  const [orderSearchOpen, setOrderSearchOpen] = useState(false);
  const [orderSearchLoading, setOrderSearchLoading] = useState(false);
  const [orderSearchActive, setOrderSearchActive] = useState(-1);
  const [orderPinned, setOrderPinned] = useState([]);
  const [kitchenOrders, setKitchenOrders] = useState([]);
  const [kitchenFilter, setKitchenFilter] = useState("active");
  const [lastOrder, setLastOrder] = useState(null);
  const [printOrder, setPrintOrder] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      localStorage.removeItem("pos_sound_enabled");
      return localStorage.getItem(SOUND_ENABLED_KEY) === "true" || localStorage.getItem(SOUND_ENABLED_KEY) === null;
    } catch {
      return true;
    }
  });
  const soundEnabledRef = useRef(soundEnabled);
  const [orderAlerts, setOrderAlerts] = useState([]);
  const audioCtxRef = useRef(null);
  const notificationAudioRef = useRef(null);
  const cashfreeLoadedRef = useRef(false);
  const orderAlertTimersRef = useRef({});
  const seenOrderIdsRef = useRef(null);
  const newOrderBaselineRef = useRef(false);
  const lastAlertSoundAtRef = useRef(0);

  const ensureSeenOrdersLoaded = () => {
    if (seenOrderIdsRef.current === null) {
      try {
        seenOrderIdsRef.current = new Set(JSON.parse(sessionStorage.getItem(SEEN_ORDERS_KEY) || "[]"));
      } catch {
        seenOrderIdsRef.current = new Set();
      }
    }
  };

  const [deliveryStaff, setDeliveryStaff] = useState([]);
  const [assignOrder, setAssignOrder] = useState(null);
  const [assignSelection, setAssignSelection] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [markingPaidId, setMarkingPaidId] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [collectOrder, setCollectOrder] = useState(null);
  const [collectMode, setCollectMode] = useState(null);
  const [collectBusy, setCollectBusy] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [paymentLink, setPaymentLink] = useState(null);
  const [linkError, setLinkError] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const getAudioContext = () => {
    if (audioCtxRef.current) return audioCtxRef.current;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try {
      audioCtxRef.current = new Ctx();
    } catch (e) {
      console.warn("POS alert: AudioContext unavailable:", e);
      return null;
    }
    return audioCtxRef.current;
  };

  const playBeep = (pattern = [880]) => {
    try {
      const ctx = getAudioContext();
      if (!ctx) return false;
      if (ctx.state === "suspended") ctx.resume();
      const beepDur = 0.15;
      const gap = 0.09;
      pattern.forEach((freq, i) => {
        const t = ctx.currentTime + i * (beepDur + gap);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + beepDur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + beepDur + 0.01);
      });
      return true;
    } catch (e) {
      console.warn("POS alert beep failed:", e);
      return false;
    }
  };

  useEffect(() => {
    const unlockAudio = () => {
      if (!soundEnabledRef.current) return;
      const ctx = audioCtxRef.current || getAudioContext();
      if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    };
    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SOUND_ENABLED_KEY, String(soundEnabled));
    } catch { /* storage unavailable - ignore */ }
  }, [soundEnabled]);

  useEffect(() => {
    notificationAudioRef.current = new Audio("/new-order-alert.mp3");
    notificationAudioRef.current.preload = "auto";
  }, []);

  useEffect(() => {
    const timers = orderAlertTimersRef.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

  const loadCashfreeScript = () => {
    return new Promise((resolve) => {
      if (cashfreeLoadedRef.current) {
        resolve(true);
        return;
      }
      if (window.Cashfree) {
        cashfreeLoadedRef.current = true;
        resolve(true);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
      script.onload = () => {
        cashfreeLoadedRef.current = true;
        resolve(true);
      };
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  // Opens the Cashfree checkout in a popup modal and returns the server-driven
  // outcome (OUTCOME.PAID / OUTCOME.FAILED / OUTCOME.PENDING). The modal's
  // client-side paymentStatus is NOT trusted: for UPI the popup often reports
  // CANCELLED / NOT_ATTEMPTED even when the payment was captured, so we ALWAYS
  // reconcile with the server via verifyCashfreePayment and only cancel the
  // order when the server definitively confirms the payment did not succeed.
  const openCashfreeCheckout = async (createdOrder) => {
    const scriptLoaded = await loadCashfreeScript();
    if (!scriptLoaded) {
      alert("Cashfree SDK failed to load");
      return OUTCOME.FAILED;
    }

    try {
      const paymentRes = await paymentAPI.createCashfreeOrder(createdOrder._id);
      if (!paymentRes.data.success) {
        alert(paymentRes.data.message || "Failed to create Cashfree order");
        return OUTCOME.FAILED;
      }

      return await new Promise((resolve) => {
        const cashfree = new window.Cashfree({
          mode: paymentRes.data.environment === "production" ? "production" : "sandbox",
        });

        let checkoutResult = null;
        const reconcileWithServer = async () => {
          try {
            const verifyRes = await paymentAPI.verifyCashfreePayment({
              orderId: createdOrder._id,
              cashfreeOrderId: paymentRes.data.cashfreeOrderId,
            });

            const outcome = decidePaymentOutcome(verifyRes);
            if (outcome === OUTCOME.PAID) {
              const verifiedOrder = verifyRes.data.order || createdOrder;
              setLastOrder(verifiedOrder);
              fetchOrders(false);
              if (isKitchen || hasRole(["admin"])) fetchKitchenOrders();
              alert("Payment successful");
              resolve(OUTCOME.PAID);
              return;
            }

            if (outcome === OUTCOME.FAILED) {
              alert(verifyRes.data.message || "Payment could not be completed");
              resolve(OUTCOME.FAILED);
              return;
            }

            alert(
              "We could not confirm the payment right now. Your order is being verified and will update automatically."
            );
            resolve(OUTCOME.PENDING);
          } catch (error) {
            console.log("VERIFY PAYMENT ERROR:", error);
            const outcome = decidePaymentOutcome(error.response);
            if (outcome === OUTCOME.FAILED) {
              alert(error.response?.data?.message || "Payment could not be completed");
              resolve(OUTCOME.FAILED);
              return;
            }
            const checkoutErrorCode =
              checkoutResult?.error?.code || checkoutResult?.code || "";
            const isUserAborted = checkoutErrorCode === "payment_aborted";
            const msg = error.response?.data?.message || "";
            if (isUserAborted && msg.includes("Could not confirm")) {
              alert(msg || "Payment cancelled");
              resolve(OUTCOME.FAILED);
              return;
            }
            alert(
              "We could not confirm the payment right now. Your order is being verified and will update automatically."
            );
            resolve(OUTCOME.PENDING);
          }
        };

        // The payment flow has returned (success, failure, popup closed, or a
        // redirect to a UPI app). The client-side status is not authoritative,
        // so always reconcile with the server before deciding what to do.
        cashfree
          .checkout({
            paymentSessionId: paymentRes.data.paymentSessionId,
            orderId: paymentRes.data.cashfreeOrderId,
            redirectTarget: "_modal",
          })
          .then((result) => {
            checkoutResult = result;
            return reconcileWithServer();
          })
          .catch((err) => {
            checkoutResult = err;
            return reconcileWithServer();
          });
      });
    } catch (error) {
      console.log("CASHFREE CHECKOUT ERROR:", error);
      alert("Unable to start online payment");
      return OUTCOME.FAILED;
    }
  };

  const playNotificationSound = () => {
    if (!soundEnabledRef.current) return;
    if (!notificationAudioRef.current) return;

    // Debounce duplicate plays: a push message and the polling fallback can
    // both detect the same new order within seconds of each other.
    const now = Date.now();
    if (now - lastAlertSoundAtRef.current < POS_ALERT_DEDUP_MS) return;
    lastAlertSoundAtRef.current = now;

    // Prevent overlapping audio
    notificationAudioRef.current.pause();
    notificationAudioRef.current.currentTime = 0;
    
    notificationAudioRef.current.play().catch(() => {
      // Autoplay might be blocked, try resume on next user interaction
    });
  };

  const handleSoundToggle = (checked) => {
    setSoundEnabled(checked);
    if (checked && notificationAudioRef.current) {
      notificationAudioRef.current.currentTime = 0;
      notificationAudioRef.current.play().catch(() => {});
    }
  };

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handleSWMessage = (event) => {
      if (event?.data?.type === "POS_NEW_ORDER") {
        playNotificationSound();
      }
    };
    navigator.serviceWorker.addEventListener("message", handleSWMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleSWMessage);
  }, []);

  const persistSeenOrders = () => {
    try {
      sessionStorage.setItem(SEEN_ORDERS_KEY, JSON.stringify([...seenOrderIdsRef.current]));
    } catch { /* storage unavailable - ignore */ }
  };

  const markOrderSeen = (orderId) => {
    if (!orderId) return;
    ensureSeenOrdersLoaded();
    seenOrderIdsRef.current.add(orderId);
    persistSeenOrders();
  };

  const dismissOrderAlert = (id) => {
    clearTimeout(orderAlertTimersRef.current[id]);
    setOrderAlerts((prev) => prev.filter((a) => a.id !== id));
  };

  const enqueueOrderAlert = (order) => {
    const alert = {
      id: order._id,
      orderNumber: order.orderNumber || order._id,
      orderType: order.orderType,
      customerName: order.customerName,
      total: order.total,
    };
    setOrderAlerts((prev) => (prev.some((a) => a.id === alert.id) ? prev : [...prev, alert].slice(-5)));
    clearTimeout(orderAlertTimersRef.current[order._id]);
    orderAlertTimersRef.current[order._id] = setTimeout(() => dismissOrderAlert(order._id), 6000);
  };

  const detectNewOrders = (fetchedOrders) => {
    if (!Array.isArray(fetchedOrders)) return;
    ensureSeenOrdersLoaded();
    const fresh = fetchedOrders.filter((o) => o?._id && !seenOrderIdsRef.current.has(o._id));
    fresh.forEach((o) => seenOrderIdsRef.current.add(o._id));
    if (fresh.length > 0) persistSeenOrders();
    if (!newOrderBaselineRef.current) {
      newOrderBaselineRef.current = true;
      return;
    }
    if (fresh.length === 0) return;
    fresh.forEach((o) => enqueueOrderAlert(o));
    playNotificationSound();
  };

  const fetchMenu = async () => {
    setError(""); // Clear error at start
    try {
      const [menuRes, catRes] = await Promise.all([
        menuAPI.getByCategory(),
        categoryAPI.getAll({ activeOnly: "true" }),
      ]);

      if (menuRes.data.success) {
        setMenuItems(menuRes.data.categories.flatMap(c => c.items));
      } else {
        setError(menuRes.data.message || "Failed to load menu");
      }

      if (catRes.data.success) {
        setAllCategories(catRes.data.categories || []);
      }
    } catch (err) {
      setError("Failed to load menu");
    } finally {
      setMenuLoading(false);
    }
  };

  const fetchTables = async () => {
    try {
      const res = await tableAPI.getFloorPlan();
      if (res.data.success) {
        setTables(res.data.tables);
      }
    } catch (err) {
      console.error("Failed to load tables");
    } finally {
      setTablesLoading(false);
    }
  };

  const buildOrderDateRange = (key) => {
    if (key === "all") return {};
    const now = new Date();
    if (key === "today") {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      return { startDate: start.toISOString(), endDate: end.toISOString() };
    }
    if (key === "week") {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return { startDate: start.toISOString(), endDate: now.toISOString() };
    }
    return {};
  };

  const applyOrderFilters = (type, date) => {
    orderFiltersRef.current = { type, date };
    setOrderTypeFilter(type);
    setDateFilter(date);
    fetchOrders(false);
  };

  const fetchOrders = async (showLoader = true) => {
    try {
      if (showLoader) setLoading(true);
      setOrdersLoading(true);
      const { type, date } = orderFiltersRef.current;
      const params = { limit: 50 };
      if (type !== "all") params.orderType = type;
      const dateParams = buildOrderDateRange(date);
      if (dateParams.startDate) params.startDate = dateParams.startDate;
      if (dateParams.endDate) params.endDate = dateParams.endDate;
      const res = await orderAPI.getAll(params);
      if (res.data.success) {
        const newOrders = res.data.orders;
        detectNewOrders(newOrders);
        setOrders(newOrders);
        setOrdersError("");
        setOrdersUpdatedAt(new Date());
      }
    } catch (err) {
      console.error("Failed to load orders");
      setOrdersError("Could not load orders. Please try again.");
    } finally {
      if (showLoader) setLoading(false);
      setOrdersLoading(false);
    }
  };

  const fetchKitchenOrders = async () => {
    try {
      const res = await orderAPI.getKitchenOrders();
      if (res.data.success) {
        setKitchenOrders(res.data.orders);
      }
    } catch (err) {
      console.error("Failed to load kitchen orders");
    }
  };

  const fetchDeliveryStaff = async () => {
    try {
      const res = await authAPI.getStaff({ role: "delivery", limit: 100 });
      if (res.data.success) {
        setDeliveryStaff(res.data.staff);
      }
    } catch (err) {
      console.error("Failed to load delivery staff");
    }
  };

  const fetchWaiterStaff = async () => {
    try {
      // Reuse the existing staff API (no role filter returns all staff); filter
      // client-side to the roles eligible to act as waiters.
      const res = await authAPI.getStaff({ limit: 100 });
      if (res.data.success) {
        const eligible = (res.data.staff || []).filter(
          (u) => WAITER_ROLES.includes(u.role) && u.isActive !== false
        );
        setWaiterStaff(eligible);
      }
    } catch (err) {
      console.error("Failed to load waiter staff");
    }
  };

  const fetchPosSettings = async () => {
    try {
      const res = await settingsAPI.getAll();
      if (res.data.success && Array.isArray(res.data.settings)) {
        const settingsMap = {};
        res.data.settings.forEach((s) => { settingsMap[s.key] = s.value; });
        setPosSettings(settingsMap);
      }
    } catch (err) {
      console.error("Failed to load POS settings", err);
    }
  };

  const fetchLoyaltyConfig = async () => {
    try {
      const res = await loyaltyAPI.getConfig();
      if (res.data.success) setLoyaltyConfig(res.data.config);
    } catch (err) {
      console.error("Failed to load loyalty config", err);
    }
  };

  useEffect(() => {
    fetchMenu();
    fetchTables();
    fetchPosSettings();
    fetchLoyaltyConfig();
    fetchOrders(true);
    fetchDeliveryStaff();
    fetchWaiterStaff();
    if (isKitchen || hasRole(["admin"])) fetchKitchenOrders();
  }, []);

  useEffect(() => {
    const clearPrint = () => setPrintOrder(null);
    window.addEventListener("afterprint", clearPrint);
    return () => window.removeEventListener("afterprint", clearPrint);
  }, []);

  // Press "/" to focus the menu search, unless the user is already typing.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "/") return;
      const el = document.activeElement;
      const tag = el?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || el?.isContentEditable) return;
      if (searchInputRef.current) {
        e.preventDefault();
        searchInputRef.current.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (printOrder) {
      const timer = setTimeout(() => window.print(), 150);
      return () => clearTimeout(timer);
    }
  }, [printOrder]);

  useEffect(() => {
    if (location.state?.posTab === "orders") setActiveTab("orders");
    setHighlightedOrderId(location.state?.orderId || null);
  }, [location.state]);

  useEffect(() => {
    if (!highlightedOrderId) return;
    const el = document.getElementById(`order-row-${highlightedOrderId}`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [orders, highlightedOrderId]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchOrders(false);
      if (isKitchen || hasRole(["admin"])) fetchKitchenOrders();
    }, 5000);
    return () => clearInterval(interval);
  }, [isKitchen]);

  // Debounced server-side Orders search. The in-memory orders list only holds
  // the newest 50, so typing 3+ chars queries the backend search directly so
  // older orders (e.g. by order number) can still be located and opened.
  useEffect(() => {
    const q = orderSearch.trim();
    if (q.length < 3) {
      setOrderSearchResults([]);
      setOrderSearchOpen(false);
      setOrderSearchLoading(false);
      setOrderSearchActive(-1);
      return;
    }
    setOrderSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await orderAPI.getAll({ search: q, limit: 8 });
        const list = res?.data?.orders || [];
        setOrderSearchResults(list);
        setOrderSearchOpen(true);
        setOrderSearchActive(-1);
      } catch {
        setOrderSearchResults([]);
        setOrderSearchOpen(false);
      } finally {
        setOrderSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [orderSearch]);

  const filteredMenuItems = useMemo(() => {
    const byCategory =
      selectedCategory === "All"
        ? menuItems
        : menuItems.filter(item => item.category?.name === selectedCategory);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return byCategory;
    return byCategory.filter(item => item.name?.toLowerCase().includes(q));
  }, [menuItems, selectedCategory, searchQuery]);

  const openOrderSearchResult = (order) => {
    setOrderPinned((prev) =>
      prev.some((o) => o._id === order._id) ? prev : [...prev, order]
    );
    setExpandedOrderId(order._id);
    setHighlightedOrderId(order._id);
    setOrderSearchOpen(false);
    setOrderSearchActive(-1);
  };

  const handleOrderSearchKeyDown = (e) => {
    if (!orderSearchOpen || orderSearchResults.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOrderSearchActive((i) => (i + 1) % orderSearchResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOrderSearchActive((i) => (i - 1 + orderSearchResults.length) % orderSearchResults.length);
    } else if (e.key === "Enter") {
      const active =
        orderSearchActive >= 0 ? orderSearchResults[orderSearchActive] : orderSearchResults[0];
      if (active) {
        e.preventDefault();
        openOrderSearchResult(active);
      }
    } else if (e.key === "Escape") {
      setOrderSearchOpen(false);
      setOrderSearchActive(-1);
    }
  };

  const filteredOrders = useMemo(() => {
    const pinned = orderPinned.filter((po) => !orders.some((o) => o._id === po._id));
    const combined = [...pinned, ...orders];
    const statuses = STATUS_GROUPS[orderStatusFilter] || null;
    const q = orderSearch.trim().toLowerCase();
    return combined.filter(o => {
      if (statuses && !statuses.includes(o.orderStatus)) return false;
      if (!q) return true;
      return (
        o.orderNumber?.toLowerCase().includes(q) ||
        o.customerName?.toLowerCase().includes(q) ||
        o.orderType?.toLowerCase().includes(q) ||
        (o.tableNo != null && String(o.tableNo).toLowerCase().includes(q)) ||
        o.paymentMethod?.toLowerCase().includes(q) ||
        o.orderStatus?.toLowerCase().includes(q)
      );
    });
  }, [orders, orderSearch, orderStatusFilter, orderPinned]);

  const categoryList = useMemo(() => {
    // Build the selector from ALL active categories (so newly created / empty
    // categories show up in the POS) plus any categories seen on items.
    const names = new Set(allCategories.map(c => c.name).filter(Boolean));
    menuItems.forEach(item => {
      const n = item.category?.name;
      if (n) names.add(n);
    });
    return ["All", ...names];
  }, [allCategories, menuItems]);

  const addToCart = (item) => {
    setCartItems(prev => {
      const existing = prev.find(i => i.menuItemId === item._id);
      if (existing) {
        return prev.map(i => i.menuItemId === item._id ? { ...i, qty: i.qty + 1 } : i);
      }
      return [...prev, { 
        ...item, 
        menuItemId: item._id,
        qty: 1,
        modifiers: [],
        notes: ""
      }];
    });
  };

  // Size/variant selection for items that define a "Size" modifier.
  const [sizePick, setSizePick] = useState(null);
  const handleMenuClick = (item) => {
    if (item.modifiers?.length > 0) {
      setSizePick(item);
      return;
    }
    addToCart(item);
  };
  const confirmSize = (item, option) => {
    const delta = Number(option.price) || 0;
    const sig = JSON.stringify([{ name: "Size", option: option.name }]);
    setCartItems((prev) => {
      const idx = prev.findIndex((i) => i.menuItemId === item._id && JSON.stringify(i.modifiers) === sig);
      if (idx >= 0) {
        return prev.map((i, ix) => (ix === idx ? { ...i, qty: i.qty + 1 } : i));
      }
      return [
        ...prev,
        {
          ...item,
          menuItemId: item._id,
          qty: 1,
          modifiers: [{ name: "Size", option: option.name, price: delta }],
          notes: "",
          price: (Number(item.price) || 0) + delta,
        },
      ];
    });
    setSizePick(null);
  };

  const updateQty = (index, delta) => {
    setCartItems(prev => {
      const newQty = prev[index].qty + delta;
      if (newQty < 1) return prev.filter((_, i) => i !== index);
      return prev.map((item, i) => i === index ? { ...item, qty: newQty } : item);
    });
  };

  const removeFromCart = (index) => {
    setCartItems(prev => prev.filter((_, i) => i !== index));
  };

  const clearCart = () => {
    setCartItems([]);
    setPrintOrder(null);
    setCustomerName("");
    setCustomerPhone("");
    setCustomerId(null);
    setSelectedTable(null);
    setSelectedWaiter(null);
    setOrderType("dinein");
    setPaymentMethod("cash");
    setSplitPayments([
      { method: "cash", amount: "", reference: "" },
      { method: "cash", amount: "", reference: "" },
    ]);
    setNotes("");
    setDiscount(0);
    setDiscountType("flat");
    setCouponDiscount(0);
    setCouponCode("");
    setLoyaltyPointsUsed(0);
    setDeliveryAddress(null);
    setAddressForm({ line1: "", city: "", state: "", pincode: "" });
    setPickupDate("");
    setPickupTime("");
  };

  const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.qty, 0);
  const total = subtotal - discount;

  const orderTotals = (() => {
    const taxInclusive = !!posSettings?.tax_inclusive;
    const serviceChargeEnabled = !!posSettings?.service_charge_enabled;
    const serviceChargePercent = Number(posSettings?.service_charge_percent) || 0;
    const pointsPerRupee = Number(loyaltyConfig?.rupeePerPoint) || 1;

    let finalDiscount = Number(discount) || 0;
    if (discountType === "percent") {
      finalDiscount = Math.round((subtotal * finalDiscount / 100) * 100) / 100;
    }
    const totalDiscount = Math.min(couponDiscount + finalDiscount, subtotal);

    let totalTax = 0;
    for (const item of cartItems) {
      const itemTaxRate = item.taxRate || 0;
      const itemSubtotal = item.price * item.qty;
      const taxableAmount = taxInclusive ? itemSubtotal / (1 + itemTaxRate / 100) : itemSubtotal;
      totalTax += taxableAmount * (itemTaxRate / 100);
    }
    totalTax = Math.round(totalTax * 100) / 100;

    const serviceCharge = serviceChargeEnabled
      ? Math.round(((subtotal - totalDiscount) * serviceChargePercent / 100) * 100) / 100
      : 0;

    const loyaltyPointsValue = loyaltyPointsUsed > 0 ? pointsPerRupee * loyaltyPointsUsed : 0;

    const finalTotal = Math.round((subtotal - totalDiscount + totalTax + serviceCharge - loyaltyPointsValue) * 100) / 100;

    return {
      final: Math.round(finalTotal),
      subtotal,
      discount: finalDiscount,
      totalDiscount,
      totalTax,
      serviceCharge,
      loyaltyPointsValue,
    };
  })();

  const finalTotal = orderTotals.final;

  const splitTotal = splitPayments.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const splitRemaining = finalTotal - splitTotal;
  const splitHasInvalidAmount = splitPayments.some((r) => {
    const amount = Number(r.amount);
    return Number.isNaN(amount) || amount <= 0;
  });
  const splitValid =
    paymentMethod !== "split" ||
    (!splitHasInvalidAmount &&
      Math.round(splitTotal * 100) / 100 === Math.round(finalTotal * 100) / 100);

  const handleCustomerSearch = async (phone) => {
    if (!phone || phone.length < 10) return;
    try {
      const res = await customerAPI.getByPhone(phone);
      if (res.data.success) {
        setCustomerId(res.data.customer._id);
        setCustomerName(res.data.customer.name);
        setCustomerPhone(res.data.customer.phone);
        if (res.data.customer.addresses?.length > 0) {
          const defaultAddr = res.data.customer.addresses.find(a => a.isDefault) || res.data.customer.addresses[0];
          setDeliveryAddress(defaultAddr);
        }
      }
    } catch (err) {
      // Customer not found, will create new
    }
  };

  const handlePlaceOrder = async () => {
    if (!customerName.trim()) {
      setError("Customer name is required");
      return;
    }
    if (cartItems.length === 0) {
      setError("Cart is empty");
      return;
    }
    if (orderType === "dinein" && !selectedTable) {
      setError("Please select a table");
      return;
    }
    if (paymentMethod === "split" && !splitValid) {
      setError("Every split payment amount must be greater than zero and must total the order total");
      return;
    }
    if (paymentMethod === "cod" && orderType !== "delivery") {
      setError("Cash on Delivery is only available for delivery orders");
      return;
    }
    if (orderType === "takeaway") {
      if (!pickupDate || !pickupTime) {
        setError("Please select a pickup date and time");
        return;
      }
      const pickupDt = new Date(`${pickupDate}T${pickupTime}`);
      if (isNaN(pickupDt.getTime()) || pickupDt.getTime() <= Date.now()) {
        setError("Pickup date/time must be in the future");
        return;
      }
    }

    setLoading(true);
    setError("");

    try {
      const orderItems = cartItems.map(item => ({
        menuItemId: item.menuItemId,
        name: item.name,
        price: item.price,
        qty: item.qty,
        category: item.category?.name,
        isVeg: item.isVeg,
        taxRate: item.taxRate,
        modifiers: item.modifiers,
        notes: item.notes,
      }));

      const finalDeliveryAddress = deliveryAddress || (addressForm.line1?.trim() ? addressForm : null);

      const orderData = {
        customerName,
        customerPhone,
        customerId,
        tableId: selectedTable?._id,
        tableNo: selectedTable?.number,
        items: orderItems,
        paymentMethod,
        orderType,
        notes,
        discount,
        discountType,
        couponCode: couponCode || null,
        loyaltyPointsUsed,
        deliveryAddress: finalDeliveryAddress,
        ...(orderType === "takeaway"
          ? { pickupAt: new Date(`${pickupDate}T${pickupTime}`).toISOString() }
          : {}),
        ...(paymentMethod === "split"
          ? { splitPayments: splitPayments.map((r) => ({ ...r, amount: Number(r.amount) })) }
          : {}),
        ...(orderType === "dinein" && selectedWaiter ? { servedBy: selectedWaiter } : {}),
      };

      const res = await orderAPI.create(orderData);
      
      if (res.data.success) {
        const createdOrder = res.data.order;
        markOrderSeen(createdOrder._id);

        if (paymentMethod === "upi") {
          const paymentOutcome = await openCashfreeCheckout(createdOrder);
          if (paymentOutcome === OUTCOME.FAILED) {
            try {
              await orderAPI.cancel(createdOrder._id, { reason: "Payment not completed" });
            } catch (cancelErr) {
              console.log("CANCEL ABANDONED ORDER ERROR:", cancelErr);
            }
            setLastOrder(null);
            clearCart();
            fetchOrders(false);
            fetchTables();
            if (isKitchen || hasRole(["admin"])) fetchKitchenOrders();
            alert("Payment not completed. Order cancelled and table released.");
            return;
          }
          if (paymentOutcome === OUTCOME.PENDING) {
            // The payment could not be confirmed either way. Do NOT cancel the
            // order - it stays pending and the webhook will settle it.
            setError(
              "We could not confirm your payment. The order is being verified and will update automatically."
            );
            return;
          }
          // OUTCOME.PAID - fall through to the success flow below.
        }

        if (selectedTable) {
          const table = tables.find(t => t._id === selectedTable._id);
          if (table) {
            setTables(prev => prev.map(t => t._id === table._id ? { ...t, status: "occupied", currentOrder: createdOrder._id } : t));
          }
        }

        setLastOrder(createdOrder);
        if (posSettings?.kot_auto_print) {
          handlePrint(createdOrder, "kot");
        }
        clearCart();
        fetchOrders(false);
        if (isKitchen || hasRole(["admin"])) fetchKitchenOrders();
      } else {
        setError(res.data.message || "Order failed");
      }
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (orderId, newStatus) => {
    try {
      const res = await orderAPI.updateStatus(orderId, newStatus);
      if (res.data.success) {
        setOrders(prev => prev.map(o => o._id === orderId ? res.data.order : o));
        setKitchenOrders(prev => prev.map(o => o._id === orderId ? res.data.order : o));
        
        if (["paid", "completed", "cancelled", "refunded"].includes(newStatus)) {
          const order = orders.find(o => o._id === orderId);
          if (order?.table) {
            setTables(prev => prev.map(t => t._id === order.table ? { ...t, status: "cleaning", currentOrder: null } : t));
          }
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || "Status update failed");
    }
  };

  const handleMarkPaid = async (orderId) => {
    if (markingPaidId) return;
    setMarkingPaidId(orderId);
    setError("");
    try {
      const res = await orderAPI.markPaid(orderId);
      if (res.data.success) {
        setOrders(prev => prev.map(o => o._id === orderId ? res.data.order : o));
        setKitchenOrders(prev => prev.map(o => o._id === orderId ? { ...o, paymentStatus: res.data.order.paymentStatus, paidAt: res.data.order.paidAt } : o));
      }
    } catch (err) {
      setError(err.response?.data?.message || "Failed to mark order as paid");
    } finally {
      setMarkingPaidId(null);
    }
  };

  // ---- Edit existing order / additional payment flows ------------------------

  const applyOrderUpdate = (updated) => {
    if (!updated) return;
    setOrders(prev => prev.map(o => o._id === updated._id ? updated : o));
    if (isKitchen || hasRole(["admin"])) fetchKitchenOrders();
  };

  const handleEditOrderSaved = (saved) => {
    if (saved?.order) applyOrderUpdate(saved.order);
    fetchOrders(false);
  };

  const handleCollectAdditional = (order) => {
    setCollectMode(null);
    setCollectBusy(false);
    setCollectOrder(order);
  };

  const handleGeneratePaymentLink = async (order) => {
    setLinkBusy(true);
    setLinkError("");
    setPaymentLink(null);
    setLinkCopied(false);
    try {
      const res = await paymentAPI.generateAdditionalPaymentLink(order._id);
      if (res.data.success) {
        applyOrderUpdate(res.data.order);
        setPaymentLink(res.data.url);
      } else {
        setLinkError(res.data.message || "Could not generate the payment link");
      }
    } catch (err) {
      setLinkError(err.response?.data?.message || "Could not generate the payment link");
    } finally {
      setLinkBusy(false);
    }
  };

  const handleCopyPaymentLink = async () => {
    if (!paymentLink) return;
    try {
      await navigator.clipboard.writeText(paymentLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setLinkCopied(false);
    }
  };

  const doCollectAdditionalCash = async (order) => {
    setCollectBusy(true);
    setError("");
    try {
      const res = await orderAPI.collectAdditional(order._id, {
        method: "cash",
        notes: `Additional payment of ${formatCurrency(order.additionalAmountDue)} after edit`,
      });
      if (res.data.success) {
        applyOrderUpdate(res.data.order);
        setCollectOrder(null);
        alert("Additional payment collected");
      } else {
        setError(res.data.message || "Failed to record additional payment");
      }
    } catch (err) {
      setError(err.response?.data?.message || "Failed to record additional payment");
    } finally {
      setCollectBusy(false);
    }
  };

  // Cashfree checkout for the additional amount due after an edit. Mirrors
  // openCashfreeCheckout: the popup's client-side status is never trusted, the
  // server's verifyAdditionalCashfreePayment is the source of truth. Resolves
  // with the freshly verified order (or null when payment did not confirm).
  const runAdditionalCashfreeCheckout = async (order) => {
    const scriptLoaded = await loadCashfreeScript();
    if (!scriptLoaded) {
      alert("Cashfree SDK failed to load");
      return null;
    }

    try {
      const paymentRes = await paymentAPI.createAdditionalCashfreeOrder(order._id);
      if (!paymentRes.data.success) {
        alert(paymentRes.data.message || "Failed to create additional payment");
        return null;
      }

      return await new Promise((resolve) => {
        const cashfree = new window.Cashfree({
          mode: paymentRes.data.environment === "production" ? "production" : "sandbox",
        });

        const reconcileWithServer = async () => {
          try {
            const verifyRes = await paymentAPI.verifyAdditionalCashfreePayment({
              orderId: order._id,
              cashfreeOrderId: paymentRes.data.cashfreeOrderId,
            });

            const outcome = decidePaymentOutcome(verifyRes);
            if (outcome === OUTCOME.PAID) {
              const fresh = verifyRes.data.order || order;
              applyOrderUpdate(fresh);
              resolve(fresh);
              return;
            }
            if (outcome === OUTCOME.FAILED) {
              alert(verifyRes.data.message || "Additional payment could not be completed");
              resolve(null);
              return;
            }
            alert("We could not confirm the payment right now. It will be verified and update automatically.");
            resolve(null);
          } catch (error) {
            console.log("VERIFY ADDITIONAL PAYMENT ERROR:", error);
            const outcome = decidePaymentOutcome(error.response);
            if (outcome === OUTCOME.FAILED) {
              alert(error.response?.data?.message || "Additional payment could not be completed");
              resolve(null);
              return;
            }
            alert("We could not confirm the payment right now. It will be verified and update automatically.");
            resolve(null);
          }
        };

        cashfree
          .checkout({
            paymentSessionId: paymentRes.data.paymentSessionId,
            orderId: paymentRes.data.cashfreeOrderId,
            redirectTarget: "_modal",
          })
          .then(() => reconcileWithServer())
          .catch(() => reconcileWithServer());
      });
    } catch (error) {
      console.log("ADDITIONAL CASHFREE CHECKOUT ERROR:", error);
      alert("Unable to start online payment");
      return null;
    }
  };

  const handleCollectContinue = async () => {
    if (!collectOrder || !collectMode) return;
    if (collectMode === "cash") {
      await doCollectAdditionalCash(collectOrder);
    } else {
      await runAdditionalCashfreeCheckout(collectOrder);
      setCollectOrder(null);
    }
  };

  const handleEditModalPayOnline = (order) => runAdditionalCashfreeCheckout(order);

  const handleAssignDelivery = async (orderId, deliveryBoyId) => {
    setAssigning(true);
    setError("");
    try {
      const res = await orderAPI.assignDelivery(orderId, deliveryBoyId);
      if (res.data.success) {
        const assigned = res.data.order?.assignedTo || null;
        setOrders((prev) =>
          prev.map((o) => (o._id === orderId ? { ...o, assignedTo: assigned || deliveryBoyId } : o))
        );
        setAssignOrder(null);
        setAssignSelection("");
        fetchOrders(false);
      }
    } catch (err) {
      setError(err.response?.data?.message || "Failed to assign delivery person");
    } finally {
      setAssigning(false);
    }
  };

  const deliveryStaffMap = useMemo(() => {
    const map = {};
    deliveryStaff.forEach((member) => { map[member._id] = member.name; });
    return map;
  }, [deliveryStaff]);

  const availableDeliveryStaff = deliveryStaff.filter((member) => member.isActive !== false);

  const getAssignedName = (order) => {
    const assigned = order.assignedTo;
    if (!assigned) return "-";
    if (typeof assigned === "object" && assigned.name) return assigned.name;
    return deliveryStaffMap[String(assigned)] || "-";
  };

  const handleTableSelect = (table) => {
    if (table.status === "occupied" && table.currentOrder) {
      const order = orders.find(o => o._id === table.currentOrder);
      if (order && !["paid", "completed", "cancelled", "refunded"].includes(order.orderStatus)) {
        setError("Table is occupied");
        return;
      }
    }
    setSelectedTable(table);
    if (orderType !== "dinein") setOrderType("dinein");
  };

  const handlePrint = async (order, type) => {
    if (posSettings?.thermal_printer_enabled) {
      try {
        const res = type === "kot"
          ? await orderAPI.printKOT(order._id)
          : await orderAPI.printInvoice(order._id);
        if (res.data?.thermalPrint?.ok) {
          return;
        }
      } catch (err) {
        // fall through to browser print fallback
      }
      setPrintOrder({ type, order });
    } else {
      setPrintOrder({ type, order });
    }
  };

  const renderOrderActions = (order) => {
    const actions = [];
    if (order.orderStatus === "pending" || order.orderStatus === "confirmed") {
      actions.push(<button key="preparing" className="btn btn-sm btn-primary" onClick={() => handleStatusChange(order._id, "preparing")}>Start Preparing</button>);
    }
    if (order.orderStatus === "preparing") {
      actions.push(<button key="ready" className="btn btn-sm btn-success" onClick={() => handleStatusChange(order._id, "ready")}>Mark Ready</button>);
    }
    if (order.orderStatus === "ready") {
      actions.push(<button key="served" className="btn btn-sm btn-teal" onClick={() => handleStatusChange(order._id, "served")}>Mark Served</button>);
    }
    if (order.orderStatus === "ready" && order.orderType === "delivery" && isAdminOrCashier) {
      actions.push(
        <button
          key="assign"
          className="btn btn-sm btn-primary"
          onClick={() => {
            setAssignSelection("");
            setAssignOrder(order);
          }}
        >
          Assign Delivery
        </button>
      );
    }
    if (order.orderStatus === "served") {
      actions.push(<button key="paid" className="btn btn-sm btn-info" onClick={() => handleStatusChange(order._id, "paid")}>Mark Paid</button>);
    }
    if (
      isAdminOrCashier &&
      order.paymentMethod === "cash" &&
      order.orderType !== "dinein" &&
      order.paymentStatus !== "paid" &&
      order.orderStatus !== "cancelled" &&
      order.orderStatus !== "refunded"
    ) {
      actions.push(
        <button
          key="mark-cash-paid"
          className="btn btn-sm btn-info"
          disabled={markingPaidId === order._id}
          onClick={() => handleMarkPaid(order._id)}
        >
          {markingPaidId === order._id ? "..." : "Mark Cash Paid"}
        </button>
      );
    }
    if (!["cancelled", "refunded"].includes(order.orderStatus)) {
      actions.push(<button key="kot" className="btn btn-sm btn-secondary" onClick={() => handlePrint(order, "kot")}>Print KOT</button>);
      actions.push(<button key="invoice" className="btn btn-sm btn-secondary" onClick={() => handlePrint(order, "invoice")}>Print Invoice</button>);
    }
    if (isAdminOrCashier && EDITABLE_ORDER_STATUSES.includes(order.orderStatus)) {
      actions.push(
        <button key="edit-order" className="btn btn-sm btn-secondary" onClick={() => setEditingOrder(order)}>
          Edit Order
        </button>
      );
    }
    if (isAdminOrCashier && Number(order.additionalAmountDue) > 0) {
      actions.push(
        <>
          <button key="collect-additional" className="btn btn-sm btn-info" onClick={() => handleCollectAdditional(order)}>
            Collect {formatCurrency(order.additionalAmountDue)}
          </button>
          <button key="payment-link" className="btn btn-sm btn-secondary" onClick={() => { handleCollectAdditional(order); handleGeneratePaymentLink(order); }}>
            Generate Payment Link
          </button>
        </>
      );
    }
    if (!["paid", "completed", "cancelled", "refunded"].includes(order.orderStatus)) {
      actions.push(<button key="cancel" className="btn btn-sm btn-danger" onClick={() => handleStatusChange(order._id, "cancelled")}>Cancel</button>);
    }
    return <div className="action-buttons">{actions}</div>;
  };

  if (!isAdminOrCashier && !isKitchen) {
    return <div className="unauthorized">Access denied. Kitchen staff only.</div>;
  }

  const thermalEnabled = !!posSettings?.thermal_printer_enabled;
  const thermalPort = posSettings?.thermal_printer_port || "";

  return (
    <div className="pos-page">
      <div className="pos-tabs">
        <div className="pos-tabs-left">
          {isAdminOrCashier && (
            <button className={activeTab === "pos" ? "active" : ""} onClick={() => setActiveTab("pos")}>
              <IconPOS size={17} /> POS
            </button>
          )}
          {(isKitchen || hasRole(["admin"])) && (
            <button className={activeTab === "kitchen" ? "active" : ""} onClick={() => setActiveTab("kitchen")}>
              <IconKitchen size={17} /> Kitchen
            </button>
          )}
          {hasRole(["admin"]) && (
            <button className={activeTab === "reports" ? "active" : ""} onClick={() => setActiveTab("reports")}>
              <IconReports size={17} /> Reports
            </button>
          )}
          <button className={activeTab === "orders" ? "active" : ""} onClick={() => setActiveTab("orders")}>
            <IconMenu size={17} /> Orders
          </button>
        </div>
        <div className="pos-tabs-right">
          <button className="btn btn-sm btn-secondary" onClick={() => { fetchOrders(true); if (isKitchen || hasRole(["admin"])) fetchKitchenOrders(); }}>
            <IconRefresh size={14} /> Refresh
          </button>
          <label className="sound-toggle" title={soundEnabled ? "Order alert sound is on" : "Enable order alert sound"}>
            <input type="checkbox" checked={soundEnabled} onChange={(e) => handleSoundToggle(e.target.checked)} />
            <span className="sound-toggle-switch"></span>
            Sound
          </label>
        </div>
      </div>

      {error && <div className="toast error">{error}</div>}

      {orderAlerts.length > 0 && (
        <div className="new-order-alerts" role="status" aria-live="polite">
          {orderAlerts.map((alert) => (
            <div key={alert.id} className="new-order-alert">
              <IconBell size={18} className="new-order-alert-icon" />
              <div className="new-order-alert-body">
                <strong>New Order #{alert.orderNumber}</strong>
                <span>{ORDER_TYPE_LABELS[alert.orderType] || alert.orderType} · {alert.customerName} · {formatCurrency(alert.total)}</span>
              </div>
              <button type="button" className="new-order-alert-close" onClick={() => dismissOrderAlert(alert.id)} aria-label="Dismiss">×</button>
            </div>
          ))}
        </div>
      )}

      {activeTab === "pos" && isAdminOrCashier && (
        <div className="pos-layout">
          <aside className="pos-sidebar">
            <div className="pos-sidebar-header">
              <h3>Menu</h3>
              <span className="pos-menu-count">{filteredMenuItems.length} items</span>
            </div>
            <div className="sidebar-section">
              <SearchBox
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search dishes…  (press /)"
                inputRef={searchInputRef}
                ariaLabel="Search menu"
              />
            </div>
            <div className="sidebar-section">
              <div className="category-tabs">
                {categoryList.map(cat => (
                  <button
                    key={cat}
                    className={selectedCategory === cat ? "active" : ""}
                    onClick={() => setSelectedCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
            <div className="menu-grid-wrap">
              {menuLoading ? (
                <div className="loading"><span className="spinner"></span><span>Loading menu...</span></div>
              ) : filteredMenuItems.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">🍽️</div>
                  {searchQuery.trim() ? (
                    <>
                      <h3 className="empty-state-title">No items found</h3>
                      <p className="empty-state-description">No dishes match “{searchQuery.trim()}”.</p>
                    </>
                  ) : (
                    <>
                      <h3 className="empty-state-title">No items</h3>
                      <p className="empty-state-description">No menu items in this category.</p>
                    </>
                  )}
                </div>
              ) : (
                <div className="menu-grid">
                  {filteredMenuItems.map(item => (
                    <button key={item._id} className="menu-item-card" onClick={() => handleMenuClick(item)}>
                      <div className="item-header">
                        <span className="item-category">{item.category?.name}</span>
                        {!item.isVeg && <span className="non-veg-badge" title="Non-veg"></span>}
                      </div>
                      <h4>{item.name}</h4>
                      <div className="menu-item-footer">
                        <span className="item-price">{formatCurrency(item.price)}</span>
                        <span className="menu-item-add"><IconPlus size={14} /></span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {sizePick && (
            <div className="modal-root" style={{ position: "fixed", inset: 0, zIndex: 1000 }}>
              <div
                className="modal-backdrop"
                style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }}
                onClick={() => setSizePick(null)}
              />
              <div
                className="item-modal"
                style={{ position: "relative", margin: "12vh auto", maxWidth: 420, background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}
              >
                <h3 style={{ marginTop: 0 }}>{sizePick.name}</h3>
                <p style={{ color: "#666", marginTop: 0 }}>Select size</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(sizePick.modifiers?.find((m) => m.name === "Size") || sizePick.modifiers?.[0])?.options?.map((opt) => (
                    <button
                      key={opt._id || opt.name}
                      type="button"
                      style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                      onClick={() => confirmSize(sizePick, opt)}
                    >
                      <span>{opt.name}</span>
                      <span>{formatCurrency((Number(sizePick.price) || 0) + (Number(opt.price) || 0))}</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  style={{ marginTop: 14, width: "100%", padding: 10, background: "#eee", border: "none", borderRadius: 8, cursor: "pointer" }}
                  onClick={() => setSizePick(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <main className="pos-main">
            <div className="pos-header">
              <div>
                <h2>New Order</h2>
                <p className="pos-header-sub">{orderType === "dinein" ? "Dine-in" : orderType === "takeaway" ? "Takeaway" : "Delivery"}</p>
              </div>
            </div>

            <div className="order-type-tabs" role="tablist" aria-label="Order type">
              {[
                { key: "dinein", label: "Dine-In", icon: <IconRestaurant size={18} /> },
                { key: "takeaway", label: "Takeaway", icon: <IconBag size={18} /> },
                { key: "delivery", label: "Delivery", icon: <IconDelivery size={18} /> },
              ].map(type => (
                <button
                  key={type.key}
                  role="tab"
                  aria-selected={orderType === type.key}
                  className={`order-type-tab ${orderType === type.key ? "active" : ""}`}
                  onClick={() => {
                    setOrderType(type.key);
                    if (type.key !== "dinein") setSelectedWaiter(null);
                    if (type.key === "takeaway") {
                      setPickupDate((d) => d || toLocalDateInput());
                      setPickupTime((t) => t || toLocalTimeInput());
                    }
                  }}
                >
                  {type.icon}
                  <span>{type.label}</span>
                </button>
              ))}
            </div>

            {orderType === "dinein" && (
              <div className="table-selector">
                <h4>Select Table</h4>
                <div className="table-grid">
                  {tablesLoading ? (
                    <div className="loading"><span className="spinner"></span><span>Loading tables...</span></div>
                  ) : tables.map(table => (
                    <button
                      key={table._id}
                      className={`table-btn ${table.status} ${selectedTable?._id === table._id ? "selected" : ""}`}
                      onClick={() => handleTableSelect(table)}
                      disabled={table.status === "occupied" && table.currentOrder}
                    >
                      <span className="table-number">{table.number}</span>
                      <span className="table-capacity">{table.capacity} seats</span>
                      {table.currentOrder && (
                        <span className="table-occupied">Occupied</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {orderType === "dinein" && (
              <div className="waiter-selector">
                <h4>Waiter</h4>
                <select
                  className="form-select"
                  value={selectedWaiter || ""}
                  onChange={(e) => setSelectedWaiter(e.target.value || null)}
                  aria-label="Select waiter"
                >
                  <option value="">Select waiter</option>
                  {waiterStaff.map((w) => (
                    <option key={w._id} value={w._id}>{w.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="customer-section">
              <h4>Customer</h4>
              <div className="input-row">
                <input
                  type="text"
                  placeholder="Customer Name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
                {orderType !== "dinein" && (
                  <input
                    type="tel"
                    placeholder="Phone"
                    value={customerPhone}
                    onChange={(e) => {
                      setCustomerPhone(e.target.value);
                      handleCustomerSearch(e.target.value);
                    }}
                  />
                )}
              </div>
              {customerId && (
                <div className="customer-found">
                  <IconCheck size={15} />
                  <span>Returning customer · {customerName}</span>
                </div>
              )}
            </div>

            {orderType === "delivery" && (
              <div className="delivery-section">
                <h4>Delivery Address</h4>
                {deliveryAddress ? (
                  <div className="address-display">
                    <span className="address-lines">{formatAddress(deliveryAddress)}</span>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => setDeliveryAddress(null)}>Change</button>
                  </div>
                ) : (
                  <div className="address-form">
                    <input
                      type="text"
                      placeholder="Address (e.g. House 123, Main Road, Ganderbal)"
                      value={addressForm.line1}
                      onChange={(e) => setAddressForm({ ...addressForm, line1: e.target.value })}
                    />
                    <div className="address-form-row">
                      <input
                        type="text"
                        placeholder="City"
                        value={addressForm.city}
                        onChange={(e) => setAddressForm({ ...addressForm, city: e.target.value })}
                      />
                      <input
                        type="text"
                        placeholder="Pincode"
                        value={addressForm.pincode}
                        onChange={(e) => setAddressForm({ ...addressForm, pincode: e.target.value })}
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="State"
                      value={addressForm.state}
                      onChange={(e) => setAddressForm({ ...addressForm, state: e.target.value })}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!addressForm.line1.trim()}
                      onClick={() => setDeliveryAddress({ ...addressForm, line1: addressForm.line1.trim() })}
                    >
                      Save Address
                    </button>
                  </div>
                )}
              </div>
            )}

            {orderType === "takeaway" && (
              <div className="pickup-section">
                <h4>Pickup Date &amp; Time</h4>
                <div className="pickup-fields">
                  <label className="pickup-field">
                    <span>Pickup Date</span>
                    <input
                      type="date"
                      value={pickupDate}
                      min={toLocalDateInput()}
                      onChange={(e) => setPickupDate(e.target.value)}
                    />
                  </label>
                  <label className="pickup-field">
                    <span>Pickup Time</span>
                    <input
                      type="time"
                      value={pickupTime}
                      min={pickupDate === toLocalDateInput() ? toLocalTimeInput() : undefined}
                      onChange={(e) => setPickupTime(e.target.value)}
                    />
                  </label>
                </div>
              </div>
            )}

            <div className="cart-section">
              <div className="cart-header">
                <h4>Cart <span className="cart-count">{cartItems.length}</span></h4>
                <span className="cart-total">{formatCurrency(subtotal)}</span>
              </div>
              {cartItems.length === 0 ? (
                <div className="empty-cart">
                  <div className="empty-cart-icon">🛒</div>
                  <p>Cart is empty</p>
                  <span>Tap items from the menu to add them</span>
                </div>
              ) : (
                <div className="cart-items">
                  {cartItems.map((item, index) => (
                    <div key={index} className="cart-item">
                      <div className="item-info">
                        <h5>{item.name}</h5>
                        <p>{formatCurrency(item.price)} × {item.qty} = <strong>{formatCurrency(item.price * item.qty)}</strong></p>
                        {item.modifiers?.length > 0 && (
                          <p className="modifiers">{item.modifiers.map(m => `${m.name}: ${m.option}`).join(" · ")}</p>
                        )}
                      </div>
                      <div className="item-controls">
                        <button onClick={() => updateQty(index, -1)} aria-label="Decrease quantity">−</button>
                        <span className="qty-value">{item.qty}</span>
                        <button onClick={() => updateQty(index, 1)} aria-label="Increase quantity">+</button>
                        <button className="btn-delete" onClick={() => removeFromCart(index)} aria-label="Remove item"><IconTrash size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="payment-section">
              <div className="section-title-row">
                <h4>Payment & Discounts</h4>
              </div>
              <div className="payment-method-row">
                <label className="form-label" htmlFor="pos-payment-method">Payment Method</label>
                <select id="pos-payment-method" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="upi">UPI</option>
                  <option value="wallet">Wallet</option>
                  <option value="split">Split</option>
                </select>
              </div>
              {paymentMethod === "split" && (
                <div className="split-payment">
                  <div className="split-header">
                    <h5>Split Payment</h5>
                    <span className="split-summary">Total {formatCurrency(finalTotal)}</span>
                  </div>
                  {splitPayments.map((row, index) => (
                    <div className="split-row" key={index}>
                      <select
                        value={row.method}
                        onChange={(e) => {
                          const next = [...splitPayments];
                          next[index] = { ...next[index], method: e.target.value };
                          setSplitPayments(next);
                        }}
                      >
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                        <option value="upi">UPI</option>
                        <option value="wallet">Wallet</option>
                      </select>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Amount"
                        value={row.amount}
                        onChange={(e) => {
                          const next = [...splitPayments];
                          next[index] = { ...next[index], amount: e.target.value };
                          setSplitPayments(next);
                        }}
                      />
                      <input
                        type="text"
                        placeholder="Ref (optional)"
                        value={row.reference}
                        onChange={(e) => {
                          const next = [...splitPayments];
                          next[index] = { ...next[index], reference: e.target.value };
                          setSplitPayments(next);
                        }}
                      />
                      <button
                        type="button"
                        className="split-remove-btn"
                        disabled={splitPayments.length <= 2}
                        onClick={() => setSplitPayments((prev) => prev.filter((_, i) => i !== index))}
                        aria-label="Remove split row"
                      >
                        <IconTrash size={15} />
                      </button>
                    </div>
                  ))}
                  <div className="split-footer">
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => setSplitPayments((prev) => [...prev, { method: "cash", amount: "", reference: "" }])}
                    >
                      <IconPlus size={14} /> Add Row
                    </button>
                    <span className={`split-remaining ${!splitValid ? "invalid" : ""}`}>
                      Paid {formatCurrency(splitTotal)} · Remaining {formatCurrency(splitRemaining)}
                    </span>
                  </div>
                  {!splitValid && (
                    <p className="split-error">Split amounts must total {formatCurrency(finalTotal)}</p>
                  )}
                </div>
              )}
              <div className="discount-row">
                <input
                  type="text"
                  placeholder="Coupon Code"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                />
                <button className="btn btn-sm btn-secondary" onClick={async () => {
                  if (couponCode) {
                    const res = await couponAPI.validate({ code: couponCode, orderAmount: subtotal, orderType });
                    if (res.data.success) {
                      setCouponDiscount(res.data.coupon.discount);
                    } else {
                      setCouponDiscount(0);
                      setError(res.data.message || "Invalid or expired coupon");
                    }
                  }
                }}>Apply</button>
              </div>
              {couponDiscount > 0 && (
                <div className="coupon-applied">
                  <span>🎟️ Coupon <strong>{couponCode}</strong> applied</span>
                  <span>−{formatCurrency(couponDiscount)}</span>
                </div>
              )}
              <div className="loyalty-row">
                <label className="loyalty-check">
                  <input type="checkbox" />
                  <IconLoyalty size={16} />
                  <span>Loyalty Points</span>
                </label>
                <input
                  type="number"
                  placeholder="Points"
                  value={loyaltyPointsUsed}
                  onChange={(e) => setLoyaltyPointsUsed(Number(e.target.value))}
                />
              </div>
              <div className="discount-row">
                <select value={discountType} onChange={(e) => setDiscountType(e.target.value)}>
                  <option value="flat">Flat Discount</option>
                  <option value="percent">% Discount</option>
                </select>
                <input
                  type="number"
                  step="0.01"
                  placeholder="Amount"
                  value={discount}
                  onChange={(e) => setDiscount(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="order-summary">
              <div className="summary-row"><span>Subtotal</span><span>{formatCurrency(orderTotals.subtotal)}</span></div>
              {(orderTotals.totalDiscount > 0 || orderTotals.discount > 0) && (
                <div className="summary-row discount"><span>Discount{couponDiscount > 0 ? " & Coupon" : ""}</span><span>−{formatCurrency(orderTotals.totalDiscount)}</span></div>
              )}
              {orderTotals.totalTax > 0 && (
                <div className="summary-row"><span>Tax</span><span>{formatCurrency(orderTotals.totalTax)}</span></div>
              )}
              {orderTotals.serviceCharge > 0 && (
                <div className="summary-row"><span>Service Charge</span><span>{formatCurrency(orderTotals.serviceCharge)}</span></div>
              )}
              {orderTotals.loyaltyPointsValue > 0 && (
                <div className="summary-row discount"><span>Loyalty</span><span>−{formatCurrency(orderTotals.loyaltyPointsValue)}</span></div>
              )}
              <div className="summary-row total"><span>Total</span><span>{formatCurrency(orderTotals.final)}</span></div>
            </div>

            <div className="notes-section">
              <label className="form-label" htmlFor="pos-order-notes">Order Notes</label>
              <textarea
                id="pos-order-notes"
                placeholder="Add order notes (e.g. no onions)..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>

            <button
              className="place-order-btn"
              onClick={handlePlaceOrder}
              disabled={loading || cartItems.length === 0 || (orderType === "dinein" && !selectedTable) || (paymentMethod === "split" && !splitValid)}
            >
              {loading ? (
                <><span className="spinner" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }}></span> Placing Order...</>
              ) : (
                <>Place Order · {formatCurrency(orderTotals.final)}</>
              )}
            </button>
          </main>
        </div>
      )}

      {activeTab === "kitchen" && (isKitchen || hasRole(["admin"])) && (
        <div className="kitchen-view">
          <div className="kitchen-filters">
            {["active", "pending", "preparing", "ready", "served"].map(filter => (
              <button
                key={filter}
                className={kitchenFilter === filter ? "active" : ""}
                onClick={() => setKitchenFilter(filter)}
              >
                {filter.charAt(0).toUpperCase() + filter.slice(1)}
              </button>
            ))}
          </div>
          <div className="kitchen-grid">
            {kitchenOrders
              .filter(o => {
                if (kitchenFilter === "active") return ["pending", "confirmed", "preparing", "ready", "served"].includes(o.orderStatus);
                return o.orderStatus === kitchenFilter;
              })
              .map(order => (
                <div key={order._id} className={`kitchen-ticket ${order.orderStatus}`}>
                  <div className="ticket-header">
                    <div>
                      <span className="ticket-number">#{order.orderNumber || order._id.slice(-6)}</span>
                      <span className="ticket-type">{order.orderType}</span>
                    </div>
                    <span className={`status-badge ${order.orderStatus}`}>{order.orderStatus}</span>
                  </div>
                  <div className="ticket-meta">
                    <span className="meta-item">Table {order.tableNo || "—"}</span>
                    <span className="meta-item">{new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    {order.priority === "high" && <span className="priority-high">Priority</span>}
                  </div>
                  <p className="customer-name">{order.orderType === "dinein" ? (order.servedBy?.name || "-") : order.customerName}</p>
                  <div className="ticket-items">
                    {order.items.map((item, i) => {
                      const size = getOrderItemSize(item);
                      const addons = getOrderItemAddons(item);
                      return (
                      <div key={i} className="ticket-item">
                        <span className="qty">{item.qty}×</span>
                        <span className="item-name">{item.name}</span>
                        {size && <span className="item-note item-size">Size: {size}</span>}
                        {addons.length > 0 && <span className="item-note">{addons.join(", ")}</span>}
                      </div>
                      );
                    })}
                  </div>
                  <div className="ticket-actions">
                    {renderOrderActions(order)}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {activeTab === "orders" && (
        <div className="orders-list">
          <div className="orders-toolbar">
            <div className="orders-toolbar-title">
              <h3>Orders</h3>
              <span className="orders-count">{filteredOrders.length} shown</span>
            </div>
            <div className="dropdown">
              <SearchBox
                value={orderSearch}
                onChange={setOrderSearch}
                placeholder="Search orders…"
                ariaLabel="Search orders"
                onKeyDown={handleOrderSearchKeyDown}
                onBlur={() => setTimeout(() => setOrderSearchOpen(false), 120)}
              />
              {orderSearchOpen && (
                <div className="header-search-dropdown">
                  {orderSearchLoading ? (
                    <div className="header-search-status">Searching…</div>
                  ) : orderSearchResults.length === 0 ? (
                    <div className="header-search-status">No matching orders.</div>
                  ) : (
                    <div className="header-search-results">
                      {orderSearchResults.map((order, index) => (
                        <button
                          key={order._id}
                          type="button"
                          className={`dropdown-item${orderSearchActive === index ? " dropdown-item-active" : ""}`}
                          onMouseEnter={() => setOrderSearchActive(index)}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => openOrderSearchResult(order)}
                        >
                          <span className="order-card-number">{order.orderNumber}</span>
                          <span className="order-card-name">{order.customerName || "—"}</span>
                          <span className="order-card-amount">{formatCurrency(order.total)}</span>
                          <span className={`status-badge ${order.orderStatus}`}>{order.orderStatus}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="orders-filters">
            <div className="filter-group">
              <span className="filter-label">Status</span>
              {[
                { key: "all", label: "All" },
                { key: "active", label: "Active" },
                { key: "settled", label: "Paid / Completed" },
                { key: "cancelled", label: "Cancelled / Refunded" },
              ].map(f => (
                <button
                  key={f.key}
                  className={`filter-btn ${orderStatusFilter === f.key ? "active" : ""}`}
                  onClick={() => setOrderStatusFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="filter-group">
              <span className="filter-label">Type</span>
              {[
                { key: "all", label: "All" },
                { key: "dinein", label: "Dine-in" },
                { key: "takeaway", label: "Takeaway" },
                { key: "delivery", label: "Delivery" },
              ].map(f => (
                <button
                  key={f.key}
                  className={`filter-btn ${orderTypeFilter === f.key ? "active" : ""}`}
                  onClick={() => applyOrderFilters(f.key, dateFilter)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="filter-group">
              <span className="filter-label">Date</span>
              {[
                { key: "all", label: "All" },
                { key: "today", label: "Today" },
                { key: "week", label: "This week" },
              ].map(f => (
                <button
                  key={f.key}
                  className={`filter-btn ${dateFilter === f.key ? "active" : ""}`}
                  onClick={() => applyOrderFilters(orderTypeFilter, f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {ordersUpdatedAt && (
            <div className="orders-updated">
              Updated {new Date(ordersUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          )}

          {ordersError && (
            <div className="orders-error">
              <p>{ordersError}</p>
              <button className="btn btn-secondary" onClick={() => fetchOrders(true)}>
                <IconRefresh size={14} /> Retry
              </button>
            </div>
          )}

          {!ordersError && ordersLoading && orders.length === 0 && (
            <div className="orders-loading">Loading orders…</div>
          )}

          {!ordersError && !ordersLoading && filteredOrders.length === 0 && (
            <div className="no-results orders-empty">
              {orderSearch.trim()
                ? `No orders match “${orderSearch.trim()}”.`
                : (orderStatusFilter !== "all" || orderTypeFilter !== "all" || dateFilter !== "all")
                  ? "No orders match the current filters."
                  : "No orders yet."}
            </div>
          )}

          {!ordersError && filteredOrders.length > 0 && (
            <div className="orders-cards">
              {filteredOrders.map(order => {
                const isDineIn = order.orderType === "dinein";
                const isDelivery = order.orderType === "delivery";
                const isExpanded = expandedOrderId === order._id;
                return (
                  <div
                    key={order._id}
                    id={`order-row-${order._id}`}
                    className={`order-card ${order._id === highlightedOrderId ? "order-card-highlight" : ""}`}
                  >
                    <button
                      className="order-card-main"
                      onClick={() => setExpandedOrderId(isExpanded ? null : order._id)}
                      aria-expanded={isExpanded}
                    >
                      <div className="order-card-block order-card-ref">
                        <span className="order-card-number">{order.orderNumber}</span>
                        <span className={`order-type-chip ${order.orderType}`}>
                          {order.orderType === "dinein" && <IconRestaurant size={12} />}
                          {order.orderType === "takeaway" && <IconBag size={12} />}
                          {order.orderType === "delivery" && <IconDelivery size={12} />}
                          {ORDER_TYPE_LABELS[order.orderType] || order.orderType}
                        </span>
                        {order.tableNo != null && <span className="order-card-table">Table {order.tableNo}</span>}
                      </div>
                      <div className="order-card-block order-card-identity">
                        <span className="order-card-name">
                          {isDineIn ? (order.servedBy?.name || "—") : (order.customerName || "—")}
                        </span>
                        <span className="order-card-sub">
                          {isDelivery
                            ? (getAssignedName(order) !== "-" ? `Assigned: ${getAssignedName(order)}` : "Delivery")
                            : isDineIn
                              ? (order.servedBy?.name ? `Served by ${order.servedBy.name}` : "")
                              : (order.customerPhone || PAYMENT_METHOD_LABELS[order.paymentMethod] || order.paymentMethod)}
                        </span>
                      </div>
                      <div className="order-card-block order-card-status">
                        <span className={`status-badge ${order.orderStatus}`}>{order.orderStatus}</span>
                        {order.paymentMethod === "cash" && order.orderType !== "dinein" && order.paymentStatus !== "paid" && (
                          <span className="status-badge pending">Cash Pending</span>
                        )}
                        {Number(order.additionalAmountDue) > 0 && (
                          <span className="status-badge pending">Due {formatCurrency(order.additionalAmountDue)}</span>
                        )}
                        <span className="order-card-time">{timeAgo(order.createdAt)}</span>
                      </div>
                      <div className="order-card-block order-card-total">
                        <span className="order-card-amount">{formatCurrency(order.total)}</span>
                        <IconChevronDown className={`order-card-chevron ${isExpanded ? "open" : ""}`} size={16} />
                      </div>
                    </button>
                    {!["cancelled", "refunded"].includes(order.orderStatus) && (
                      <div className="order-card-actions" onClick={(e) => e.stopPropagation()}>
                        {renderOrderActions(order)}
                      </div>
                    )}
                    {isExpanded && (
                      <div className="order-card-detail">
                        <div className="order-detail-items">
                          <div className="order-detail-label">Items</div>
                          {order.items.map((item, i) => {
                            const size = getOrderItemSize(item);
                            const addons = getOrderItemAddons(item);
                            const extras = [
                              size && `Size: ${size}`,
                              addons.length > 0 && `Add-ons: ${addons.join(", ")}`,
                              item.notes && `Notes: ${item.notes}`,
                            ].filter(Boolean);
                            return (
                              <div key={i} className="order-item-line">
                                <span className="order-item-qty">{item.qty}×</span>
                                <span className="order-item-name">{item.name}</span>
                                {extras.length > 0 && <span className="order-item-extra">{extras.join(" · ")}</span>}
                              </div>
                            );
                          })}
                        </div>
                        <div className="order-detail-fields">
                          <div className="order-detail-field">
                            <span className="order-detail-label">Payment</span>
                            <span className="order-detail-value">
                              {order.paymentMethod === "cash"
                                ? (order.paymentStatus === "paid" ? "Paid" : "Cash Pending")
                                : `${PAYMENT_METHOD_LABELS[order.paymentMethod] || order.paymentMethod}${order.paymentStatus ? ` · ${order.paymentStatus}` : ""}`}
                            </span>
                          </div>
                          {order.customerPhone && (
                            <div className="order-detail-field">
                              <span className="order-detail-label">Phone</span>
                              <span className="order-detail-value">{order.customerPhone}</span>
                            </div>
                          )}
                          {Number(order.additionalAmountDue) > 0 && (
                            <div className="order-detail-field">
                              <span className="order-detail-label">Additional Due</span>
                              <span className="order-detail-value">{formatCurrency(order.additionalAmountDue)}</span>
                            </div>
                          )}
                          {Number(order.refundAmountDue) > 0 && (
                            <div className="order-detail-field">
                              <span className="order-detail-label">Refund Due</span>
                              <span className="order-detail-value">{formatCurrency(order.refundAmountDue)}</span>
                            </div>
                          )}
                          {isDineIn && order.servedBy?.name && (
                            <div className="order-detail-field">
                              <span className="order-detail-label">Waiter</span>
                              <span className="order-detail-value">{order.servedBy.name}</span>
                            </div>
                          )}
                          {isDelivery && getAssignedName(order) !== "-" && (
                            <div className="order-detail-field">
                              <span className="order-detail-label">Delivery</span>
                              <span className="order-detail-value">{getAssignedName(order)}</span>
                            </div>
                          )}
                          {isDelivery && order.deliveryAddress && (
                            <div className="order-detail-field order-detail-field-wide">
                              <span className="order-detail-label">Delivery Address</span>
                              <span className="order-detail-value">
                                {formatAddress(order.deliveryAddress)}
                                {order.deliveryAddress?.distanceKm ? ` · ${order.deliveryAddress.distanceKm} km` : ""}
                              </span>
                            </div>
                          )}
                          {order.orderType === "takeaway" && order.pickupAt && (
                            <div className="order-detail-field">
                              <span className="order-detail-label">Pickup</span>
                              <span className="order-detail-value">{new Date(order.pickupAt).toLocaleString()}</span>
                            </div>
                          )}
                          {order.notes && (
                            <div className="order-detail-field order-detail-field-wide">
                              <span className="order-detail-label">Notes</span>
                              <span className="order-detail-value">{order.notes}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === "reports" && hasRole(["admin"]) && (
        <div className="reports-view">
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">📈</div>
              <h3 className="empty-state-title">Quick Reports</h3>
              <p className="empty-state-description">Detailed sales, payment and order reports are available on the Reports page.</p>
              <Link to="/reports" className="btn btn-primary">Open Reports</Link>
            </div>
          </div>
        </div>
      )}

      {assignOrder && (
        <div className="modal-overlay" onClick={() => setAssignOrder(null)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Assign Delivery</h3>
              <button className="modal-close" onClick={() => setAssignOrder(null)} aria-label="Close assign dialog">×</button>
            </div>
            <div className="modal-body">
              <p className="form-hint">Order #{assignOrder.orderNumber} — choose a delivery person.</p>
              {availableDeliveryStaff.length === 0 ? (
                <p className="form-hint">
                  No active delivery staff found. Create a user with the "Delivery" role on the Staff page first.
                </p>
              ) : (
                <div className="form-group">
                  <label htmlFor="assign-delivery-select">Delivery person</label>
                  <select
                    id="assign-delivery-select"
                    className="form-select"
                    value={assignSelection}
                    onChange={(e) => setAssignSelection(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {availableDeliveryStaff.map((member) => (
                      <option key={member._id} value={member._id}>
                        {member.name}
                        {member.email ? ` (${member.email})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setAssignOrder(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={!assignSelection || assigning}
                onClick={() => handleAssignDelivery(assignOrder._id, assignSelection)}
              >
                {assigning ? "Assigning…" : "Assign"}
              </button>
            </div>
          </div>
        </div>
      )}

      {collectOrder && (
        <div className="modal-overlay" onClick={() => setCollectOrder(null)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Collect Additional Payment</h3>
              <button className="modal-close" onClick={() => setCollectOrder(null)} aria-label="Close collect payment dialog">×</button>
            </div>
            <div className="modal-body">
              <p className="form-hint">
                Order #{collectOrder.orderNumber} — {formatCurrency(collectOrder.additionalAmountDue)} is due because the order was edited.
              </p>
              <div className="collect-mode-row">
                <button
                  type="button"
                  className={`collect-mode-btn ${collectMode === "cash" ? "active" : ""}`}
                  onClick={() => setCollectMode(collectMode === "cash" ? null : "cash")}
                  disabled={collectBusy}
                >
                  Cash
                </button>
                <button
                  type="button"
                  className={`collect-mode-btn ${collectMode === "online" ? "active" : ""}`}
                  onClick={() => setCollectMode(collectMode === "online" ? null : "online")}
                  disabled={collectBusy}
                >
                  UPI / Card
                </button>
              </div>
              <div className="collect-link-block">
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => handleGeneratePaymentLink(collectOrder)}
                  disabled={linkBusy || collectBusy}
                >
                  {linkBusy ? "Generating…" : "Generate Payment Link"}
                </button>
                <p className="form-hint">
                  Shareable link for the customer to pay the outstanding {formatCurrency(collectOrder.additionalAmountDue)} online. Valid for 72 hours.
                </p>
                {linkError && <p className="form-error">{linkError}</p>}
                {paymentLink && (
                  <div className="collect-link-result">
                    <code className="collect-link-url">{paymentLink}</code>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={handleCopyPaymentLink}
                    >
                      {linkCopied ? "Copied" : "Copy Link"}
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setCollectOrder(null)} disabled={collectBusy}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={!collectMode || collectBusy}
                onClick={handleCollectContinue}
              >
                {collectBusy ? "Processing…" : collectMode === "cash" ? "Collect Cash" : "Start Payment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingOrder && (
        <EditOrderModal
          key={editingOrder._id}
          order={editingOrder}
          menuItems={menuItems}
          categories={categoryList}
          onClose={() => setEditingOrder(null)}
          onSaved={handleEditOrderSaved}
          onPayOnline={handleEditModalPayOnline}
        />
      )}

      {lastOrder && (
        <div className="modal-overlay" onClick={() => setLastOrder(null)}>
          <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Receipt</h3>
              <button className="modal-close" onClick={() => setLastOrder(null)} aria-label="Close receipt">×</button>
            </div>
            <div className="modal-body">
              <div className="detail-section">
                <div className="detail-row"><span className="label">Order</span><span className="value">{lastOrder.orderNumber}</span></div>
                <div className="detail-row"><span className="label">Customer</span><span className="value">{lastOrder.customerName}</span></div>
                <div className="detail-row"><span className="label">Table</span><span className="value">{lastOrder.tableNo || "-"}</span></div>
                <div className="detail-row"><span className="label">Type</span><span className="value text-capitalize">{lastOrder.orderType}</span></div>
                <div className="detail-row"><span className="label">Payment</span><span className="value text-capitalize">{lastOrder.paymentMethod}</span></div>
                <div className="detail-row"><span className="label">Status</span><span className={`status-badge ${lastOrder.orderStatus}`}>{lastOrder.orderStatus}</span></div>
              </div>
              <h4 className="receipt-items-title">Items</h4>
              {lastOrder.items.map((item, i) => {
                const size = getOrderItemSize(item);
                return (
                <div key={i} className="receipt-item">
                  <span>{item.qty}× {item.name}{size ? ` (${size})` : ""}</span>
                  <span>{formatCurrency(item.price * item.qty)}</span>
                </div>
                );
              })}
              <div className="receipt-total">
                <strong>Total: {formatCurrency(lastOrder.total)}</strong>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setLastOrder(null)}>Close</button>
              <button className="btn btn-primary" onClick={() => handlePrint(lastOrder, "invoice")}>Print</button>
            </div>
          </div>
        </div>
      )}

      {printOrder &&
        createPortal(
          <>
            <style>{`
              @media screen { .print-area { display: none; } }
              @media print {
                @page { size: 58mm auto; margin: 0; }
                html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
                #root { display: none !important; }
                .print-area {
                  display: block !important;
                  width: ${thermalEnabled ? "58mm" : "100%"};
                  margin: 0 auto;
                  padding: 0;
                  font-family: Arial, Helvetica, sans-serif;
                  font-size: 10px;
                  line-height: 1.3;
                  color: #000;
                  -webkit-print-color-adjust: exact;
                  print-color-adjust: exact;
                }
                .print-area * { box-sizing: border-box; }
              }
            `}</style>
            <div className="print-area" data-printer-port={thermalPort}>
              {printOrder.type === "kot" ? (
                <KOTReceipt order={printOrder.order} thermal={thermalEnabled} />
              ) : (
                <InvoiceReceipt
                  order={printOrder.order}
                  restaurantName={posSettings?.restaurant_name || ""}
                  restaurantAddress={posSettings?.restaurant_address || ""}
                  restaurantPhone={posSettings?.restaurant_phone || ""}
                  gstin={posSettings?.gstin || ""}
                  header={posSettings?.receipt_header || ""}
                  footer={posSettings?.receipt_footer || ""}
                  thermal={thermalEnabled}
                />
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}

// Normalizes a modifier/option name so matching is case/whitespace-insensitive,
// mirroring the server's normalizeModifierKey.
const normalizeKey = (s) => String(s || "").toLowerCase().trim().replace(/\s+/g, " ");

// Builds the clean modifiers array [{name, option, price}] for a menu item
// given the selected options per modifier group. Pre-fills required groups with
// their first available option when nothing is selected (mirrors server rule).
const buildModifiers = (menuItem, selectedByOptionKey) => {
  const clean = [];
  for (const group of menuItem.modifiers || []) {
    const groupKey = normalizeKey(group.name);
    const options = group.options || [];
    let picked = options.filter((o) => selectedByOptionKey[`${groupKey}::${normalizeKey(o.name)}`]);
    if (picked.length === 0 && group.required && options.length > 0) {
      picked = [options[0]];
    }
    for (const o of picked) {
      clean.push({ name: group.name, option: o.name, price: Number(o.price) || 0 });
    }
  }
  return clean;
};

// Line price used only for the client-side preview. The server recomputes all
// financials authoritatively; never sent to the server as truth.
const lineUnitPrice = (menuItem, modifiers) => {
  const base = Number(menuItem?.price) || 0;
  const mods = (modifiers || []).reduce((sum, m) => sum + (Number(m.price) || 0), 0);
  return Math.round((base + mods) * 100) / 100;
};

// Edits the items of an existing order. All financials are recomputed on the
// server; the client only sends the desired line items + reason + optimistic
// lock token (baseUpdatedAt). The server runs the authoritative validation
// (availability, modifier rules, inventory shortage) and writes the audit trail.
const EditOrderModal = ({ order, menuItems, categories, onClose, onSaved, onPayOnline }) => {
  const menuById = useMemo(() => {
    const map = new Map();
    menuItems.forEach((it) => map.set(it._id, it));
    return map;
  }, [menuItems]);

  const [lines, setLines] = useState(() =>
    (order.items || []).map((it) => ({
      menuItemId: it.menuItemId,
      menuItemName: it.name,
      qty: Number(it.qty) || 1,
      size: it.size || "",
      notes: it.notes || "",
      modifiers: (it.modifiers || []).map((m) => ({ name: m.name, option: m.option, price: Number(m.price) || 0 })),
    }))
  );
  const [reason, setReason] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [collecting, setCollecting] = useState(false);

  const [addQuery, setAddQuery] = useState("");
  const [addCategory, setAddCategory] = useState("All");
  const [expandedItemId, setExpandedItemId] = useState(null);

  const discount = Number(order.discount) || 0;

  const availableItems = useMemo(() => {
    const inCart = new Set(lines.map((l) => l.menuItemId));
    let list = menuItems.filter((it) => it.isAvailable !== false && !inCart.has(it._id));
    const q = addQuery.trim().toLowerCase();
    if (q) list = list.filter((it) => it.name?.toLowerCase().includes(q));
    if (addCategory !== "All") list = list.filter((it) => it.category?.name === addCategory);
    return list;
  }, [menuItems, lines, addQuery, addCategory]);

  const activeCategories = useMemo(
    () => categories || ["All"],
    [categories]
  );

  const addItem = (item) => {
    // Pre-select the required modifier group options so the server's required
    // rule is satisfied; the user can adjust after adding.
    const selectedByOptionKey = {};
    setLines((prev) => [
      ...prev,
      {
        menuItemId: item._id,
        menuItemName: item.name,
        qty: 1,
        size: "",
        notes: "",
        modifiers: buildModifiers(item, selectedByOptionKey),
      },
    ]);
    setAddQuery("");
  };

  const updateLine = (index, patch) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const removeLine = (index) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const setModifier = (index, group, option, checked) => {
    const item = menuById.get(lines[index].menuItemId);
    if (!item) return;
    const groupKey = normalizeKey(group.name);

    // Preserve selections from every other modifier group, then rebuild the
    // current group's selection with the toggled option.
    const selectedByOptionKey = {};
    lines[index].modifiers.forEach((m) => {
      if (normalizeKey(m.name) !== groupKey) {
        selectedByOptionKey[`${normalizeKey(m.name)}::${normalizeKey(m.option)}`] = true;
      }
    });

    // Rebuild the whole item's modifiers so required-group pre-fill stays
    // consistent even when the calendar/notes change nothing here.
    const clean = buildModifiers(item, selectedByOptionKey);

    // Now re-apply the current group's selection on top of the rebuilt set.
    const finalClean = clean.filter((m) => normalizeKey(m.name) !== groupKey);
    if (checked) {
      finalClean.push({ name: group.name, option: option.name, price: Number(option.price) || 0 });
    } else {
      const groupOptions = group.options || [];
      const remaining = groupOptions.find((o) => normalizeKey(o.name) !== normalizeKey(option.name));
      if (group.required && remaining) {
        finalClean.push({ name: group.name, option: remaining.name, price: Number(remaining.price) || 0 });
      }
    }
    updateLine(index, { modifiers: finalClean });
  };

  const previewSubtotal = useMemo(
    () =>
      Math.round(
        lines.reduce((sum, l) => {
          const item = menuById.get(l.menuItemId);
          return sum + lineUnitPrice(item, l.modifiers) * l.qty;
        }, 0) * 100
      ) / 100,
    [lines, menuById]
  );
  const previewDiscount = Math.min(discount, previewSubtotal);

  const handleSave = async () => {
    setSaving(true);
    setSaveError("");
    setResult(null);
    const payload = {
      items: lines.map((l) => ({
        menuItemId: l.menuItemId,
        qty: l.qty,
        modifiers: l.modifiers,
        size: l.size,
        notes: l.notes,
      })),
      reason: reason,
      baseUpdatedAt: order.updatedAt || order.updated_at,
    };
    try {
      const res = await orderAPI.editItems(order._id, payload);
      if (res.data.success) {
        setResult(res.data);
        onSaved(res.data);
      } else {
        setSaveError(res.data.message || "Failed to save order changes");
      }
    } catch (err) {
      if (err.response?.status === 409) {
        setSaveError("This order was modified by someone else. Please review the latest version and try again.");
      } else {
        setSaveError(err.response?.data?.message || "Failed to save order changes");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCollectCash = async () => {
    setCollecting(true);
    setSaveError("");
    try {
      const res = await orderAPI.collectAdditional(order._id, {
        method: "cash",
        notes: `Additional payment of ${formatCurrency(order.additionalAmountDue)} after edit`,
      });
      if (res.data.success) {
        onSaved(res.data);
        onClose();
      } else {
        setSaveError(res.data.message || "Failed to record additional payment");
      }
    } catch (err) {
      setSaveError(err.response?.data?.message || "Failed to record additional payment");
    } finally {
      setCollecting(false);
    }
  };

  const handlePayOnline = async () => {
    setCollecting(true);
    setSaveError("");
    try {
      const fresh = await onPayOnline(order);
      if (fresh) {
        onSaved({ success: true, order: fresh });
        onClose();
      }
    } finally {
      setCollecting(false);
    }
  };

  if (result) {
    const updated = result.order || {};
    const editInfo = result.edit || {};
    const oldTotal = Number(editInfo.previousTotal ?? order.total) || 0;
    const newTotal = Number(updated.total ?? editInfo.newTotal) || oldTotal;
    const diff = Math.round((newTotal - oldTotal) * 100) / 100;
    const additionalDue = Number(editInfo.additionalAmountDue ?? updated.additionalAmountDue) > 0
      ? Number(editInfo.additionalAmountDue ?? updated.additionalAmountDue) : 0;
    const refundDue = Number(editInfo.refundAmountDue ?? updated.refundAmountDue) > 0
      ? Number(editInfo.refundAmountDue ?? updated.refundAmountDue) : 0;

    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h3 className="modal-title">Order Updated</h3>
            <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
          </div>
          <div className="modal-body">
            <p className="form-hint">
              Order #{order.orderNumber} was updated successfully.
            </p>
            <div className="summary-row">
              <span>Previous total</span>
              <span>{formatCurrency(oldTotal)}</span>
            </div>
            <div className="summary-row">
              <span>New total</span>
              <span>{formatCurrency(newTotal)}</span>
            </div>
            <div className={`summary-row ${diff !== 0 ? "discount" : ""}`}>
              <span>Difference</span>
              <span>{diff >= 0 ? `+${formatCurrency(diff)}` : `-${formatCurrency(Math.abs(diff))}`}</span>
            </div>
            {additionalDue > 0 && (
              <div className="summary-row total">
                <span>Additional payment due</span>
                <span>{formatCurrency(additionalDue)}</span>
              </div>
            )}
            {refundDue > 0 && (
              <div className="summary-row total">
                <span>Refund amount due</span>
                <span>{formatCurrency(refundDue)}</span>
              </div>
            )}
            {additionalDue > 0 && (
              <p className="form-hint">Please collect the additional amount from the customer.</p>
            )}
            {refundDue > 0 && (
              <p className="form-hint">Be assured: no automatic refund is processed. Please process the refund via your payment gateway/reconciliation manually.</p>
            )}
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>Done</button>
            {additionalDue > 0 && collecting ? (
              <button className="btn btn-primary" disabled>Processing…</button>
            ) : additionalDue > 0 ? (
              <>
                <button className="btn btn-secondary" onClick={handlePayOnline}>Pay Online</button>
                <button className="btn btn-primary" onClick={handleCollectCash}>Collect Cash</button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // When adding an online payment the parent's checkout may have already closed
  // the modal; guard against rendering a closed state.
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Edit Order #{order.orderNumber}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close edit dialog">×</button>
        </div>
        <div className="modal-body">
          <p className="form-hint">
            Update line items below. Prices, tax, delivery fee and inventory are
            recomputed on the server — the shown totals are a preview only.
          </p>
          {saveError && <div className="toast error">{saveError}</div>}

          <div className="edit-items-list">
            {lines.map((line, index) => {
              const item = menuById.get(line.menuItemId);
              const unitPrice = lineUnitPrice(item, line.modifiers);
              return (
                <div key={`${line.menuItemId}-${index}`} className="edit-line">
                  <div className="edit-line-top">
                    <button
                      type="button"
                      className="qty-btn"
                      aria-label="Decrease quantity"
                      onClick={() => updateLine(index, { qty: Math.max(1, line.qty - 1) })}
                    >
                      −
                    </button>
                    <span className="edit-line-qty">{line.qty}</span>
                    <button
                      type="button"
                      className="qty-btn"
                      aria-label="Increase quantity"
                      onClick={() => updateLine(index, { qty: line.qty + 1 })}
                    >
                      +
                    </button>
                    <div className="edit-line-info">
                      <span className="edit-line-name">{line.menuItemName}</span>
                      <span className="edit-line-price">{formatCurrency(unitPrice)} each</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => removeLine(index)}
                    >
                      Remove
                    </button>
                    {item && (item.modifiers?.length || 0) > 0 && (
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => setExpandedItemId((cur) => (cur === `${index}` ? null : `${index}`))}
                      >
                        {expandedItemId === `${index}` ? "Hide" : "Options"}
                      </button>
                    )}
                  </div>

                  {expandedItemId === `${index}` && item && (item.modifiers || []).length > 0 && (
                    <div className="edit-line-options">
                      {(item.modifiers || []).map((group, gi) => {
                        const groupKey = normalizeKey(group.name);
                        const selected = line.modifiers.filter((m) => normalizeKey(m.name) === groupKey);
                        return (
                          <div key={`${groupKey}-${gi}`} className="modifier-group">
                            <label className="modifier-group-label">
                              {group.name}
                              {group.required ? " *" : ""}
                            </label>
                            <div className="modifier-options">
                              {(group.options || []).map((opt, oi) => {
                                const isSel = selected.some((m) => normalizeKey(m.option) === normalizeKey(opt.name));
                                return (
                                  <label key={`${groupKey}-${oi}`} className="modifier-option">
                                    <input
                                      type={group.multiSelect ? "checkbox" : "radio"}
                                      name={`${line.menuItemId}-${groupKey}`}
                                      checked={isSel}
                                      onChange={(e) => setModifier(index, group, opt, e.target.checked)}
                                    />
                                    <span>{opt.name}</span>
                                    {Number(opt.price) > 0 && <span className="modifier-option-price">+{formatCurrency(opt.price)}</span>}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                      <div className="form-group">
                        <label>Notes</label>
                        <input
                          type="text"
                          className="form-input"
                          value={line.notes}
                          onChange={(e) => updateLine(index, { notes: e.target.value })}
                          placeholder="Item notes"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {lines.length === 0 && <p className="form-hint">No items. Add items below.</p>}
          </div>

          <div className="edit-add-section">
            <h4 className="edit-add-title">Add item</h4>
            <div className="edit-add-controls">
              <input
                type="text"
                className="form-input"
                placeholder="Search menu…"
                value={addQuery}
                onChange={(e) => setAddQuery(e.target.value)}
              />
              <select
                className="form-select"
                value={addCategory}
                onChange={(e) => setAddCategory(e.target.value)}
              >
                {activeCategories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="edit-add-grid">
              {availableItems.slice(0, 12).map((it) => (
                <button
                  key={it._id}
                  type="button"
                  className="edit-add-item"
                  onClick={() => addItem(it)}
                >
                  <span className="edit-add-item-name">{it.name}</span>
                  <span className="edit-add-item-price">{formatCurrency(it.price)}</span>
                </button>
              ))}
              {availableItems.length === 0 && <p className="form-hint">No more items to add.</p>}
            </div>
          </div>

          <div className="edit-preview">
            <div className="summary-row">
              <span>Subtotal (preview)</span>
              <span>{formatCurrency(previewSubtotal)}</span>
            </div>
            {previewDiscount > 0 && (
              <div className="summary-row discount">
                <span>Discount</span>
                <span>−{formatCurrency(previewDiscount)}</span>
              </div>
            )}
            <div className="summary-row total">
              <span>Total (preview)</span>
              <span>{formatCurrency(previewSubtotal - previewDiscount)}</span>
            </div>
            <p className="form-hint">Final tax, delivery fee and totals are recalculated by the server.</p>
          </div>

          <div className="form-group">
            <label>Reason for edit</label>
            <textarea
              className="form-textarea"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Optional — e.g. customer removed a dish"
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || lines.length === 0}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
};