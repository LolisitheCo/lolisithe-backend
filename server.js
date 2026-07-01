const express = require("express");
const http = require("http");
const cors = require("cors");
require("dotenv").config();

const payments = require("./src/controllers/paymentController");
const runExpiryCheck = require("./jobs/subscriptionCron");

const app = express();
const server = http.createServer(app);

/* ================= CORS ================= */

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://lolisitheco.co.za",
      "https://www.lolisitheco.co.za",
    ],
    credentials: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

/* ================= WEBHOOK (RAW FIRST - CRITICAL) ================= */

app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  payments.handleWebhook
);

/* ================= SAFE JSON MIDDLEWARE ================= */

app.use((req, res, next) => {
  if (req.originalUrl === "/api/payments/webhook") return next();
  express.json()(req, res, next);
});

/* ================= HEALTH ================= */

app.get("/", (req, res) => {
  res.send("💳 Payment Backend Running");
});

/* ================= ROUTES ================= */

app.post("/api/payments/create-checkout", payments.createCheckout);

app.get("/api/payments/status", payments.checkUserStatus);

/* ================= SUBSCRIPTION CRON ================= */

setInterval(async () => {
  try {
    await runExpiryCheck();
  } catch (err) {
    console.error("❌ Expiry job error:", err);
  }
}, 60 * 60 * 1000);

/* ================= START ================= */

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`💳 Payment server running on port ${PORT}`);
});