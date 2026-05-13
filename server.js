const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
require("dotenv").config();

/* ================= FIREBASE ADMIN ================= */

const admin = require("firebase-admin");

/*
  IMPORTANT:
  Download your Firebase service account JSON
  and place it in root backend folder as:

  firebase-service-account.json
*/

const serviceAccount = require("./firebase-service-account.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential:
      admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

/* ================= CONTROLLERS ================= */

const payments = require(
  "./src/controllers/paymentController"
);

/* ================= EXPRESS ================= */

const app = express();

/* ================= WEBHOOK RAW BODY ================= */

/*
  Yoco webhook requires RAW body
  BEFORE express.json()
*/

app.use(
  "/api/payments/webhook",
  express.raw({
    type: "application/json",
  })
);

/* ================= BODY PARSER ================= */

app.use(express.json());

/* ================= CORS ================= */

app.use(
  cors({
    origin: [
      "http://localhost:5173",

      "https://lolisitheco.co.za",

      "https://www.lolisitheco.co.za",
    ],

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
    ],

    credentials: true,
  })
);

/* ================= SERVER ================= */

const server = http.createServer(app);

/* ================= SOCKET.IO ================= */

const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173",

      "https://lolisitheco.co.za",

      "https://www.lolisitheco.co.za",
    ],

    methods: ["GET", "POST"],

    credentials: true,
  },
});

/* ================= SOCKET EVENTS ================= */

io.on("connection", (socket) => {

  console.log(
    "🟢 Connected:",
    socket.id
  );

  /* ================= JOIN ROOM ================= */

  socket.on(
    "join_user_room",
    ({ userId, email }) => {

      socket.join(userId);

      console.log(
        `👤 ${email} joined room ${userId}`
      );
    }
  );

  /* ================= SEND MESSAGE ================= */

  socket.on(
    "send_message",

    async ({
      userId,
      message,
      sender,
    }) => {

      try {

        if (!userId || !message) {
          return;
        }

        const msgData = {
          text: message,

          sender,

          createdAt: new Date(),
        };

        /* SAVE TO FIRESTORE */

        await db
          .collection("conversations")
          .doc(userId)
          .collection("messages")
          .add(msgData);

        /* EMIT TO ROOM */

        io.to(userId).emit(
          "receive_message",
          {
            message,
            sender,
          }
        );

      } catch (err) {

        console.error(
          "❌ Message error:",
          err
        );
      }
    }
  );

  /* ================= DISCONNECT ================= */

  socket.on("disconnect", () => {

    console.log(
      "🔴 Disconnected:",
      socket.id
    );
  });
});

/* ================= ROUTES ================= */

/* ROOT */

app.get("/", (req, res) => {

  res.send("🚀 Backend running");
});

/* TEST */

app.get("/api/test", (req, res) => {

  res.json({
    success: true,
    message: "API working",
  });
});

/* ================= PAYMENTS ================= */

/* CREATE CHECKOUT */

app.post(
  "/api/payments/create-checkout",

  payments.createCheckout
);

/* WEBHOOK */

app.post(
  "/api/payments/webhook",

  payments.handleWebhook
);

/* USER STATUS */

app.get(
  "/api/payments/status",

  payments.checkUserStatus
);

/* ================= START ================= */

const PORT =
  process.env.PORT || 5000;

server.listen(PORT, () => {

  console.log(
    `🚀 Server running on port ${PORT}`
  );
});