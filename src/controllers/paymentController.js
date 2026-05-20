const axios = require("axios");
const admin = require("firebase-admin");
const crypto = require("crypto");

if (!admin.apps.length) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    .replace(/\\n/g, "\n")
    .replace(/^"|"$/g, "");

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    }),
  });
}

const db = admin.firestore();

/* ================= ENV ================= */

const YOCO_SECRET_KEY = process.env.YOCO_SECRET_KEY;
const YOCO_WEBHOOK_SECRET = process.env.YOCO_WEBHOOK_SECRET;
const FRONTEND_URL = "https://lolisitheco.co.za";

/* ================= SOCKET (optional) ================= */

let io;
const setSocket = (socketIo) => {
  io = socketIo;
};

/* ================= PLANS ================= */

const SUB_DAYS = {
  hustler: 30,
  business: 30,
};

/* ================= CREATE CHECKOUT ================= */

const createCheckout = async (req, res) => {
  try {
    const { email, plan, userId, type, listingId } = req.body;

    if (!email || !userId || !type) {
      return res.status(400).json({ error: "Missing fields" });
    }

    let amount = 0;

    if (type === "subscription") {
      if (plan === "hustler") amount = 19900;
      else if (plan === "business") amount = 39900;
      else return res.status(400).json({ error: "Invalid plan" });
    } else if (type === "verify_seller") {
      amount = 10000;
    } else if (type === "feature") {
      amount = 1000;
    } else {
      return res.status(400).json({ error: "Invalid payment type" });
    }

    const response = await axios.post(
      "https://payments.yoco.com/api/checkouts",
      {
        amount,
        currency: "ZAR",
        successUrl: `${FRONTEND_URL}/payment-success`,
        cancelUrl: `${FRONTEND_URL}/subscribe`,
        metadata: {
          userId,
          email,
          plan,
          type,
          listingId: listingId || null,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${YOCO_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    return res.json({ url: response.data.redirectUrl });

  } catch (err) {
    console.error("❌ CHECKOUT ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Payment failed" });
  }
};

/* ================= VERIFY WEBHOOK ================= */

const verifyWebhook = (req) => {
  if (!YOCO_WEBHOOK_SECRET) return;

  const signature = req.headers["webhook-signature"];
  if (!signature) throw new Error("Missing signature");

  const payload = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(req.body);

  const expected = crypto
    .createHmac("sha256", YOCO_WEBHOOK_SECRET)
    .update(payload)
    .digest("hex");

  if (signature !== expected) {
    throw new Error("Invalid webhook signature");
  }
};

/* ================= EXPIRY ================= */

const getExpiryDate = (plan) => {
  const days = SUB_DAYS[plan] || 30;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};

/* ================= WEBHOOK ================= */

const handleWebhook = async (req, res) => {
  try {
    verifyWebhook(req);

    const event = JSON.parse(req.body.toString());

    const eventId =
      event.id || event.payload?.id || `evt_${Date.now()}`;

    /* prevent duplicate processing */
    const eventRef = db.collection("webhooks").doc(eventId);
    if ((await eventRef.get()).exists) return res.sendStatus(200);

    await eventRef.set({
      createdAt: new Date(),
    });

    if (event.type !== "payment.succeeded") {
      return res.sendStatus(200);
    }

    const metadata =
      event.payload?.metadata || event.data?.metadata;

    if (!metadata) return res.sendStatus(200);

    const { userId, plan, type, listingId } = metadata;

    const amount = event.payload?.amount || 0;

    /* ================= SAVE PAYMENT HISTORY ================= */

    await db.collection("payments").doc(eventId).set({
      userId,
      amount,
      type,
      plan: plan || null,
      createdAt: new Date(),
    });

    const userRef = db.collection("users").doc(userId);

    /* ================= SUBSCRIPTION ================= */

    if (type === "subscription") {
      await userRef.set(
        {
          plan,
          subscriptionActive: true,
          subscriptionExpires: getExpiryDate(plan),
          canPost: true,
          isPremium: plan === "business",
          lastPaymentAt: new Date(),
        },
        { merge: true }
      );

      if (io) {
        io.to(userId).emit("notification", {
          type: "subscription",
          message: "🚀 Subscription activated!",
        });
      }
    }

    /* ================= VERIFY SELLER ================= */

    if (type === "verify_seller") {
      await userRef.set(
        { verified: true },
        { merge: true }
      );

      if (io) {
        io.to(userId).emit("notification", {
          type: "verified",
          message: "✔ You are now verified!",
        });
      }
    }

    /* ================= FEATURE LISTING ================= */

    if (type === "feature" && listingId) {
      await db.collection("products").doc(listingId).set(
        {
          featured: true,
          featuredAt: new Date(),
        },
        { merge: true }
      );
    }

    return res.sendStatus(200);

  } catch (err) {
    console.error("❌ WEBHOOK ERROR:", err.message);
    return res.sendStatus(400);
  }
};

/* ================= USER STATUS ================= */

const checkUserStatus = async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    const doc = await db.collection("users").doc(userId).get();

    if (!doc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json(doc.data());

  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch status" });
  }
};

/* ================= ADMIN STATS ================= */

/* ================= ADMIN STATS ================= */

const getAdminStats = async (req, res) => {
  try {
    const paymentsSnap = await db.collection("payments").get();

    let totalRevenue = 0;
    let totalPayments = 0;
    let subscriptions = 0;
    let features = 0;

    paymentsSnap.forEach((doc) => {
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

    return res.status(200).json({
      totalRevenue: totalRevenue / 100,
      totalPayments,
      subscriptions,
      features,
    });

  } catch (err) {

    console.error(
      "❌ ADMIN STATS ERROR:",
      err
    );

    return res.status(500).json({
      error: "Failed to load admin stats",
      details: err.message,
    });
  }
};

module.exports = {
  createCheckout,
  handleWebhook,
  checkUserStatus,
  getAdminStats,
  setSocket,
};