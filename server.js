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

    methods: [
      "GET",
      "POST",
      "PUT",
      "DELETE",
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-user-email",
    ],
  })
);

/* ================= HANDLE PREFLIGHT ================= */


/* ================= WEBHOOK RAW BODY ================= */

app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  payments.handleWebhook
);

/* ================= JSON ================= */

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

/* ================= ADMIN SECURITY ================= */

/* ================= ADMIN SECURITY ================= */

const adminEmails = [
  "sivuyilematras@gmail.com"
];

const checkAdmin = async (req, res, next) => {
  try {
    const email = req.headers["x-user-email"];

    console.log("📩 Incoming admin email:", email);

    if (!email) {
      return res.status(401).json({
        error: "No admin email provided",
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    const allowedEmails = adminEmails.map((e) =>
      e.toLowerCase().trim()
    );

    console.log("✅ Allowed emails:", allowedEmails);

    if (!allowedEmails.includes(cleanEmail)) {
      return res.status(403).json({
        error: "Unauthorized admin access",
      });
    }

    next();
  } catch (err) {
    console.error("❌ ADMIN CHECK ERROR:", err);

    return res.status(500).json({
      error: "Admin middleware failed",
    });
  }
};

/* ================= ADMIN ROUTES ================= */
/* ================= ADMIN ROUTES ================= */

app.get(
  "/api/admin/stats",
  checkAdmin,
  async (req, res) => {
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

        if (data.type === "subscription") {
          subscriptions++;
        }

        if (data.type === "feature") {
          features++;
        }
      });

      return res.json({
        totalRevenue: totalRevenue / 100,
        totalPayments,
        subscriptions,
        features,
      });
    } catch (err) {
      console.error("❌ ADMIN STATS ERROR:", err);

      return res.status(500).json({
        error: err.message,
      });
    }
  }
);

/* ================= SOCKET SERVER ================= */

const server = http.createServer(app);

/* ================= SOCKET.IO ================= */

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

/* ================= SOCKET EVENTS ================= */

io.on("connection", (socket) => {
  console.log("🟢 Connected:", socket.id);

  socket.on("join_user_room", ({ userId }) => {
    if (!userId) return;

    socket.join(userId);
  });

  socket.on(
    "send_message",
    async ({ userId, message, sender }) => {
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

        io.to(userId).emit(
          "receive_message",
          {
            message,
            sender,
          }
        );
      } catch (err) {
        console.error(
          "❌ Socket error:",
          err.message
        );
      }
    }
  );

  socket.on("disconnect", () => {
    console.log("🔴 Disconnected:", socket.id);
  });
});

/* ================= START SERVER ================= */

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});