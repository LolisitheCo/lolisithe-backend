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

const PLAN_LIMITS = {
  free: { listings: 2 },
  hustler: { listings: 15 },
  business: { listings: -1 },
};

/* 🔥 KEEP ONLY ONE SUB_DAYS */
const SUB_DAYS = {
  hustler: 30,
  business: 30,
};

const GRACE_DAYS = 3;

/* ================= HELPERS ================= */

const getExpiryDate = (plan) => {
  const d = new Date();
  d.setDate(d.getDate() + SUB_DAYS[plan]);
  return d;
};

const getGraceDate = (expiry) => {
  const d = new Date(expiry);
  d.setDate(d.getDate() + GRACE_DAYS);
  return d;
};

/* ================= CREATE CHECKOUT ================= */

const createCheckout = async (req, res) => {
  try {
    const { email, plan, userId, type, listingId } = req.body;

    if (!email || !userId || !type) {
      return res.status(400).json({ error: "Missing fields" });
    }

    let amount = 0;
    let description = "Marketplace Payment";

    if (type === "subscription") {
      if (plan === "hustler") amount = 19900;
      else if (plan === "business") amount = 39900;
    }

    if (type === "verify_seller") {
      amount = 10000;
    }

    if (type === "feature") {
      amount = 1000;
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
    console.error(err.message);
    return res.status(500).json({ error: "Checkout failed" });
  }
};

/* ================= WEBHOOK ================= */

const handleWebhook = async (req, res) => {
  try {
    let event = Buffer.isBuffer(req.body)
      ? JSON.parse(req.body.toString("utf8"))
      : req.body;

    const eventId = event.id || event.payload?.id;
    if (!eventId) return res.sendStatus(200);

    const ref = db.collection("webhooks").doc(eventId);
    if ((await ref.get()).exists) return res.sendStatus(200);
    await ref.set({ createdAt: admin.firestore.FieldValue.serverTimestamp() });

    if (event.type !== "payment.succeeded") return res.sendStatus(200);

    const metadata = event.payload?.metadata;
    if (!metadata?.userId) return res.sendStatus(200);

    const { userId, type, plan, listingId } = metadata;
    const userRef = db.collection("users").doc(userId);

    /* SUBSCRIPTION */
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
        },
        { merge: true }
      );
    }

    /* VERIFIED */
    if (type === "verify_seller") {
      await userRef.set(
        {
          verified: true,
          verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    /* FEATURE */
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

/* ================= EXPORTS ================= */

module.exports = {
  createCheckout,
  handleWebhook,
};