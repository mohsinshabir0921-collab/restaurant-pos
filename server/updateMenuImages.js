require("dotenv").config();
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const { imagePathForName } = require("./menuImages");

async function updateMenuImages() {
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    console.log("MongoDB connected");

    const items = await mongoose.connection.collection("menuitems").find({}).toArray();
    console.log(`Loaded ${items.length} menu items`);

    let updated = 0;
    const unmatched = [];
    for (const item of items) {
      const image = imagePathForName(item.name);
      if (!image) {
        unmatched.push(item.name);
        continue;
      }
      if (item.image === image) continue;
      await mongoose.connection.collection("menuitems").updateOne(
        { _id: item._id },
        { $set: { image } }
      );
      updated++;
    }

    const withImage = await mongoose.connection.collection("menuitems").countDocuments({ image: { $ne: "" } });
    const total = items.length;
    console.log(`Updated ${updated} items, ${withImage}/${total} now have an image.`);
    if (unmatched.length) console.log(`No image mapped for ${unmatched.length}: ${unmatched.join(" | ")}`);

    const imageDir = path.join(__dirname, "..", "client", "public", "images", "menu");
    const missingFiles = [];
    const withImg = await mongoose.connection.collection("menuitems").find({ image: { $ne: "" } }).toArray();
    for (const it of withImg) {
      const file = path.join(imageDir, path.basename(it.image));
      if (!fs.existsSync(file)) missingFiles.push(it.image);
    }
    if (missingFiles.length) console.log(`MISSING FILES: ${[...new Set(missingFiles)].join(" | ")}`);
    else console.log("All referenced image files exist on disk.");

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    try { await mongoose.connection.close(); } catch {}
    process.exit(1);
  }
}

updateMenuImages();