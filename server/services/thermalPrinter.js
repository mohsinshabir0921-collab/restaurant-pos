const TP = require("node-thermal-printer");
const Settings = require("../models/Settings");

const DEFAULT_PORT = 9100;
const CONNECT_TIMEOUT = 5000;
const COLS = 42;
const ITEM_W = 17;
const QTY_W = 4;
const RATE_W = 9;
const AMT_W = 9;

// ---------------------------------------------------------------------------
// Text sanitisation: ESC/POS code pages do not support the Rupee glyph or many
// Unicode symbols, so map the common ones and strip anything non-ASCII.
// ---------------------------------------------------------------------------
function sanitize(text) {
  if (text == null) return "";
  let s = String(text);
  const map = {
    "₹": "Rs.", "₨": "Rs.",
    "•": "*", "·": "*", "–": "-", "—": "-", "−": "-",
    "“": '"', "”": '"', "‘": "'", "’": "'",
    "…": "...", "™": "(TM)", "®": "(R)",
  };
  for (const k in map) s = s.split(k).join(map[k]);
  return s.replace(/[^\x20-\x7E]/g, "");
}

const money = (v) => "Rs." + Number(v || 0).toLocaleString("en-IN");

function numberToWords(num) {
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
}

function formatAddress(addr) {
  if (!addr) return "";
  const parts = [];
  if (addr.line1) parts.push(addr.line1);
  if (addr.line2) parts.push(addr.line2);
  if (addr.landmark) parts.push("Landmark: " + addr.landmark);
  const cityState = [addr.city, addr.state].filter(Boolean).join(", ");
  if (cityState) parts.push(cityState);
  if (addr.pincode) parts.push("Pin: " + addr.pincode);
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Order item helpers (mirror client/src/utils/orderItem.js)
// ---------------------------------------------------------------------------
function getSize(item) {
  if (item && item.size && String(item.size).trim()) return String(item.size).trim();
  const mods = (item && item.modifiers) || [];
  const m = mods.find((x) => x && /size|variant/i.test(x.name || ""));
  return m && m.option ? m.option : "";
}

function getAddons(item) {
  const mods = (item && item.modifiers) || [];
  return mods
    .filter((x) => x && x.option && !/size|variant/i.test(x.name || ""))
    .map((x) => x.option);
}

// ---------------------------------------------------------------------------
// Column / wrapping helpers for 80mm fixed layout
// ---------------------------------------------------------------------------
function padRight(str, len) {
  str = sanitize(str);
  if (str.length > len) str = str.slice(0, len);
  return str + " ".repeat(len - str.length);
}
function padLeft(str, len) {
  str = sanitize(str);
  if (str.length > len) str = str.slice(0, len);
  return " ".repeat(len - str.length) + str;
}
function wrapText(text, width) {
  const words = sanitize(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= width) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

// ---------------------------------------------------------------------------
// Destination parsing + private-network validation
// ---------------------------------------------------------------------------
function isPrivateIPv4(host) {
  if (host === "localhost" || host === "127.0.0.1") return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const p = m.slice(1).map(Number);
  if (p.some((n) => n > 255)) return false;
  if (p[0] === 10) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 127) return true;
  return false;
}

function parsePrinterTarget(portString) {
  if (!portString || !String(portString).trim()) return null;
  let s = String(portString).trim().replace(/^tcp:\/\//i, "").replace(/^\/+/, "");
  let host, port;
  if (s.includes(":")) {
    const idx = s.lastIndexOf(":");
    host = s.slice(0, idx);
    port = parseInt(s.slice(idx + 1), 10);
  } else {
    host = s;
    port = DEFAULT_PORT;
  }
  if (!host) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!isPrivateIPv4(host)) return null;
  return { host, port };
}

// ---------------------------------------------------------------------------
// Settings loading
// ---------------------------------------------------------------------------
async function loadPrintSettings() {
  const keys = [
    "thermal_printer_enabled", "thermal_printer_port",
    "restaurant_name", "restaurant_address", "restaurant_phone", "gstin",
    "receipt_header", "receipt_footer",
  ];
  const docs = await Settings.find({ key: { $in: keys } }).lean();
  const map = {};
  docs.forEach((d) => { map[d.key] = d.value; });
  return map;
}

async function getThermalTarget() {
  const s = await loadPrintSettings();
  if (!s.thermal_printer_enabled) return null;
  return parsePrinterTarget(s.thermal_printer_port);
}

function createPrinter(target) {
  return new TP.printer({
    type: TP.printerTypes.EPSON,
    interface: `tcp://${target.host}:${target.port}`,
    options: { timeout: CONNECT_TIMEOUT },
    removeSpecialCharacters: true,
    lineCharacter: "-",
  });
}

// ---------------------------------------------------------------------------
// KOT (Kitchen Order Ticket)
// ---------------------------------------------------------------------------
async function printKOT(order) {
  const target = await getThermalTarget();
  if (!target) throw new Error("Thermal printer not configured (enable it and set a valid LAN IP, e.g. 192.168.1.50)");
  const printer = createPrinter(target);
  const o = order || {};

  printer.alignCenter();
  printer.bold(true);
  printer.println("KITCHEN ORDER TICKET");
  printer.bold(false);
  printer.println("#" + (o.orderNumber || o._id || ""));
  printer.println((o.orderType || "").toUpperCase() || "ORDER");
  if (o.orderType === "dinein") {
    printer.println("Table: " + (o.tableNo || (o.table && o.table.number) || "-"));
    printer.println("Waiter: " + (o.servedBy && o.servedBy.name ? o.servedBy.name : "-"));
  }
  printer.println(new Date(o.createdAt).toLocaleString("en-IN"));
  printer.alignLeft();
  printer.drawLine();

  (o.items || []).forEach((item) => {
    const size = getSize(item);
    const addons = getAddons(item);
    printer.bold(true);
    printer.println(item.qty + " x " + item.name);
    printer.bold(false);
    if (size) printer.println("  Size: " + size);
    if (addons.length) printer.println("  Add-ons: " + addons.join(", "));
    if (item.notes) printer.println("  Note: " + item.notes);
  });

  printer.drawLine();
  printer.println("Status: " + (o.orderStatus || "-"));
  printer.println("*** END KOT ***");
  printer.cut();
  await printer.execute();
  printer.clear();
}

// ---------------------------------------------------------------------------
// Customer Invoice / Receipt
// ---------------------------------------------------------------------------
async function printInvoice(order) {
  const target = await getThermalTarget();
  if (!target) throw new Error("Thermal printer not configured (enable it and set a valid LAN IP, e.g. 192.168.1.50)");
  const s = await loadPrintSettings();
  const printer = createPrinter(target);
  const o = order || {};

  printer.alignCenter();
  printer.bold(true);
  printer.println(sanitize(s.restaurant_name || "Restaurant"));
  printer.bold(false);
  if (s.restaurant_address) printer.println(sanitize(s.restaurant_address));
  if (s.restaurant_phone) printer.println("Ph: " + sanitize(s.restaurant_phone));
  if (s.gstin) printer.println("GSTIN: " + sanitize(s.gstin));
  if (s.receipt_header) printer.println(sanitize(s.receipt_header));
  printer.alignLeft();
  printer.drawLine();

  printer.println("TAX INVOICE");
  printer.println("Bill No: " + (o.orderNumber || o._id || ""));
  printer.println("Date: " + new Date(o.createdAt).toLocaleString("en-IN"));
  printer.drawLine();

  printer.println("Type: " + (o.orderType || "").toUpperCase());
  if (o.orderType === "dinein") {
    printer.println("Table: " + (o.tableNo || (o.table && o.table.number) || "-"));
    printer.println("Waiter: " + (o.servedBy && o.servedBy.name ? o.servedBy.name : "-"));
  }
  if (o.orderType === "takeaway" && o.pickupAt) {
    printer.println("Pickup: " + new Date(o.pickupAt).toLocaleString("en-IN"));
  }
  if (o.customerName) printer.println("Customer: " + sanitize(o.customerName));
  if (o.customerPhone) printer.println("Phone: " + sanitize(o.customerPhone));
  if (o.orderType === "delivery" && o.deliveryAddress) {
    printer.println("Deliver To:");
    printer.println("  " + sanitize(formatAddress(o.deliveryAddress)));
    if (o.deliveryAddress.distanceKm != null) {
      printer.println("  Distance: " + o.deliveryAddress.distanceKm + " km");
    }
  }
  printer.drawLine();

  printer.println(
    padRight("Item", ITEM_W) + " " +
    padLeft("Qty", QTY_W) + " " +
    padLeft("Rate", RATE_W) + " " +
    padLeft("Amt", AMT_W)
  );
  (o.items || []).forEach((item) => {
    const rate = Number(item.price || 0);
    const amt = rate * Number(item.qty || 0);
    const nameLines = wrapText(item.name, ITEM_W);
    printer.println(
      padRight(nameLines[0], ITEM_W) + " " +
      padLeft(String(item.qty), QTY_W) + " " +
      padLeft(money(rate), RATE_W) + " " +
      padLeft(money(amt), AMT_W)
    );
    for (let i = 1; i < nameLines.length; i++) {
      printer.println(padRight(nameLines[i], ITEM_W));
    }
    const size = getSize(item);
    const addons = getAddons(item);
    if (size) printer.println("  Size: " + size);
    if (addons.length) printer.println("  Add-ons: " + addons.join(", "));
    if (item.notes) printer.println("  Note: " + item.notes);
  });
  printer.drawLine();

  const cgst = Number(o.cgst || 0);
  const sgst = Number(o.sgst || 0);
  const igst = Number(o.igst || 0);
  const taxTotal = Number(o.tax ?? (cgst + sgst + igst));
  const hasLoyalty = Number(o.loyaltyPointsUsed) > 0;

  printer.println(padRight("Subtotal", COLS - AMT_W - 1) + " " + padLeft(money(o.subtotal), AMT_W));
  if (Number(o.discount) > 0 || o.couponCode) {
    printer.println(padRight("Discount" + (o.couponCode ? " (" + o.couponCode + ")" : ""), COLS - AMT_W - 1) + " " + padLeft("-" + money(o.discount), AMT_W));
  }
  if (cgst > 0) printer.println(padRight("CGST", COLS - AMT_W - 1) + " " + padLeft(money(cgst), AMT_W));
  if (sgst > 0) printer.println(padRight("SGST", COLS - AMT_W - 1) + " " + padLeft(money(sgst), AMT_W));
  if (igst > 0) printer.println(padRight("IGST", COLS - AMT_W - 1) + " " + padLeft(money(igst), AMT_W));
  if (!cgst && !sgst && !igst && taxTotal > 0) {
    printer.println(padRight("Tax", COLS - AMT_W - 1) + " " + padLeft(money(taxTotal), AMT_W));
  }
  if (Number(o.serviceCharge) > 0) {
    printer.println(padRight("Service Charge", COLS - AMT_W - 1) + " " + padLeft(money(o.serviceCharge), AMT_W));
  }
  if (Number(o.deliveryFee) > 0) {
    printer.println(padRight("Delivery Charge", COLS - AMT_W - 1) + " " + padLeft(money(o.deliveryFee), AMT_W));
  }
  if (hasLoyalty) {
    printer.println(padRight("Loyalty Used", COLS - AMT_W - 1) + " " + padLeft(String(o.loyaltyPointsUsed) + " pts", AMT_W));
  }

  printer.bold(true);
  printer.println(padRight("GRAND TOTAL", COLS - AMT_W - 1) + " " + padLeft(money(o.total), AMT_W));
  printer.bold(false);
  printer.drawLine();

  printer.println("Payment Mode: " + (o.paymentMethod || "-"));
  printer.println("Payment Status: " + (o.paymentStatus || "-"));
  printer.drawLine();

  printer.println("Amt in words: " + sanitize(numberToWords(Number(o.total || 0))));
  const footer = s.receipt_footer || "Thank You, Visit Us Again!";
  printer.println(sanitize(footer));
  printer.cut();
  await printer.execute();
  printer.clear();
}

// ---------------------------------------------------------------------------
// Test receipt (no order required)
// ---------------------------------------------------------------------------
async function printTest() {
  const target = await getThermalTarget();
  if (!target) throw new Error("Thermal printer not configured (enable it and set a valid LAN IP, e.g. 192.168.1.50)");
  const printer = createPrinter(target);
  printer.alignCenter();
  printer.bold(true);
  printer.println("PRINTER TEST");
  printer.bold(false);
  printer.println(new Date().toLocaleString("en-IN"));
  printer.drawLine();
  printer.println("This is a test receipt.");
  printer.println("If this printed correctly,");
  printer.println("thermal printing works.");
  printer.println("Host: " + target.host + ":" + target.port);
  printer.drawLine();
  printer.println(padRight("Item", ITEM_W) + " " + padLeft("Qty", QTY_W) + " " + padLeft("Rate", RATE_W) + " " + padLeft("Amt", AMT_W));
  printer.println(padRight("Masala Dosa", ITEM_W) + " " + padLeft("2", QTY_W) + " " + padLeft(money(80), RATE_W) + " " + padLeft(money(160), AMT_W));
  printer.drawLine();
  printer.bold(true);
  printer.println(padRight("GRAND TOTAL", COLS - AMT_W - 1) + " " + padLeft(money(160), AMT_W));
  printer.bold(false);
  printer.println("*** END TEST ***");
  printer.cut();
  await printer.execute();
  printer.clear();
}

module.exports = {
  parsePrinterTarget,
  isPrivateIPv4,
  getThermalTarget,
  printKOT,
  printInvoice,
  printTest,
};
