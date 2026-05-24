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
      privateKey,
    }),
  });
}

const db = admin.firestore();

/* ================= CONFIG ================= */

const YOCO_SECRET_KEY = process.env.YOCO_SECRET_KEY;
const YOCO_WEBHOOK_SECRET = process.env.YOCO_WEBHOOK_SECRET;

const FRONTEND_URL = "https://lolisitheco.co.za";

const SUB_DAYS = {
  hustler: 30,
  business: 30,
};

/* ================= CHECKOUT ================= */

const createCheckout = async (req, res) => {
  try {
    console.log("🔥 CREATE CHECKOUT BODY:", req.body);

    const {
      email,
      plan,
      userId,
      type,
      listingId,
    } = req.body;

    if (!email || !userId || !type) {
      return res.status(400).json({
        error: "Missing required fields",
      });
    }

    let amount = 0;
    let description = "";

    /* ================= SUBSCRIPTION ================= */

    if (type === "subscription") {

      if (plan === "hustler") {
        amount = 19900;
        description = "Hustler Subscription";
      }

      else if (plan === "business") {
        amount = 39900;
        description = "Business Subscription";
      }

      else {
        return res.status(400).json({
          error: "Invalid subscription plan",
        });
      }
    }

   

    console.log(
      "🔥 YOCO SECRET EXISTS:",
      !!YOCO_SECRET_KEY
    );

    /* ================= YOCO PAYMENT LINK ================= */

    const response = await axios.post(
      "https://api.yoco.com/v1/payment_links/",
      {
        amount: {
          amount,
          currency: "ZAR",
        },

        customer_reference: email,

        customer_description: description,
      },
      {
        headers: {
          Authorization: `Bearer ${YOCO_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(
      "✅ YOCO RESPONSE:",
      response.data
    );

    /* ================= SAVE PENDING PAYMENT ================= */

    await db.collection("pendingPayments").add({
      userId,
      email,
      plan: plan || null,
      type,
      listingId: listingId || null,

      paymentLinkId: response.data.id,

      status: "pending",

      createdAt:
        admin.firestore.FieldValue.serverTimestamp(),
    });

    /* ================= RETURN PAYMENT URL ================= */

    return res.status(200).json({
      url: response.data.url,
    });

  } catch (err) {

    console.error(
      "❌ CREATE CHECKOUT ERROR:"
    );

    console.error(
      err.response?.data || err.message
    );

    return res.status(500).json({
      error: "Checkout failed",
      details:
        err.response?.data || err.message,
    });
  }
};

/* ================= WEBHOOK SECURITY ================= */

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

    const eventId = event.id || event.payload?.id;

    if (!eventId) {
      return res.sendStatus(200);
    }

    /* ================= IDEMPOTENCY (PREVENT DOUBLE PAYMENT) ================= */
    const eventRef = db.collection("webhooks").doc(eventId);
    const exists = await eventRef.get();

    if (exists.exists) {
      return res.sendStatus(200);
    }

    await eventRef.set({
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (event.type !== "payment.succeeded") {
      return res.sendStatus(200);
    }

    const metadata = event.payload?.metadata;

    if (!metadata?.userId || !metadata?.type) {
      return res.sendStatus(200);
    }

    const { userId, plan, type, listingId } = metadata;

    /* ================= SAVE PAYMENT ================= */

    await db.collection("payments").doc(eventId).set({
      userId,
      type,
      plan: plan || null,
      listingId: listingId || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
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
          lastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    /* ================= VERIFY SELLER ================= */

    if (type === "verify_seller") {
      await userRef.set(
        { verified: true },
        { merge: true }
      );
    }

    /* ================= FEATURE LISTING ================= */

    if (type === "feature" && listingId) {
      await db.collection("products").doc(listingId).set(
        {
          featured: true,
          featuredAt: admin.firestore.FieldValue.serverTimestamp(),
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

/* ================= ADMIN STATS (SAFE ONLY) ================= */

const getAdminStats = async (req, res) => {
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

    return res.json({
      totalRevenue: totalRevenue / 100,
      totalPayments,
      subscriptions,
      features,
    });

  } catch (err) {
    return res.status(500).json({
      error: "Failed to load admin stats",
    });
  }
};

/* ================= EXPORTS ================= */

module.exports = {
  createCheckout,
  handleWebhook,
  checkUserStatus,
  getAdminStats,
};