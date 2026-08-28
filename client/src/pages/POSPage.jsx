import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
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

// Dedicated "waiter" role for front-of-house staff serving Dine-In tables.
const WAITER_ROLES = ["waiter"];

const SEEN_ORDERS_KEY = "pos_seen_orders_v1";
const SOUND_ENABLED_KEY = "pos_sound_enabled_v2";

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
  const [kitchenOrders, setKitchenOrders] = useState([]);
  const [kitchenFilter, setKitchenFilter] = useState("active");
  const [lastOrder, setLastOrder] = useState(null);
  const [printOrder, setPrintOrder] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      localStorage.removeItem("pos_sound_enabled");
      return localStorage.getItem(SOUND_ENABLED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const soundEnabledRef = useRef(soundEnabled);
  const [orderAlerts, setOrderAlerts] = useState([]);
  const audioCtxRef = useRef(null);
  const cashfreeLoadedRef = useRef(false);
  const orderAlertTimersRef = useRef({});
  const seenOrderIdsRef = useRef(null);
  const newOrderBaselineRef = useRef(false);

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
    playBeep([880, 1100, 880]);
  };

  const handleSoundToggle = (checked) => {
    setSoundEnabled(checked);
    if (checked) {
      const ctx = getAudioContext();
      if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
      playBeep([880, 880]);
    }
  };

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

  const fetchOrders = async (showLoader = true) => {
    try {
      if (showLoader) setLoading(true);
      const res = await orderAPI.getAll({ limit: 50 });
      if (res.data.success) {
        const newOrders = res.data.orders;
        detectNewOrders(newOrders);
        setOrders(newOrders);
      }
    } catch (err) {
      console.error("Failed to load orders");
    } finally {
      if (showLoader) setLoading(false);
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

  const filteredMenuItems = useMemo(() => {
    const byCategory =
      selectedCategory === "All"
        ? menuItems
        : menuItems.filter(item => item.category?.name === selectedCategory);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return byCategory;
    return byCategory.filter(item => item.name?.toLowerCase().includes(q));
  }, [menuItems, selectedCategory, searchQuery]);

  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(o =>
      o.orderNumber?.toLowerCase().includes(q) ||
      o.customerName?.toLowerCase().includes(q) ||
      o.orderType?.toLowerCase().includes(q) ||
      (o.tableNo != null && String(o.tableNo).toLowerCase().includes(q)) ||
      o.paymentMethod?.toLowerCase().includes(q) ||
      o.orderStatus?.toLowerCase().includes(q)
    );
  }, [orders, orderSearch]);

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
    if (!["cancelled", "refunded"].includes(order.orderStatus)) {
      actions.push(<button key="kot" className="btn btn-sm btn-secondary" onClick={() => handlePrint(order, "kot")}>Print KOT</button>);
      actions.push(<button key="invoice" className="btn btn-sm btn-secondary" onClick={() => handlePrint(order, "invoice")}>Print Invoice</button>);
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
          <div className="orders-header">
            <h3>Recent Orders</h3>
            <SearchBox
              value={orderSearch}
              onChange={setOrderSearch}
              placeholder="Search orders…"
              ariaLabel="Search orders"
            />
            <button onClick={() => fetchOrders(true)} className="btn btn-secondary">Refresh</button>
          </div>
          <div className="orders-table-container">
            <table>
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Customer</th>
                  <th>Type</th>
                  <th>Table</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th>Total</th>
                  <th>Time</th>
                  <th>Assigned</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="no-results">
                      {orderSearch.trim() ? `No orders match “${orderSearch.trim()}”.` : "No orders yet."}
                    </td>
                  </tr>
                ) :
                  filteredOrders.slice(0, 20).map(order => (
                  <Fragment key={order._id}>
                    <tr
                      id={`order-row-${order._id}`}
                      className={order._id === highlightedOrderId ? "order-row-highlight" : ""}
                      onClick={() => setExpandedOrderId(expandedOrderId === order._id ? null : order._id)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>{order.orderNumber}</td>
                      <td>{order.orderType === "dinein" ? (order.servedBy?.name || "-") : order.customerName}</td>
                      <td>{order.orderType}</td>
                      <td>{order.tableNo || "-"}</td>
                      <td><span className={`status-badge ${order.orderStatus}`}>{order.orderStatus}</span></td>
                      <td>{order.paymentMethod}</td>
                      <td>{formatCurrency(order.total)}</td>
                      <td>{new Date(order.createdAt).toLocaleString()}</td>
                      <td><span className="assigned-name">{getAssignedName(order)}</span></td>
                      <td onClick={(e) => e.stopPropagation()}>{renderOrderActions(order)}</td>
                    </tr>
                    {expandedOrderId === order._id && (
                      <tr className="order-details-row">
                        <td colSpan={10}>
                          <div className="order-details-content">
                            {order.customerPhone && (
                              <div className="order-note">
                                <span className="order-note-label">Phone</span>
                                <span className="order-note-text">{order.customerPhone}</span>
                              </div>
                            )}
                            {order.orderType === "delivery" && order.deliveryAddress && (
                              <div className="order-note">
                                <span className="order-note-label">Delivery Address</span>
                                <span className="order-note-text">
                                  {formatAddress(order.deliveryAddress)}
                                  {order.deliveryAddress?.distanceKm ? ` · ${order.deliveryAddress.distanceKm} km` : ""}
                                </span>
                              </div>
                            )}
                            {order.orderType === "takeaway" && order.pickupAt && (
                              <div className="order-note">
                                <span className="order-note-label">Pickup</span>
                                <span className="order-note-text">{new Date(order.pickupAt).toLocaleString()}</span>
                              </div>
                            )}
                            <div className="order-note">
                              <span className="order-note-label">Notes</span>
                              <span className="order-note-text">{order.notes || "No notes"}</span>
                            </div>
                            {order.orderType === "dinein" && (
                              <div className="order-note">
                                <span className="order-note-label">Waiter</span>
                                <span className="order-note-text">{order.servedBy?.name || "-"}</span>
                              </div>
                            )}
                            <div className="order-note">
                              <span className="order-note-label">Items</span>
                              <div className="order-items-detail">
                                {order.items.map((item, i) => {
                                  const size = getOrderItemSize(item);
                                  const addons = getOrderItemAddons(item);
                                  return (
                                    <div key={i} className="order-item-detail">
                                      <div className="order-item-detail-name">{item.name}</div>
                                      {size && <div className="order-item-detail-row">Size: {size}</div>}
                                      <div className="order-item-detail-row">Qty: {item.qty}</div>
                                      {addons.length > 0 && <div className="order-item-detail-row">Add-ons: {addons.join(", ")}</div>}
                                      {item.notes && <div className="order-item-detail-row">Notes: {item.notes}</div>}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "reports" && hasRole(["admin"]) && (
        <div className="reports-view">
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">📈</div>
              <h3 className="empty-state-title">Quick Reports</h3>
              <p className="empty-state-description">Detailed sales, payment and order reports are available on the Reports page.</p>
              <a href="/reports" className="btn btn-primary">Open Reports</a>
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