// Canonical menu definitions + helpers shared by seedMenu.js, inspectMenuDeps.js
// and migrateMenuSafe.js. This module ONLY exports data and pure helpers.
// It never connects to the database and never performs any writes.

// Categories are preserved from the previous menu (no new categories invented).
const categories = [
  { name: "Starters & Snacks", displayOrder: 1, description: "Appetizers and light bites", isActive: true },
  { name: "Breads", displayOrder: 2, description: "Indian breads and rotis", isActive: true },
  { name: "Non-Veg Starters", displayOrder: 3, description: "Non-vegetarian appetizers", isActive: true },
  { name: "Veg Starters", displayOrder: 4, description: "Vegetarian appetizers", isActive: true },
  { name: "Cold Beverages", displayOrder: 5, description: "Refreshing cold drinks", isActive: true },
  { name: "Rice & Biryani", displayOrder: 6, description: "Rice dishes and biryanis", isActive: true },
  { name: "Non-Veg Pizzas", displayOrder: 7, description: "Non-vegetarian pizzas", isActive: true },
  { name: "Veg Pizzas", displayOrder: 8, description: "Vegetarian pizzas", isActive: true },
  { name: "Pizza Extras", displayOrder: 9, description: "Pizza toppings and extras", isActive: true },
  { name: "Non-Veg Curries", displayOrder: 10, description: "Non-vegetarian curries", isActive: true },
  { name: "Veg Curries", displayOrder: 11, description: "Vegetarian curries", isActive: true },
  { name: "Sauces & Sides", displayOrder: 12, description: "Dipping sauces and sides", isActive: true },
  { name: "Hot Beverages", displayOrder: 13, description: "Hot tea and coffee", isActive: true },
];

// Default prep time per category (PDF does not specify; sensible defaults only).
const PREP = {
  "Starters & Snacks": 15,
  Breads: 5,
  "Non-Veg Starters": 15,
  "Veg Starters": 15,
  "Cold Beverages": 3,
  "Rice & Biryani": 25,
  "Non-Veg Pizzas": 20,
  "Veg Pizzas": 20,
  "Pizza Extras": 2,
  "Non-Veg Curries": 25,
  "Veg Curries": 15,
  "Sauces & Sides": 1,
  "Hot Beverages": 3,
};

// Helper to build a Half/Full size modifier from absolute prices.
const hf = (half, full) => [
  { label: "Half", price: half },
  { label: "Full", price: full },
];
// Helper to build Regular/Medium/Large (2-size) modifier.
const rl = (regular, large) => [
  { label: "Regular", price: regular },
  { label: "Large", price: large },
];
// Helper to build Regular/Medium/Large/XL (4-size) modifier.
const rmlxl = (r, m, l, xl) => [
  { label: "Regular", price: r },
  { label: "Medium", price: m },
  { label: "Large", price: l },
  { label: "XL", price: xl },
];

// menuItems use `category` as the category NAME. `sizes` (optional) holds absolute
// prices; the first size is the base price. Sizes become a required "Size" modifier
// whose option prices are deltas from the base (handled by buildSizeModifier).
const menuItems = [
  // ---------------- Starters & Snacks ----------------
  { name: "Honey Chilli Potato", category: "Starters & Snacks", isVeg: true, price: 220 },
  { name: "Veg Chowmein", category: "Starters & Snacks", isVeg: true, price: 180 },
  { name: "Chicken Chowmein", category: "Starters & Snacks", isVeg: false, price: 200 },
  { name: "Chilli Chicken", category: "Starters & Snacks", isVeg: false, price: 320, sizes: hf(320, 550) },
  { name: "Honey Chilli Chicken", category: "Starters & Snacks", isVeg: false, price: 350, sizes: hf(350, 570) },
  { name: "Schezwan Chicken", category: "Starters & Snacks", isVeg: false, price: 350 },
  { name: "Chilli Paneer", category: "Starters & Snacks", isVeg: true, price: 350 },
  { name: "Tandoori Chicken", category: "Starters & Snacks", isVeg: false, price: 320, sizes: hf(320, 550) },
  { name: "Plain Salad", category: "Starters & Snacks", isVeg: true, price: 30 },
  { name: "Green Salad", category: "Starters & Snacks", isVeg: true, price: 50 },
  { name: "Finger Salad", category: "Starters & Snacks", isVeg: true, price: 70 },
  { name: "White Sauce Pasta", category: "Starters & Snacks", isVeg: true, price: 270, sizes: rl(270, 300) },
  { name: "Pink Sauce Pasta", category: "Starters & Snacks", isVeg: true, price: 280, sizes: rl(280, 320) },
  { name: "Chicken Momos Steamed", category: "Starters & Snacks", isVeg: false, price: 120 },
  { name: "Chicken Momos Fried", category: "Starters & Snacks", isVeg: false, price: 120 },
  { name: "Chicken Momos Kfc", category: "Starters & Snacks", isVeg: false, price: 160 },
  { name: "Malai Momos", category: "Starters & Snacks", isVeg: true, price: 200 },
  { name: "Tandoori Momos", category: "Starters & Snacks", isVeg: true, price: 200 },
  { name: "Chicken wrap", category: "Starters & Snacks", isVeg: false, price: 130 },

  // ---------------- Breads ----------------
  { name: "Plain Naan", category: "Breads", isVeg: true, price: 30 },
  { name: "Butter Naan", category: "Breads", isVeg: true, price: 40 },
  { name: "Rumali Roti", category: "Breads", isVeg: true, price: 30 },
  { name: "Tawa Roti", category: "Breads", isVeg: true, price: 20 },

  // ---------------- Non-Veg Starters ----------------
  { name: "Chicken Nuggets", category: "Non-Veg Starters", isVeg: false, price: 350, sizes: hf(350, 600) },
  { name: "Chicken Fingers", category: "Non-Veg Starters", isVeg: false, price: 350, sizes: hf(350, 600) },

  // ---------------- Veg Starters ----------------
  { name: "Crispy Paneer", category: "Veg Starters", isVeg: true, price: 350 },
  { name: "Crispy Corn", category: "Veg Starters", isVeg: true, price: 250 },

  // ---------------- Cold Beverages ----------------
  { name: "Virgin Mojito", category: "Cold Beverages", isVeg: true, price: 120 },
  { name: "Blue Curacao", category: "Cold Beverages", isVeg: true, price: 120 },
  { name: "Fresh Lime Soda", category: "Cold Beverages", isVeg: true, price: 110 },
  { name: "Deep Sea Blue", category: "Cold Beverages", isVeg: true, price: 130 },
  { name: "Green Apple", category: "Cold Beverages", isVeg: true, price: 130 },

  // ---------------- Rice & Biryani ----------------
  { name: "Chicken Biryani", category: "Rice & Biryani", isVeg: false, price: 120, sizes: hf(120, 240) },
  { name: "Veg fried rice", category: "Rice & Biryani", isVeg: true, price: 150, sizes: hf(150, 250) },
  { name: "Schezwan veg Fried rice", category: "Rice & Biryani", isVeg: true, price: 170, sizes: hf(170, 270) },
  { name: "Chicken Fried rice", category: "Rice & Biryani", isVeg: false, price: 170, sizes: hf(170, 280) },
  { name: "Schezwan Chicken Fried rice", category: "Rice & Biryani", isVeg: false, price: 190, sizes: hf(190, 300) },
  { name: "Chicken Pulav", category: "Rice & Biryani", isVeg: false, price: 180, sizes: hf(180, 280) },
  { name: "Veg pulav", category: "Rice & Biryani", isVeg: true, price: 170, sizes: hf(170, 260) },
  { name: "Plain Rice", category: "Rice & Biryani", isVeg: true, price: 120 },
  { name: "Zeera Rice", category: "Rice & Biryani", isVeg: true, price: 150 },

  // ---------------- Non-Veg Pizzas ----------------
  { name: "Roasted Chicken Pizza", category: "Non-Veg Pizzas", isVeg: false, price: 240, description: "Non-Spicy Roasted Chicken", sizes: rmlxl(240, 320, 480, 580) },
  { name: "Chicken Blast", category: "Non-Veg Pizzas", isVeg: false, price: 200, description: "Spicy Hot Chicken", sizes: rmlxl(200, 300, 450, 570) },
  { name: "BBQ", category: "Non-Veg Pizzas", isVeg: false, price: 220, description: "BBQ Chicken Marinade + Onion + Coriander", sizes: rmlxl(220, 300, 450, 550) },
  { name: "Maxican Bite", category: "Non-Veg Pizzas", isVeg: false, price: 250, description: "Hot Chicken + Mushroom + Capsicum", sizes: rmlxl(250, 350, 490, 600) },
  { name: "Peri Peri", category: "Non-Veg Pizzas", isVeg: false, price: 250, description: "Marinated chicken in peri peri sauce", sizes: rmlxl(250, 350, 490, 600) },
  { name: "Butter Chicken", category: "Non-Veg Pizzas", isVeg: false, price: 270, description: "Cooked Chicken in Makhni Sauce + Coriander", sizes: rmlxl(270, 370, 500, 630) },
  { name: "Golden Delight", category: "Non-Veg Pizzas", isVeg: false, price: 270, description: "Roasted Chicken + Corn + Coriander", sizes: rmlxl(270, 370, 500, 650) },
  { name: "Khyenn Chyenn Special", category: "Non-Veg Pizzas", isVeg: false, price: 270, description: "Roasted Chicken + Hot Chicken + Butter Chicken + Bell Pepper", sizes: rmlxl(270, 350, 500, 650) },
  { name: "Chicken Tikka Pizza", category: "Non-Veg Pizzas", isVeg: false, price: 250, description: "Topped with Chicken Tikka Cubes", sizes: rmlxl(250, 330, 470, 570) },

  // ---------------- Veg Pizzas ----------------
  { name: "Tomato Paneer", category: "Veg Pizzas", isVeg: true, price: 300 },
  { name: "Paneer Butter Masala", category: "Veg Pizzas", isVeg: true, price: 360 },
  { name: "Kadhai Paneer", category: "Veg Pizzas", isVeg: true, price: 350 },
  { name: "Mattar Paneer", category: "Veg Pizzas", isVeg: true, price: 360 },
  { name: "Paneer Curry", category: "Veg Pizzas", isVeg: true, price: 340 },
  { name: "Mattar Mushroom", category: "Veg Pizzas", isVeg: true, price: 350 },
  { name: "Classic Cheese", category: "Veg Pizzas", isVeg: true, price: 200, description: "3 Types Of Cheese + Origano + Basil", sizes: rmlxl(200, 280, 430, 520) },
  { name: "Kids Favourite", category: "Veg Pizzas", isVeg: true, price: 220, description: "American Corn + Sweet Corn", sizes: rmlxl(220, 300, 450, 530) },
  { name: "Margarita", category: "Veg Pizzas", isVeg: true, price: 220, description: "Tomato Slices + Origano", sizes: rmlxl(220, 300, 450, 530) },
  { name: "Schezwan Veggie", category: "Veg Pizzas", isVeg: true, price: 230, description: "Onion + Capsicum, tossed with schezwan sauce", sizes: rmlxl(230, 310, 470, 540) },
  { name: "Khyenn Chyenn Special (Veg)", category: "Veg Pizzas", isVeg: true, price: 280, description: "Full Loaded With Veggies", sizes: rmlxl(280, 370, 500, 650) },
  { name: "Owner Special", category: "Veg Pizzas", isVeg: true, price: 220, description: "Onion + Mushroom + Capsicum + Sweet Corn + Black Olives", sizes: rmlxl(220, 350, 480, 580) },
  { name: "Spicy Paneer Pizza", category: "Veg Pizzas", isVeg: true, price: 240, description: "Marinated Spicy Paneer", sizes: rmlxl(240, 350, 500, 600) },
  { name: "Margarita Delux", category: "Veg Pizzas", isVeg: true, price: 240, description: "Baby Corn Mushroom + Onion + Basil + Origano", sizes: rmlxl(240, 370, 520, 580) },

  // ---------------- Pizza Extras ----------------
  { name: "Toppings", category: "Pizza Extras", isVeg: true, price: 30, sizes: rmlxl(30, 50, 80, 100) },
  { name: "Cheese", category: "Pizza Extras", isVeg: true, price: 30, sizes: rmlxl(30, 50, 80, 100) },
  { name: "Cheese Burst", category: "Pizza Extras", isVeg: true, price: 30, sizes: rmlxl(30, 50, 80, 100) },

  // ---------------- Non-Veg Curries ----------------
  { name: "Chicken Kanti", category: "Non-Veg Curries", isVeg: false, price: 320, sizes: hf(320, 580) },
  { name: "Butter Chicken Boneless", category: "Non-Veg Curries", isVeg: false, price: 330, sizes: hf(330, 600) },
  { name: "Butter Chicken WithBone", category: "Non-Veg Curries", isVeg: false, price: 430, sizes: hf(430, 680) },
  { name: "Chicken Curry", category: "Non-Veg Curries", isVeg: false, price: 370, sizes: hf(370, 550) },
  { name: "Masala Chicken", category: "Non-Veg Curries", isVeg: false, price: 380, sizes: hf(380, 570) },
  { name: "Kadhai Chicken", category: "Non-Veg Curries", isVeg: false, price: 380, sizes: hf(380, 570) },
  { name: "Wazwan Chicken", category: "Non-Veg Curries", isVeg: false, price: 350, sizes: hf(350, 560) },

  // ---------------- Veg Curries ----------------
  { name: "Onion Gravy", category: "Veg Curries", isVeg: true, price: 60, sizes: hf(60, 100) },

  // ---------------- Sauces & Sides ----------------
  { name: "Hot Sauce", category: "Sauces & Sides", isVeg: true, price: 10 },
  { name: "Mayonnaise", category: "Sauces & Sides", isVeg: true, price: 10 },
  { name: "Raita", category: "Sauces & Sides", isVeg: true, price: 10 },
  { name: "Mint Sauce", category: "Sauces & Sides", isVeg: true, price: 10 },
  { name: "Ketchup Dip", category: "Sauces & Sides", isVeg: true, price: 10 },

  // ---------------- Hot Beverages ----------------
  { name: "Coffee", category: "Hot Beverages", isVeg: true, price: 70 },
  { name: "Cappuccino", category: "Hot Beverages", isVeg: true, price: 90 },
  { name: "Lemon tea", category: "Hot Beverages", isVeg: true, price: 40 },
  { name: "Masala Tea", category: "Hot Beverages", isVeg: true, price: 50 },
  { name: "Kashmiri Kehwa", category: "Hot Beverages", isVeg: true, price: 70 },
  { name: "Green tea", category: "Hot Beverages", isVeg: true, price: 50 },
  { name: "Black Coffee", category: "Hot Beverages", isVeg: true, price: 50 },
];

// Build a required "Size" modifier whose option prices are deltas from the base.
function buildSizeModifier(item) {
  if (!item.sizes || item.sizes.length === 0) return [];
  const base = item.sizes[0].price;
  return [
    {
      name: "Size",
      required: true,
      options: item.sizes.map((s, i) => ({
        name: s.label,
        price: s.price - base,
        isDefault: i === 0,
      })),
    },
  ];
}

// Normalize a dish name for matching old -> new across the size-variant rename.
// - lowercases
// - turns parentheticals into spaced inner text: "(Veg)" -> " veg ", "(R)" -> " r "
// - removes ONLY genuine size tokens (whole words): half/full/regular/large/
//   small/medium and the single letters r/m/l/xl/h/f
// - drops the word "pizza" (new veg/non-veg pizza names dropped it, old kept it)
// - normalizes "non-veg"/"non veg" to "nonveg" (keeps veg/non-veg DISTINCT)
// Crucially, the "(Veg)" / inline "Veg" qualifier is PRESERVED so that
// "Khyenn Chyenn Special" and "Khyenn Chyenn Special (Veg)" never collide.
// This is a best-effort key; the dry-run report surfaces any unmatched
// items/recipes so a human can review before anything is written.
function baseName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\(([^)]+)\)/g, " $1 ")
    .replace(/\b(half|full|regular|large|small|medium|r|m|l|xl|h|f)\b/gi, " ")
    .replace(/\bpizza\b/g, " ")
    .replace(/\bnon[-\s]?veg\b/gi, "nonveg")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  categories,
  menuItems,
  PREP,
  hf,
  rl,
  rmlxl,
  buildSizeModifier,
  baseName,
};
