const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ALLOWED_ROLES = ["admin", "cashier", "kitchen", "delivery", "waiter"];

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
    },

    role: {
      type: String,
      enum: ALLOWED_ROLES,
      default: "cashier",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    refreshTokens: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.comparePassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.addRefreshToken = async function (refreshToken) {
  if (!Array.isArray(this.refreshTokens)) {
    this.refreshTokens = [];
  }
  const salt = await bcrypt.genSalt(10);
  const hashed = await bcrypt.hash(refreshToken, salt);
  this.refreshTokens.push(hashed);
  await this.save();
};

userSchema.methods.isValidRefreshToken = async function (refreshToken) {
  const tokens = Array.isArray(this.refreshTokens) ? this.refreshTokens : [];
  for (const stored of tokens) {
    if (await bcrypt.compare(refreshToken, stored)) {
      return true;
    }
  }
  return false;
};

userSchema.methods.removeRefreshToken = async function (refreshToken) {
  const tokens = Array.isArray(this.refreshTokens) ? this.refreshTokens : [];
  let matchedHash = null;
  for (const stored of tokens) {
    if (await bcrypt.compare(refreshToken, stored)) {
      matchedHash = stored;
      break;
    }
  }
  if (matchedHash) {
    this.refreshTokens = tokens.filter((t) => t !== matchedHash);
    await this.save();
  }
};

module.exports = mongoose.model("User", userSchema);