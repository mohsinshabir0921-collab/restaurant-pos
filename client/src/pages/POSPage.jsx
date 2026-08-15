import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { menuAPI, orderAPI, tableAPI, customerAPI, settingsAPI, paymentAPI, couponAPI, loyaltyAPI, categoryAPI } from "../services/api";
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
} from "../components/icons";

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;

const formatAddress = (addr) => {
  if (!addr) return "";
  const cityState = [addr.city, addr.state].filter(Boolean).join(", ");
  const parts = [addr.line1, addr.line2, cityState].filter(Boolean);
  const str = parts.join(", ");
  return addr.pincode ? `${str} - ${addr.pincode}` : str;
};

const ORDER_TYPE_LABELS = { dinein: "Dine-in", takeaway: "Takeaway", delivery: "Delivery" };

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

const printStyle = { fontFamily: "monospace", fontSize: 13, color: "#000", width: "72mm", margin: "0 auto" };
const printRow = (display, flex, space) => ({ display, justifyContent: space ? "space-between" : undefined, ...flex });

const KOTReceipt = ({ order }) => (
  <div style={printStyle}>
    <div style={{ textAlign: "center" }}>
      <h3 style={{ margin: 0, fontSize: 15 }}>KITCHEN ORDER TICKET</h3>
      <div>#{order.orderNumber || order._id}</div>
      <div>{order.orderType === "dinein" ? `Table: ${order.tableNo || "-"}` : order.orderType.toUpperCase()}</div>
      <div>{new Date(order.createdAt).toLocaleString()}</div>
    </div>
    <hr style={{ borderTop: "1px dashed #000" }} />
    {(order.items || []).map((item, i) => (
      <div key={i} style={{ marginBottom: 4 }}>
        <div>{item.qty} x {item.name}</div>
        {item.modifiers?.length > 0 && (
          <div style={{ paddingLeft: 8, fontSize: 12 }}>{item.modifiers.map(m => m.option).join(", ")}</div>
        )}
        {item.kitchenStation && (
          <div style={{ paddingLeft: 8, fontSize: 12 }}>Station: {item.kitchenStation}</div>
        )}
      </div>
    ))}
    <hr style={{ borderTop: "1px dashed #000" }} />
    <div>Status: {order.orderStatus}</div>
    <div style={{ textAlign: "center", marginTop: 8 }}>--- END ---</div>
  </div>
);

const InvoiceReceipt = ({ order, restaurantName = "", restaurantAddress = "", restaurantPhone = "" }) => {
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

  return (
    <div style={printStyle}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{restaurantName || "Restaurant"}</div>
        {restaurantAddress && <div>{restaurantAddress}</div>}
        {restaurantPhone && <div>Ph: {restaurantPhone}</div>}
        <h3 style={{ margin: 0, fontSize: 14, marginTop: 4 }}>TAX INVOICE</h3>
        <div>#{order.orderNumber || order._id}</div>
        <div>{new Date(order.createdAt).toLocaleString()}</div>
      </div>
      <hr style={{ borderTop: "1px dashed #000" }} />
      <div>Type: {orderTypeLabel}</div>
      {order.orderType === "dinein" && order.tableNo ? <div>Table: {order.tableNo}</div> : null}
      {order.orderType === "takeaway" && order.pickupAt ? <div>Pickup Date/Time: {new Date(order.pickupAt).toLocaleString()}</div> : null}
      {order.customerName && <div>Customer: {order.customerName}</div>}
      {order.customerPhone && <div>Phone: {order.customerPhone}</div>}
      {order.customerEmail && <div>Email: {order.customerEmail}</div>}
      {order.orderType === "delivery" && order.deliveryAddress && (
        <div>Deliver to: {formatAddress(order.deliveryAddress)}</div>
      )}
      <hr style={{ borderTop: "1px dashed #000" }} />
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Item</th>
            <th style={{ textAlign: "right" }}>Qty</th>
            <th style={{ textAlign: "right" }}>Rate</th>
            <th style={{ textAlign: "right" }}>Amt</th>
          </tr>
        </thead>
        <tbody>
          {(order.items || []).map((item, i) => (
            <tr key={i}>
              <td>
                {item.name}
                {item.modifiers?.length > 0 ? ` (${item.modifiers.map(m => m.option).join(", ")})` : ""}
                {item.notes ? ` [${item.notes}]` : ""}
              </td>
              <td style={{ textAlign: "right" }}>{item.qty}</td>
              <td style={{ textAlign: "right" }}>{money(item.price)}</td>
              <td style={{ textAlign: "right" }}>{money(item.price * item.qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr style={{ borderTop: "1px dashed #000" }} />
      <div style={printRow("flex", {}, true)}><span>Subtotal</span><span>{money(order.subtotal)}</span></div>
      {hasDiscount && (
        <div style={printRow("flex", {}, true)}><span>Discount{order.couponCode ? ` (${order.couponCode})` : ""}</span><span>-{money(order.discount)}</span></div>
      )}
      {hasTax && taxBreakdown > 0 && (
        <>
          {cgst > 0 && <div style={printRow("flex", {}, true)}><span>  CGST</span><span>{money(cgst)}</span></div>}
          {sgst > 0 && <div style={printRow("flex", {}, true)}><span>  SGST</span><span>{money(sgst)}</span></div>}
          {igst > 0 && <div style={printRow("flex", {}, true)}><span>  IGST</span><span>{money(igst)}</span></div>}
        </>
      )}
      {hasTax && taxBreakdown === 0 && <div style={printRow("flex", {}, true)}><span>Tax</span><span>{money(taxTotal)}</span></div>}
      {hasServiceCharge && <div style={printRow("flex", {}, true)}><span>Service Charge</span><span>{money(order.serviceCharge)}</span></div>}
      {hasDeliveryFee && <div style={printRow("flex", {}, true)}><span>Delivery Fee</span><span>{money(order.deliveryFee)}</span></div>}
      {hasLoyalty && <div style={printRow("flex", {}, true)}><span>Loyalty Used</span><span>{order.loyaltyPointsUsed} pts</span></div>}
      <div style={{ ...printRow("flex", {}, true), fontWeight: 700, borderTop: "1px solid #000", paddingTop: 4, marginTop: 4 }}>
        <span>TOTAL</span><span>{money(order.total)}</span>
      </div>
      <hr style={{ borderTop: "1px dashed #000" }} />
      <div>Payment: {order.paymentMethod} / {order.paymentStatus}</div>
      {order.paidAt && <div>Paid: {new Date(order.paidAt).toLocaleString()}</div>}
      {order.completedAt && <div>Completed: {new Date(order.completedAt).toLocaleString()}</div>}
      {order.notes && <div style={{ marginTop: 4 }}>Notes: {order.notes}</div>}
      <div style={{ textAlign: "center", marginTop: 8 }}>Thank You</div>
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
  const [selectedTable, setSelectedTable] = useState(null);

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
  const [kitchenOrders, setKitchenOrders] = useState([]);
  const [kitchenFilter, setKitchenFilter] = useState("active");
  const [lastOrder, setLastOrder] = useState(null);
  const [printOrder, setPrintOrder] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const notificationAudioRef = useRef(null);
  const razorpayLoadedRef = useRef(false);

  useEffect(() => {
    notificationAudioRef.current = new Audio("/notification.mp3");
  }, []);

  const loadRazorpayScript = () => {
    return new Promise((resolve) => {
      if (razorpayLoadedRef.current) {
        resolve(true);
        return;
      }
      if (window.Razorpay) {
        razorpayLoadedRef.current = true;
        resolve(true);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => {
        razorpayLoadedRef.current = true;
        resolve(true);
      };
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const openRazorpayCheckout = async (createdOrder) => {
    const scriptLoaded = await loadRazorpayScript();
    if (!scriptLoaded) {
      alert("Razorpay SDK failed to load");
      return false;
    }

    try {
      const paymentRes = await paymentAPI.createRazorpayOrder(createdOrder._id);
      if (!paymentRes.data.success) {
        alert(paymentRes.data.message || "Failed to create Razorpay order");
        return false;
      }

      return await new Promise((resolve) => {
        const options = {
          key: paymentRes.data.key,
          amount: paymentRes.data.amount,
          currency: paymentRes.data.currency,
          name: posSettings?.restaurant_name || "Restaurant",
          description: `Order Payment - ${createdOrder.orderNumber}`,
          order_id: paymentRes.data.razorpayOrderId,
          prefill: {
            name: paymentRes.data.customerName || customerName,
            contact: paymentRes.data.phone || customerPhone,
            email: paymentRes.data.email || "",
          },
          notes: {
            appOrderId: createdOrder._id,
          },
          theme: {
            color: "#0f766e",
          },
          handler: async function (response) {
            try {
              const verifyRes = await paymentAPI.verifyRazorpayPayment({
                orderId: createdOrder._id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              });

              if (verifyRes.data.success) {
                const verifiedOrder = verifyRes.data.order || createdOrder;
                setLastOrder(verifiedOrder);
                fetchOrders(false);
                if (isKitchen || hasRole(["admin"])) fetchKitchenOrders();
                alert("Payment successful");
                resolve(true);
              } else {
                alert(verifyRes.data.message || "Payment verification failed");
                resolve(false);
              }
            } catch (error) {
              console.log("VERIFY PAYMENT ERROR:", error);
              alert("Payment verification failed");
              resolve(false);
            }
          },
          modal: {
            ondismiss: function () {
              resolve(false);
            },
          },
        };

        const razorpayInstance = new window.Razorpay(options);
        razorpayInstance.on("payment.failed", function (response) {
          console.log("RAZORPAY PAYMENT FAILED:", response.error);
          alert(response.error.description || "Payment failed");
          resolve(false);
        });
        razorpayInstance.open();
      });
    } catch (error) {
      console.log("RAZORPAY CHECKOUT ERROR:", error);
      alert("Unable to start online payment");
      return false;
    }
  };

  const playNotificationSound = () => {
    if (!soundEnabled || !notificationAudioRef.current) return;
    notificationAudioRef.current.currentTime = 0;
    notificationAudioRef.current.play().catch(() => {});
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
    if (isKitchen || hasRole(["admin"])) fetchKitchenOrders();
  }, []);

  useEffect(() => {
    const clearPrint = () => setPrintOrder(null);
    window.addEventListener("afterprint", clearPrint);
    return () => window.removeEventListener("afterprint", clearPrint);
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
    if (selectedCategory === "All") return menuItems;
    return menuItems.filter(item => item.category?.name === selectedCategory);
  }, [menuItems, selectedCategory]);

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
      };

      const res = await orderAPI.create(orderData);
      
      if (res.data.success) {
        const createdOrder = res.data.order;
        
        if (paymentMethod === "upi") {
          const paymentSuccess = await openRazorpayCheckout(createdOrder);
          if (!paymentSuccess) {
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
        }

        if (selectedTable) {
          const table = tables.find(t => t._id === selectedTable._id);
          if (table) {
            setTables(prev => prev.map(t => t._id === table._id ? { ...t, status: "occupied", currentOrder: createdOrder._id } : t));
          }
        }

        setLastOrder(createdOrder);
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

  const handlePrint = (order, type) => {
    setPrintOrder({ type, order });
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
          <label className="sound-toggle">
            <input type="checkbox" checked={soundEnabled} onChange={(e) => setSoundEnabled(e.target.checked)} />
            <span className="sound-toggle-switch"></span>
            Sound
          </label>
        </div>
      </div>

      {error && <div className="toast error">{error}</div>}

      {activeTab === "pos" && isAdminOrCashier && (
        <div className="pos-layout">
          <aside className="pos-sidebar">
            <div className="pos-sidebar-header">
              <h3>Menu</h3>
              <span className="pos-menu-count">{filteredMenuItems.length} items</span>
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
                  <h3 className="empty-state-title">No items</h3>
                  <p className="empty-state-description">No menu items in this category.</p>
                </div>
              ) : (
                <div className="menu-grid">
                  {filteredMenuItems.map(item => (
                    <button key={item._id} className="menu-item-card" onClick={() => addToCart(item)}>
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

            <div className="customer-section">
              <h4>Customer</h4>
              <div className="input-row">
                <input
                  type="text"
                  placeholder="Customer Name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
                <input
                  type="tel"
                  placeholder="Phone"
                  value={customerPhone}
                  onChange={(e) => {
                    setCustomerPhone(e.target.value);
                    handleCustomerSearch(e.target.value);
                  }}
                />
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
                  <p className="customer-name">{order.customerName}</p>
                  <div className="ticket-items">
                    {order.items.map((item, i) => (
                      <div key={i} className="ticket-item">
                        <span className="qty">{item.qty}×</span>
                        <span className="item-name">{item.name}</span>
                        {item.modifiers?.length > 0 && <span className="item-note">{item.modifiers.map(m => m.option).join(", ")}</span>}
                      </div>
                    ))}
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
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.slice(0, 20).map(order => (
                  <Fragment key={order._id}>
                    <tr
                      id={`order-row-${order._id}`}
                      className={order._id === highlightedOrderId ? "order-row-highlight" : ""}
                      onClick={() => setExpandedOrderId(expandedOrderId === order._id ? null : order._id)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>{order.orderNumber}</td>
                      <td>{order.customerName}</td>
                      <td>{order.orderType}</td>
                      <td>{order.tableNo || "-"}</td>
                      <td><span className={`status-badge ${order.orderStatus}`}>{order.orderStatus}</span></td>
                      <td>{order.paymentMethod}</td>
                      <td>{formatCurrency(order.total)}</td>
                      <td>{new Date(order.createdAt).toLocaleString()}</td>
                      <td onClick={(e) => e.stopPropagation()}>{renderOrderActions(order)}</td>
                    </tr>
                    {expandedOrderId === order._id && (
                      <tr className="order-details-row">
                        <td colSpan={9}>
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
                                <span className="order-note-text">{formatAddress(order.deliveryAddress)}</span>
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
              {lastOrder.items.map((item, i) => (
                <div key={i} className="receipt-item">
                  <span>{item.qty}× {item.name}</span>
                  <span>{formatCurrency(item.price * item.qty)}</span>
                </div>
              ))}
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
                #root { display: none !important; }
                body { background: #fff !important; margin: 0 !important; }
                .print-area { display: block !important; width: 72mm; margin: 0 auto; padding: 0; }
              }
            `}</style>
            <div className="print-area">
              {printOrder.type === "kot" ? (
                <KOTReceipt order={printOrder.order} />
              ) : (
                <InvoiceReceipt
                  order={printOrder.order}
                  restaurantName={posSettings?.restaurant_name || ""}
                  restaurantAddress={posSettings?.restaurant_address || ""}
                  restaurantPhone={posSettings?.restaurant_phone || ""}
                />
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}