const express = require("express");
const cors = require("cors");
require("dotenv").config();

/* ================= APP ================= */

const app = express();

/* ================= FIREBASE ADMIN (OPTIONAL HERE) ================= */

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

/* ================= CORS ================= */

app.use(
  cors({
    origin: [
      "https://lolisitheco.co.za",
      "https://www.lolisitheco.co.za",
    ],
    credentials: true,
  })
);

/* ================= BODY PARSERS ================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ================= ROUTES ================= */

const productRoutes = require("./routes/productRoutes");
const paymentRoutes = require("./routes/paymentRoutes");

/* ================= MOUNT ROUTES ================= */

app.use("/api/products", productRoutes);
app.use("/api/payments", paymentRoutes);

/* ================= HEALTH CHECK ================= */

app.get("/", (req, res) => {
  res.send("🚀 WorldMarket API running");
});

app.get("/api/test", (req, res) => {
  res.json({
    success: true,
    message: "API working correctly",
  });
});

/* ================= ERROR HANDLER ================= */

app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err.message);

  res.status(500).json({
    error: "Internal Server Error",
  });
});

/* ================= EXPORT ================= */

module.exports = app;