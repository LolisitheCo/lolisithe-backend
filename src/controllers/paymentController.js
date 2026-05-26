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
  business: { listings: -1 }, // unlimited
};

const SUB_DAYS = {
  hustler: 30,
  business: 30,
};

const GRACE_DAYS = 3;

/* =========================================================
   HELPERS (NETFLIX STYLE SUBSCRIPTION ENGINE)
========================================================= */

const SUB_DAYS = {
  hustler: 30,
  business: 30,
};

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

        /* 🔥 CRITICAL FIX */
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
    return res.status(500).json({
      error: "Checkout failed",
      details: err.message,
    });
  }
};

/* =========================================================
   WEBHOOK (FIXED + FULL ENGINE)
========================================================= */

const handleWebhook = async (req, res) => {
  try {
    /* SAFE PARSING */
    let event;
    if (Buffer.isBuffer(req.body)) {
      event = JSON.parse(req.body.toString("utf8"));
    } else {
      event = req.body;
    }

    console.log("🔥 WEBHOOK:", event.type);

    const eventId = event.id || event.payload?.id;
    if (!eventId) return res.sendStatus(200);

    /* DEDUP */
    const ref = db.collection("webhooks").doc(eventId);
    if ((await ref.get()).exists) return res.sendStatus(200);
    await ref.set({ createdAt: admin.firestore.FieldValue.serverTimestamp() });

    /* ONLY SUCCESS */
    if (event.type !== "payment.succeeded") return res.sendStatus(200);

    const metadata = event.payload?.metadata;
    if (!metadata?.userId) return res.sendStatus(200);

    const { userId, type, plan, listingId } = metadata;

    const userRef = db.collection("users").doc(userId);

    /* =====================================================
       1. SUBSCRIPTION SYSTEM (NETFLIX STYLE)
    ===================================================== */

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
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    /* =====================================================
       2. VERIFIED SELLER
    ===================================================== */

    if (type === "verify_seller") {
      await userRef.set(
        {
          verified: true,
          verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    /* =====================================================
       3. FEATURE LISTING (PLAN CHECK READY)
    ===================================================== */

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
   🔥 BACKEND PROTECTION (PLAN CHECK MIDDLEWARE)
========================================================= */

const canPostListing = async (userId) => {
  const user = await db.collection("users").doc(userId).get();
  const data = user.data();

  if (!data) return false;

  const now = new Date();
  const expiry = data.subscriptionExpires?.toDate?.();

  const inGrace = data.graceUntil?.toDate?.() > now;

  const active =
    data.subscriptionActive &&
    (expiry > now || inGrace);

  if (data.plan === "business") return true;

  if (data.plan === "hustler") return active;

  return false;
};

/* =========================================================
   FEATURE PLAN VALIDATION
========================================================= */

const canFeaturePost = async (userId) => {
  const user = await db.collection("users").doc(userId).get();
  const data = user.data();

  return data?.plan === "hustler" || data?.plan === "business";
};

/* =========================================================
   AUTO EXPIRE JOB (CALL VIA CRON DAILY)
========================================================= */

const expireUsers = async () => {
  const snap = await db.collection("users").get();

  const now = new Date();

  snap.forEach(async (doc) => {
    const u = doc.data();

    const expiry = u.subscriptionExpires?.toDate?.();

    if (expiry && expiry < now) {
      await doc.ref.update({
        subscriptionActive: false,
        plan: "free",
        downgradedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log("⬇ DOWNGRADED USER:", doc.id);
    }
  });
};

/* =========================================================
   USER STATUS (REAL-TIME READY)
========================================================= */

const checkUserStatus = async (req, res) => {
  const { userId } = req.query;

  const doc = await db.collection("users").doc(userId).get();

  return res.json(doc.data());
};

/* =========================================================
   EXPORTS
========================================================= */

module.exports = {
  createCheckout,
  handleWebhook,
  checkUserStatus,

  /* protection helpers */
  canPostListing,
  canFeaturePost,

  /* cron job */
  expireUsers,
};