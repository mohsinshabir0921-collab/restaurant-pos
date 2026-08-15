require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User");
(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const u = await User.findOne({ email: "admin@pos.com" });
  if (!u) {
    console.log("USER: NOT FOUND");
  } else {
    console.log("USER found:", JSON.stringify({ _id: u._id, name: u.name, email: u.email, role: u.role, isActive: u.isActive, refreshTokenCount: (u.refreshTokens || []).length, createdAt: u.createdAt }));
    console.log("password hash prefix:", String(u.password).slice(0, 12));
    console.log("compare admin123:", await bcrypt.compare("admin123", u.password));
    console.log("compare admin123456:", await bcrypt.compare("admin123456", u.password));
  }
  const all = await User.find({}).select("email role isActive").lean();
  console.log("ALL USERS:", JSON.stringify(all));
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error("DB CHECK ERROR:", e.message); process.exit(1); });
