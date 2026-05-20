const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
require("dotenv").config();

const admin = require("firebase-admin");

/* ================= FIREBASE ================= */

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

/* ================= CONTROLLERS ================= */

const payments = require("./src/controllers/paymentController");

/* ================= APP ================= */

const app = express();

/* ================= CORS (MUST BE FIRST) ================= */

const allowedOrigins = [
  "http://localhost:5173",
  "https://lolisitheco.co.za",
  "https://www.lolisitheco.co.za",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, true); // safe fallback
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);


/* ================= WEBHOOK RAW BODY (IMPORTANT) ================= */

app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  payments.handleWebhook
);

/* ================= JSON BODY ================= */

app.use(express.json());

/* ================= ROUTES ================= */

/* ROOT */
app.get("/", (req, res) => {
  res.send("🚀 Backend running successfully");
});

/* TEST */
app.get("/api/test", (req, res) => {
  res.json({ success: true, message: "API working" });
});

/* ================= PAYMENTS ================= */

app.post("/api/payments/create-checkout", payments.createCheckout);
app.get("/api/payments/status", payments.checkUserStatus);

/* ================= ADMIN SECURITY ================= */

const adminEmails = ["webbie2nerd@gmail.com"];

const checkAdmin = (req, res, next) => {
  const email = req.headers["x-user-email"];

  if (!email || !adminEmails.includes(email)) {
    return res.status(403).json({ error: "Unauthorized admin access" });
  }

  next();
};

/* ================= ADMIN ROUTES ================= */

app.get("/api/admin/stats", checkAdmin, payments.getAdminStats);

/* ================= SERVER ================= */

const server = http.createServer(app);

/* ================= SOCKET.IO ================= */

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

io.on("connection", (socket) => {
  console.log("🟢 Connected:", socket.id);

  socket.on("join_user_room", ({ userId }) => {
    if (!userId) return;
    socket.join(userId);
  });

  socket.on("send_message", async ({ userId, message, sender }) => {
    try {
      if (!userId || !message) return;

      await db
        .collection("conversations")
        .doc(userId)
        .collection("messages")
        .add({
          text: message,
          sender,
          createdAt: new Date(),
        });

      io.to(userId).emit("receive_message", {
        message,
        sender,
      });
    } catch (err) {
      console.error("❌ Socket error:", err.message);
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 Disconnected:", socket.id);
  });
});

/* ================= START SERVER ================= */

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});