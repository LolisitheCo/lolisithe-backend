const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
require("dotenv").config();

const admin = require("firebase-admin");

if (!admin.apps.length) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    .replace(/\\n/g, "\n")
    .replace(/"/g, "");

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

const db = admin.firestore();

/* ================= CONTROLLERS ================= */
const payments = require("./src/controllers/paymentController");

/* ================= APP ================= */

const app = express();

/* ================= CORS ================= */

const allowedOrigins = [
  "http://localhost:5173",
  "https://lolisitheco.co.za",
  "https://www.lolisitheco.co.za",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("CORS blocked"));
    },

    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

/* ================= BODY ================= */

app.use(express.json());

/* ================= ROOT ================= */

app.get("/", (req, res) => {
  res.send("🚀 Backend running successfully");
});

/* ================= TEST ================= */

app.get("/api/test", (req, res) => {
  res.json({
    success: true,
    message: "API working",
  });
});

/* ================= PAYMENTS ================= */

app.post(
  "/api/payments/create-checkout",
  payments.createCheckout
);

app.get(
  "/api/payments/status",
  payments.checkUserStatus
);

app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  payments.handleWebhook
);

/* =======================================================
   🔐 FIREBASE AUTH + ROLE SYSTEM (REAL SECURITY)
======================================================= */

const getUserFromToken = async (req) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("No token");
  }

  const token = authHeader.split("Bearer ")[1];

  const decoded = await admin.auth().verifyIdToken(token);

  const userDoc = await db.collection("users").doc(decoded.uid).get();

  if (!userDoc.exists) {
    throw new Error("User not found in DB");
  }

  return {
    uid: decoded.uid,
    email: decoded.email,
    ...userDoc.data(),
  };
};

/* ================= ADMIN MIDDLEWARE ================= */

const requireAdmin = async (req, res, next) => {
  try {
    const user = await getUserFromToken(req);

    if (!user.role) {
      return res.status(403).json({ error: "No role assigned" });
    }

    if (!["superAdmin", "moderator"].includes(user.role)) {
      return res.status(403).json({ error: "Not authorized" });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("❌ AUTH ERROR:", err.message);

    return res.status(401).json({
      error: "Invalid or missing token",
    });
  }
};

/* ================= ADMIN ROUTE ================= */

app.get("/api/admin/stats", requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection("payments").get();

    let totalRevenue = 0;
    let totalPayments = 0;
    let subscriptions = 0;
    let features = 0;

    snap.forEach((doc) => {
      const data = doc.data();

      totalRevenue += data.amount || 0;
      totalPayments++;

      if (data.type === "subscription") subscriptions++;
      if (data.type === "feature") features++;
    });

    res.json({
      totalRevenue: totalRevenue / 100,
      totalPayments,
      subscriptions,
      features,
      adminRole: req.user.role,
    });
  } catch (err) {
    console.error("❌ ADMIN STATS ERROR:", err);

    res.status(500).json({
      error: "Failed to load admin stats",
    });
  }
});

/* ================= SOCKET.IO ================= */

const server = http.createServer(app);

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