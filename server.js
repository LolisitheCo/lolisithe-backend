const express = require("express");
const http = require("http");
const cors = require("cors");
require("dotenv").config();

const payments = require("./src/controllers/paymentController");

const app = express();
const server = http.createServer(app);

/* ================= CORS ================= */

const allowedOrigins = [
  "http://localhost:5173",
  "https://lolisitheco.co.za",
  "https://www.lolisitheco.co.za",
];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

/* ================= BODY ================= */

app.use(express.json());

/* ================= HEALTH CHECK ================= */

app.get("/", (req, res) => {
  res.send("💳 Payment Backend Running");
});

/* ================= PAYMENTS ONLY ================= */

/**
 * Create checkout session
 */
app.post("/api/payments/create-checkout", payments.createCheckout);

/**
 * Check payment/subscription status (Firebase will store user state)
 */
app.get("/api/payments/status", payments.checkUserStatus);

/**
 * Webhook (Paystack / Yoco / Flutterwave)
 */
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  payments.handleWebhook
);

/* ================= START SERVER ================= */

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`💳 Payment server running on port ${PORT}`);
});