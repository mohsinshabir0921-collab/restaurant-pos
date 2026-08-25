require("dotenv").config();
const mongoose = require("mongoose");
const Category = require("./models/Category");
const MenuItem = require("./models/MenuItem");
const { imagePathForName } = require("./menuImages");
const { categories, menuItems, PREP, buildSizeModifier } = require("./menuSeedData");

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
    createdCategories.forEach((c) => {
      categoryMap[c.name] = c._id;
    });

    const menuItemsWithCategory = menuItems.map((item) => {
      const basePrice = item.sizes ? item.sizes[0].price : item.price;
      return {
        name: item.name,
        description: item.description || "",
        price: basePrice,
        category: categoryMap[item.category],
        isVeg: item.isVeg !== undefined ? item.isVeg : true,
        prepTime: PREP[item.category] || 15,
        isAvailable: true,
        taxRate: 0,
        displayOrder: 0,
        image: imagePathForName(item.name),
        modifiers: buildSizeModifier(item),
      };
    });

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
