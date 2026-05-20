const axios = require("axios");
const admin = require("firebase-admin");
const crypto = require("crypto");

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

const YOCO_SECRET_KEY = process.env.YOCO_SECRET_KEY;
const YOCO_WEBHOOK_SECRET =
  process.env.YOCO_WEBHOOK_SECRET;

const FRONTEND_URL =
  "https://lolisitheco.co.za";

/* ===================================== */
/* SUBSCRIPTION DAYS */
/* ===================================== */

const SUB_DAYS = {
  hustler: 30,
  business: 30,
};

/* ===================================== */
/* CREATE CHECKOUT */
/* ===================================== */

const createCheckout = async (req, res) => {
  try {

    console.log("REQ BODY:", req.body);

    const {
      email,
      plan,
      userId,
      type,
      listingId,
    } = req.body;

    if (!email || !userId || !type) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    let amount = 0;
    let name = "";

    /* ================= SUBSCRIPTIONS ================= */

    if (type === "subscription") {

      if (plan === "hustler") {
        amount = 19900;
        name = "Hustler Plan";
      }

      else if (plan === "business") {
        amount = 39900;
        name = "Business Plan";
      }

      else {
        return res.status(400).json({
          error: "Invalid plan",
        });
      }
    }

    /* ================= VERIFIED ================= */

    else if (type === "verify_seller") {
      amount = 10000;
      name = "Verified Seller";
    }

    /* ================= FEATURED ================= */

    else if (type === "feature") {
      amount = 1000;
      name = "Featured Listing";
    }

    /* ================= INVALID ================= */

    else {
      return res.status(400).json({
        error: "Invalid payment",
      });
    }

    /* ===================================== */
    /* YOCO CHECKOUT */
    /* ===================================== */

    const response = await axios.post(
  "https://payments.yoco.com/api/checkouts/sessions",
  {
    amount,
    currency: "ZAR",

    successUrl: `${FRONTEND_URL}/payment-success`,

    cancelUrl: `${FRONTEND_URL}/subscribe`,

    metadata: {
      userId,
      email,
      plan: plan || null,
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

    console.log(
      "✅ YOCO RESPONSE:",
      response.data
    );

    return res.json({
      url:
        response.data.redirectUrl,
    });

  } catch (err) {

    console.error(
      "❌ YOCO ERROR:",
      err.response?.data || err.message
    );

    return res.status(500).json({
      error:
        err.response?.data ||
        "Payment failed",
    });
  }
};

/* ===================================== */
/* VERIFY WEBHOOK */
/* ===================================== */

const verifyWebhook = (req) => {

  const signature =
    req.headers["webhook-signature"];

  const expected = crypto
    .createHmac(
      "sha256",
      YOCO_WEBHOOK_SECRET
    )
    .update(req.body)
    .digest("hex");

  if (signature !== expected) {
    throw new Error(
      "Invalid webhook signature"
    );
  }
};

/* ===================================== */
/* GET EXPIRY DATE */
/* ===================================== */

const getExpiryDate = (plan) => {

  const days =
    SUB_DAYS[plan] || 30;

  const d = new Date();

  d.setDate(
    d.getDate() + days
  );

  return d;
};

/* ===================================== */
/* HANDLE WEBHOOK */
/* ===================================== */

const handleWebhook = async (
  req,
  res
) => {

  try {

    verifyWebhook(req);

    const event = JSON.parse(
      req.body.toString()
    );

    console.log(
      "🔥 WEBHOOK:",
      event
    );

    const eventRef =
      db.collection("webhooks")
        .doc(event.id);

    const exists =
      await eventRef.get();

    if (exists.exists) {
      return res.sendStatus(200);
    }

    await eventRef.set({
      createdAt: new Date(),
    });

    if (
      event.type !==
      "payment.succeeded"
    ) {
      return res.sendStatus(200);
    }

    const metadata =
      event.payload?.metadata ||
      event.data?.metadata;

    if (!metadata) {

      console.log(
        "⚠️ No metadata"
      );

      return res.sendStatus(200);
    }

    const {
      userId,
      plan,
      type,
      listingId,
    } = metadata;

    const userRef =
      db.collection("users")
        .doc(userId);

    /* ================= SUBSCRIPTION ================= */

    if (type === "subscription") {

      await userRef.set(
        {
          plan,

          subscriptionActive: true,

          subscriptionExpires:
            getExpiryDate(plan),
        },
        { merge: true }
      );
    }

    /* ================= VERIFIED ================= */

    if (type === "verify_seller") {

      await userRef.set(
        {
          verified: true,
        },
        { merge: true }
      );
    }

    /* ================= FEATURED ================= */

    if (
      type === "feature" &&
      listingId
    ) {

      await db
        .collection("products")
        .doc(listingId)
        .set(
          {
            featured: true,
            featuredAt: new Date(),
          },
          { merge: true }
        );
    }

    return res.sendStatus(200);

  } catch (err) {

    console.error(
      "❌ WEBHOOK ERROR:",
      err.message
    );

    return res.sendStatus(400);
  }
};

/* ===================================== */
/* CHECK USER STATUS */
/* ===================================== */

const checkUserStatus = async (
  req,
  res
) => {

  try {

    const { userId } =
      req.query;

    if (!userId) {

      return res.status(400).json({
        error: "Missing userId",
      });
    }

    const userDoc =
      await db
        .collection("users")
        .doc(userId)
        .get();

    if (!userDoc.exists) {

      return res.status(404).json({
        error: "User not found",
      });
    }

    return res.json(
      userDoc.data()
    );

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error:
        "Failed to fetch status",
    });
  }
};

module.exports = {
  createCheckout,
  handleWebhook,
  checkUserStatus,
};