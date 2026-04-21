const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
require("dotenv").config();

// ✅ CORRECT IMPORT
const payments = require("./src/controllers/paymentController");

const app = express();

/* ============================= */
/* 🔐 WEBHOOK RAW BODY (ONLY ONCE) */
/* ============================= */
app.use("/api/payments/webhook", express.raw({ type: "*/*" }));

/* ============================= */
/* NORMAL MIDDLEWARE */
/* ============================= */
app.use(express.json());

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://lolisitheco.co.za",
    ],
  })
);

/* ============================= */
/* SERVER */
/* ============================= */
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "https://lolisitheco.co.za",
    ],
  },
});

/* ================= SOCKET ================= */
io.on("connection", (socket) => {
  console.log("🟢 Connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("🔴 Disconnected:", socket.id);
  });
});

/* ================= ROUTES ================= */

// 💰 CREATE PAYMENT
app.post("/api/payments/create-checkout", payments.createCheckout);

// 🔐 WEBHOOK (Yoco will call this)
app.post("/api/payments/webhook", payments.handleWebhook);

// 📊 USER STATUS (plan + expiry)
app.get("/api/payments/status", payments.checkUserStatus);

// TEST
app.get("/", (req, res) => {
  res.send("🚀 Backend running");
});

/* ================= START ================= */
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});