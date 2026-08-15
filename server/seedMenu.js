require("dotenv").config();
const mongoose = require("mongoose");
const Category = require("./models/Category");
const MenuItem = require("./models/MenuItem");

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

const menuItems = [
  { name: "Honey Chilli Potato", price: 220, category: "Starters & Snacks", isVeg: true, prepTime: 15 },
  { name: "Veg Chowmein", price: 180, category: "Starters & Snacks", isVeg: true, prepTime: 15 },
  { name: "Chicken Chowmein", price: 200, category: "Starters & Snacks", isVeg: false, prepTime: 15 },
  { name: "Chilli Chicken (Half)", price: 320, category: "Starters & Snacks", isVeg: false, prepTime: 20 },
  { name: "Chilli Chicken (Full)", price: 550, category: "Starters & Snacks", isVeg: false, prepTime: 20 },
  { name: "Honey Chilli Chicken (Half)", price: 350, category: "Starters & Snacks", isVeg: false, prepTime: 20 },
  { name: "Honey Chilli Chicken (Full)", price: 570, category: "Starters & Snacks", isVeg: false, prepTime: 20 },
  { name: "Schezwan Chicken", price: 350, category: "Starters & Snacks", isVeg: false, prepTime: 20 },
  { name: "Chilli Paneer", price: 350, category: "Starters & Snacks", isVeg: true, prepTime: 20 },
  { name: "Tandoori Chicken (Half)", price: 320, category: "Starters & Snacks", isVeg: false, prepTime: 25 },
  { name: "Tandoori Chicken (Full)", price: 550, category: "Starters & Snacks", isVeg: false, prepTime: 25 },
  { name: "Plain Salad", price: 30, category: "Starters & Snacks", isVeg: true, prepTime: 5 },
  { name: "Green Salad", price: 50, category: "Starters & Snacks", isVeg: true, prepTime: 5 },
  { name: "Finger Salad", price: 70, category: "Starters & Snacks", isVeg: true, prepTime: 5 },
  { name: "White Sauce Pasta (Regular)", price: 270, category: "Starters & Snacks", isVeg: true, prepTime: 20 },
  { name: "White Sauce Pasta (Large)", price: 300, category: "Starters & Snacks", isVeg: true, prepTime: 20 },
  { name: "Pink Sauce Pasta (Regular)", price: 280, category: "Starters & Snacks", isVeg: true, prepTime: 20 },
  { name: "Pink Sauce Pasta (Large)", price: 320, category: "Starters & Snacks", isVeg: true, prepTime: 20 },
  { name: "Chicken Momos Steamed", price: 120, category: "Starters & Snacks", isVeg: false, prepTime: 15 },
  { name: "Chicken Momos Fried", price: 120, category: "Starters & Snacks", isVeg: false, prepTime: 15 },
  { name: "Chicken Momos KFC", price: 160, category: "Starters & Snacks", isVeg: false, prepTime: 15 },
  { name: "Malai Momos", price: 200, category: "Starters & Snacks", isVeg: true, prepTime: 15 },
  { name: "Tandoori Momos", price: 200, category: "Starters & Snacks", isVeg: true, prepTime: 15 },
  { name: "Chicken Wrap", price: 130, category: "Starters & Snacks", isVeg: false, prepTime: 10 },

  { name: "Plain Naan", price: 30, category: "Breads", isVeg: true, prepTime: 5 },
  { name: "Butter Naan", price: 40, category: "Breads", isVeg: true, prepTime: 5 },
  { name: "Rumali Roti", price: 30, category: "Breads", isVeg: true, prepTime: 5 },
  { name: "Tawa Roti", price: 20, category: "Breads", isVeg: true, prepTime: 5 },

  { name: "Chicken Nuggets (Half)", price: 350, category: "Non-Veg Starters", isVeg: false, prepTime: 15 },
  { name: "Chicken Nuggets (Full)", price: 600, category: "Non-Veg Starters", isVeg: false, prepTime: 15 },
  { name: "Chicken Fingers (Half)", price: 350, category: "Non-Veg Starters", isVeg: false, prepTime: 15 },
  { name: "Chicken Fingers (Full)", price: 600, category: "Non-Veg Starters", isVeg: false, prepTime: 15 },

  { name: "Crispy Paneer", price: 350, category: "Veg Starters", isVeg: true, prepTime: 15 },
  { name: "Crispy Corn", price: 250, category: "Veg Starters", isVeg: true, prepTime: 15 },

  { name: "Virgin Mojito", price: 120, category: "Cold Beverages", isVeg: true, prepTime: 5 },
  { name: "Blue Curacao", price: 120, category: "Cold Beverages", isVeg: true, prepTime: 5 },
  { name: "Fresh Lime Soda", price: 110, category: "Cold Beverages", isVeg: true, prepTime: 3 },
  { name: "Deep Sea Blue", price: 130, category: "Cold Beverages", isVeg: true, prepTime: 5 },
  { name: "Green Apple", price: 130, category: "Cold Beverages", isVeg: true, prepTime: 5 },

  { name: "Chicken Biryani (Half)", price: 120, category: "Rice & Biryani", isVeg: false, prepTime: 25 },
  { name: "Chicken Biryani (Full)", price: 240, category: "Rice & Biryani", isVeg: false, prepTime: 25 },
  { name: "Veg Fried Rice (Half)", price: 150, category: "Rice & Biryani", isVeg: true, prepTime: 20 },
  { name: "Veg Fried Rice (Full)", price: 250, category: "Rice & Biryani", isVeg: true, prepTime: 20 },
  { name: "Schezwan Veg Fried Rice (Half)", price: 170, category: "Rice & Biryani", isVeg: true, prepTime: 20 },
  { name: "Schezwan Veg Fried Rice (Full)", price: 270, category: "Rice & Biryani", isVeg: true, prepTime: 20 },
  { name: "Chicken Fried Rice (Half)", price: 170, category: "Rice & Biryani", isVeg: false, prepTime: 20 },
  { name: "Chicken Fried Rice (Full)", price: 280, category: "Rice & Biryani", isVeg: false, prepTime: 20 },
  { name: "Schezwan Chicken Fried Rice (Half)", price: 190, category: "Rice & Biryani", isVeg: false, prepTime: 20 },
  { name: "Schezwan Chicken Fried Rice (Full)", price: 300, category: "Rice & Biryani", isVeg: false, prepTime: 20 },
  { name: "Chicken Pulav (Half)", price: 180, category: "Rice & Biryani", isVeg: false, prepTime: 20 },
  { name: "Chicken Pulav (Full)", price: 280, category: "Rice & Biryani", isVeg: false, prepTime: 20 },
  { name: "Veg Pulav (Half)", price: 170, category: "Rice & Biryani", isVeg: true, prepTime: 20 },
  { name: "Veg Pulav (Full)", price: 260, category: "Rice & Biryani", isVeg: true, prepTime: 20 },
  { name: "Plain Rice (Full)", price: 120, category: "Rice & Biryani", isVeg: true, prepTime: 10 },
  { name: "Zeera Rice (Full)", price: 150, category: "Rice & Biryani", isVeg: true, prepTime: 10 },

  { name: "Roasted Chicken Pizza (R)", price: 240, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Roasted Chicken Pizza (M)", price: 320, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Roasted Chicken Pizza (L)", price: 480, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Roasted Chicken Pizza (XL)", price: 580, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Chicken Blast Pizza (R)", price: 200, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Chicken Blast Pizza (M)", price: 300, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Chicken Blast Pizza (L)", price: 450, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Chicken Blast Pizza (XL)", price: 570, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "BBQ Chicken Pizza (R)", price: 220, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "BBQ Chicken Pizza (M)", price: 300, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "BBQ Chicken Pizza (L)", price: 450, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "BBQ Chicken Pizza (XL)", price: 550, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Mexican Bite Pizza (R)", price: 250, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Mexican Bite Pizza (M)", price: 350, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Mexican Bite Pizza (L)", price: 490, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Mexican Bite Pizza (XL)", price: 600, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Peri Peri Chicken Pizza (R)", price: 250, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Peri Peri Chicken Pizza (M)", price: 350, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Peri Peri Chicken Pizza (L)", price: 490, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Peri Peri Chicken Pizza (XL)", price: 600, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Butter Chicken Pizza (R)", price: 270, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Butter Chicken Pizza (M)", price: 370, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Butter Chicken Pizza (L)", price: 500, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Butter Chicken Pizza (XL)", price: 630, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Golden Delight Pizza (R)", price: 270, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Golden Delight Pizza (M)", price: 370, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Golden Delight Pizza (L)", price: 500, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Golden Delight Pizza (XL)", price: 650, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Khyenn Chyenn Special Pizza (R)", price: 270, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Khyenn Chyenn Special Pizza (M)", price: 350, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Khyenn Chyenn Special Pizza (L)", price: 500, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Khyenn Chyenn Special Pizza (XL)", price: 650, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Chicken Tikka Pizza (R)", price: 250, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Chicken Tikka Pizza (M)", price: 330, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Chicken Tikka Pizza (L)", price: 470, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },
  { name: "Chicken Tikka Pizza (XL)", price: 570, category: "Non-Veg Pizzas", isVeg: false, prepTime: 20 },

  { name: "Tomato Paneer Pizza", price: 300, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Paneer Butter Masala Pizza", price: 360, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Kadhai Paneer Pizza", price: 350, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Mattar Paneer Pizza", price: 360, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Paneer Curry Pizza", price: 340, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Mattar Mushroom Pizza", price: 350, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Classic Cheese Pizza (R)", price: 200, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Classic Cheese Pizza (M)", price: 280, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Classic Cheese Pizza (L)", price: 430, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Classic Cheese Pizza (XL)", price: 520, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Kids Favourite Pizza (R)", price: 220, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Kids Favourite Pizza (M)", price: 300, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Kids Favourite Pizza (L)", price: 450, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Kids Favourite Pizza (XL)", price: 530, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Margarita Pizza (R)", price: 220, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Margarita Pizza (M)", price: 300, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Margarita Pizza (L)", price: 450, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Margarita Pizza (XL)", price: 530, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Schezwan Veggie Pizza (R)", price: 230, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Schezwan Veggie Pizza (M)", price: 310, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Schezwan Veggie Pizza (L)", price: 470, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Schezwan Veggie Pizza (XL)", price: 540, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Khyenn Chyenn Special Veg Pizza (R)", price: 280, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Khyenn Chyenn Special Veg Pizza (M)", price: 370, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Khyenn Chyenn Special Veg Pizza (L)", price: 500, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Khyenn Chyenn Special Veg Pizza (XL)", price: 650, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Owner Special Pizza (R)", price: 220, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Owner Special Pizza (M)", price: 350, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Owner Special Pizza (L)", price: 480, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Owner Special Pizza (XL)", price: 580, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Spicy Paneer Pizza (R)", price: 240, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Spicy Paneer Pizza (M)", price: 350, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Spicy Paneer Pizza (L)", price: 500, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Spicy Paneer Pizza (XL)", price: 600, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Margarita Deluxe Pizza (R)", price: 240, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Margarita Deluxe Pizza (M)", price: 370, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Margarita Deluxe Pizza (L)", price: 520, category: "Veg Pizzas", isVeg: true, prepTime: 20 },
  { name: "Margarita Deluxe Pizza (XL)", price: 580, category: "Veg Pizzas", isVeg: true, prepTime: 20 },

  { name: "Pizza Toppings (R)", price: 30, category: "Pizza Extras", isVeg: true, prepTime: 2 },
  { name: "Pizza Toppings (M)", price: 50, category: "Pizza Extras", isVeg: true, prepTime: 2 },
  { name: "Pizza Toppings (L)", price: 80, category: "Pizza Extras", isVeg: true, prepTime: 2 },
  { name: "Pizza Toppings (XL)", price: 100, category: "Pizza Extras", isVeg: true, prepTime: 2 },
  { name: "Extra Cheese (R)", price: 30, category: "Pizza Extras", isVeg: true, prepTime: 2 },
  { name: "Extra Cheese (M)", price: 50, category: "Pizza Extras", isVeg: true, prepTime: 2 },
  { name: "Extra Cheese (L)", price: 80, category: "Pizza Extras", isVeg: true, prepTime: 2 },
  { name: "Extra Cheese (XL)", price: 100, category: "Pizza Extras", isVeg: true, prepTime: 2 },
  { name: "Cheese Burst (R)", price: 30, category: "Pizza Extras", isVeg: true, prepTime: 2 },
  { name: "Cheese Burst (M)", price: 50, category: "Pizza Extras", isVeg: true, prepTime: 2 },
  { name: "Cheese Burst (L)", price: 80, category: "Pizza Extras", isVeg: true, prepTime: 2 },
  { name: "Cheese Burst (XL)", price: 100, category: "Pizza Extras", isVeg: true, prepTime: 2 },

  { name: "Chicken Kanti (Half)", price: 320, category: "Non-Veg Curries", isVeg: false, prepTime: 25 },
  { name: "Chicken Kanti (Full)", price: 580, category: "Non-Veg Curries", isVeg: false, prepTime: 25 },
  { name: "Butter Chicken Boneless (Half)", price: 330, category: "Non-Veg Curries", isVeg: false, prepTime: 25 },
  { name: "Butter Chicken Boneless (Full)", price: 600, category: "Non-Veg Curries", isVeg: false, prepTime: 25 },
  { name: "Butter Chicken With Bone (Half)", price: 430, category: "Non-Veg Curries", isVeg: false, prepTime: 25 },
  { name: "Butter Chicken With Bone (Full)", price: 680, category: "Non-Veg Curries", isVeg: false, prepTime: 25 },
  { name: "Chicken Curry (Half)", price: 370, category: "Non-Veg Curries", isVeg: false, prepTime: 25 },
  { name: "Chicken Curry (Full)", price: 550, category: "Non-Veg Curries", isVeg: false, prepTime: 25 },
  { name: "Masala Chicken (Half)", price: 380, category: "Non-Veg Curries", isVeg: false, prepTime: 25 },
  { name: "Masala Chicken (Full)", price: 570, category: "Non-Veg Curries", isVeg: false, prepTime: 25 },
  { name: "Kadhai Chicken (Half)", price: 380, category: "Non-Veg Curries", isVeg: false, prepTime: 25 },
  { name: "Kadhai Chicken (Full)", price: 570, category: "Non-Veg Curries", isVeg: false, prepTime: 25 },
  { name: "Wazwan Chicken (Half)", price: 350, category: "Non-Veg Curries", isVeg: false, prepTime: 25 },
  { name: "Wazwan Chicken (Full)", price: 560, category: "Non-Veg Curries", isVeg: false, prepTime: 25 },

  { name: "Onion Gravy (Half)", price: 60, category: "Veg Curries", isVeg: true, prepTime: 15 },
  { name: "Onion Gravy (Full)", price: 100, category: "Veg Curries", isVeg: true, prepTime: 15 },

  { name: "Hot Sauce", price: 10, category: "Sauces & Sides", isVeg: true, prepTime: 1 },
  { name: "Mayonnaise", price: 10, category: "Sauces & Sides", isVeg: true, prepTime: 1 },
  { name: "Raita", price: 10, category: "Sauces & Sides", isVeg: true, prepTime: 1 },
  { name: "Mint Sauce", price: 10, category: "Sauces & Sides", isVeg: true, prepTime: 1 },
  { name: "Ketchup Dip", price: 10, category: "Sauces & Sides", isVeg: true, prepTime: 1 },

  { name: "Coffee", price: 70, category: "Hot Beverages", isVeg: true, prepTime: 3 },
  { name: "Cappuccino", price: 90, category: "Hot Beverages", isVeg: true, prepTime: 3 },
  { name: "Lemon Tea", price: 40, category: "Hot Beverages", isVeg: true, prepTime: 3 },
  { name: "Masala Tea", price: 50, category: "Hot Beverages", isVeg: true, prepTime: 3 },
  { name: "Kashmiri Kehwa", price: 70, category: "Hot Beverages", isVeg: true, prepTime: 3 },
  { name: "Green Tea", price: 50, category: "Hot Beverages", isVeg: true, prepTime: 3 },
  { name: "Black Coffee", price: 50, category: "Hot Beverages", isVeg: true, prepTime: 3 },
];

async function seedData() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");

    await MenuItem.deleteMany({});
    await Category.deleteMany({});
    console.log("Old data deleted");

    const createdCategories = await Category.insertMany(categories);
    console.log(`${createdCategories.length} categories created`);

    const categoryMap = {};
    createdCategories.forEach(c => { categoryMap[c.name] = c._id; });

    const menuItemsWithCategory = menuItems.map(item => ({
      ...item,
      category: categoryMap[item.category],
      displayOrder: 0,
    }));

    const createdItems = await MenuItem.insertMany(menuItemsWithCategory);
    console.log(`${createdItems.length} menu items created`);

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error("Error seeding:", error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

seedData();