const axios = require("axios");
const admin = require("firebase-admin");

/* ================= FIREBASE INIT ================= */

if (!admin.apps.length) {
  const privateKey =
    process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n").replace(/^"|"$/g, "");

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

/* ================= NETFLIX-STYLE SUBSCRIPTIONS ================= */

const PLANS = {
  free: {
    listings: 2,
    featured: false,
    priority: false,
  },
  hustler: {
    listings: 15,
    featured: true,
    priority: true,
  },
  business: {
    listings: Infinity,
    featured: true,
    priority: true,
    premiumBadge: true,
  },
};

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

const isValidPlan = (plan) => ["hustler", "business"].includes(plan);

/* ================= CREATE CHECKOUT ================= */

const createCheckout = async (req, res) => {
  try {
    const { email, plan, userId, type, listingId } = req.body;

    if (!email || !userId || !type) {
      return res.status(400).json({ error: "Missing fields" });
    }

    let amount = 0;
    let description = "Marketplace Payment";

    /* ================= PRICING ================= */

    if (type === "subscription") {
      if (!isValidPlan(plan)) {
        return res.status(400).json({ error: "Invalid plan" });
      }

      if (plan === "hustler") {
        amount = 19900;
        description = "Hustler Plan (30 days)";
      }

      if (plan === "business") {
        amount = 39900;
        description = "Business Plan (30 days)";
      }
    }

    if (type === "verify_seller") {
      amount = 9900;
      description = "Verified Seller Badge";
    }

    if (type === "feature") {
      amount = 1000;
      description = "Featured Listing";
    }

    /* ================= YOCO REQUEST ================= */

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

    /* ================= STORE PENDING PAYMENT ================= */

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

/* ================= WEBHOOK ================= */

const handleWebhook = async (req, res) => {
  try {
    let event =
      Buffer.isBuffer(req.body)
        ? JSON.parse(req.body.toString("utf8"))
        : req.body;

    const eventId = event.id || event.payload?.id;
    if (!eventId) return res.sendStatus(200);

    /* ================= DEDUP ================= */

    const webhookRef = db.collection("webhooks").doc(eventId);
    if ((await webhookRef.get()).exists) return res.sendStatus(200);

    await webhookRef.set({
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    /* ================= ONLY SUCCESS EVENTS ================= */

    if (event.type !== "payment.succeeded") {
      return res.sendStatus(200);
    }

    const metadata = event.payload?.metadata;
    if (!metadata?.userId) return res.sendStatus(200);

    const { userId, type, plan, listingId } = metadata;
    const userRef = db.collection("users").doc(userId);

    /* ================= SUBSCRIPTION UPGRADE ================= */

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

          listingsLimit: PLANS[plan].listings,
          featuredAccess: PLANS[plan].featured,
          priorityAccess: PLANS[plan].priority,

          lastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    /* ================= VERIFIED SELLER ================= */

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

/* ================= USER STATUS API (REAL-TIME SUPPORT) ================= */

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

/* ================= EXPORTS ================= */

module.exports = {
  createCheckout,
  handleWebhook,
  checkUserStatus,
};