const axios = require("axios");
const admin = require("firebase-admin");
const crypto = require("crypto");

/* ================= FIREBASE INIT ================= */

if (!admin.apps.length) {
  const privateKey =
    process.env.FIREBASE_PRIVATE_KEY
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

/* ================= SUBSCRIPTION RULES (30 DAYS) ================= */

const SUB_DAYS = {
  hustler: 30,
  business: 30,
};

const GRACE_DAYS = 3;

/* ================= HELPERS ================= */

const getExpiryDate = (plan) => {
  const d = new Date();
  d.setDate(d.getDate() + (SUB_DAYS[plan] || 30));
  return d;
};

const getGraceDate = (expiry) => {
  const d = new Date(expiry);
  d.setDate(d.getDate() + GRACE_DAYS);
  return d;
};

/* =========================================================
   CREATE CHECKOUT
========================================================= */

const createCheckout = async (req, res) => {
  try {
    const { email, plan, userId, type, listingId } = req.body;

    if (!email || !userId || !type) {
      return res.status(400).json({ error: "Missing fields" });
    }

    let amount = 0;
    let description = "Marketplace Payment";

    if (type === "subscription") {
      if (plan === "hustler") {
        amount = 19900;
        description = "Hustler Plan";
      } else if (plan === "business") {
        amount = 39900;
        description = "Business Plan";
      } else {
        return res.status(400).json({ error: "Invalid plan" });
      }
    }

    if (type === "verify_seller") {
      amount = 10000;
      description = "Verified Seller Badge";
    }

    if (type === "feature") {
      amount = 1000;
      description = "Featured Listing";
    }

    const response = await axios.post(
      "https://api.yoco.com/v1/payment_links/",
      {
        amount: { amount, currency: "ZAR" },
        customer_reference: email,
        customer_description: description,

        metadata: {
          userId,
          email,
          type,
          plan: plan || null,
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

    await db.collection("pendingPayments").add({
      userId,
      email,
      type,
      plan: plan || null,
      listingId: listingId || null,
      amount,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ url: response.data.url });

  } catch (err) {
    console.error("CREATE CHECKOUT ERROR:", err.message);
    return res.status(500).json({ error: "Checkout failed" });
  }
};

/* =========================================================
   WEBHOOK (FIXED - NO BUFFER ERRORS)
========================================================= */

const handleWebhook = async (req, res) => {
  try {
    let event;

    if (Buffer.isBuffer(req.body)) {
      event = JSON.parse(req.body.toString("utf8"));
    } else {
      event = req.body;
    }

    const eventId = event.id || event.payload?.id;
    if (!eventId) return res.sendStatus(200);

    const ref = db.collection("webhooks").doc(eventId);
    if ((await ref.get()).exists) return res.sendStatus(200);
    await ref.set({ createdAt: admin.firestore.FieldValue.serverTimestamp() });

    if (event.type !== "payment.succeeded") return res.sendStatus(200);

    const metadata = event.payload?.metadata;
    if (!metadata?.userId || !metadata?.type) return res.sendStatus(200);

    const { userId, type, plan, listingId } = metadata;

    const userRef = db.collection("users").doc(userId);

    /* ================= SUBSCRIPTION (30 DAYS FIXED) ================= */

    if (type === "subscription") {
      const expiry = getExpiryDate(plan);

      await userRef.set(
        {
          plan,
          subscriptionActive: true,
          subscriptionExpires: expiry,
          graceUntil: getGraceDate(expiry),
          canPost: true,
          isPremium: plan === "business",
          verified: true, // optional upgrade boost
          lastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    /* ================= VERIFIED BADGE ================= */

    if (type === "verify_seller") {
      await userRef.set(
        {
          verified: true,
          verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          verificationSource: "yoco",
        },
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
    console.error("WEBHOOK ERROR:", err.message);
    return res.sendStatus(400);
  }
};

/* =========================================================
   USER STATUS (REAL-TIME BADGE SYNC)
========================================================= */

const checkUserStatus = async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    const doc = await db.collection("users").doc(userId).get();

    return res.json(doc.data() || {});
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch user" });
  }
};

/* =========================================================
   EXPORTS
========================================================= */

module.exports = {
  createCheckout,
  handleWebhook,
  checkUserStatus,
};