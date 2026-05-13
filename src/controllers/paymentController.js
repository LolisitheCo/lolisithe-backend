const axios = require("axios");
const admin = require("firebase-admin");
const crypto = require("crypto");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

const db = admin.firestore();

const YOCO_SECRET_KEY = process.env.YOCO_SECRET_KEY;
const YOCO_WEBHOOK_SECRET = process.env.YOCO_WEBHOOK_SECRET;
const FRONTEND_URL = "https://lolisitheco.co.za";

/* ============================= */
/* 📅 PLAN CONFIG */
/* ============================= */
const SUB_DAYS = {
  hustler: 30,
  business: 30,
};

/* ============================= */
/* 💳 CREATE CHECKOUT */
/* ============================= */
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

    /* ============================= */
    /* SUBSCRIPTIONS */
    /* ============================= */

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

    /* ============================= */
    /* VERIFIED SELLER */
    /* ============================= */

    else if (
      type === "verify_seller"
    ) {
      amount = 10000;
      name = "Verified Seller";
    }

    /* ============================= */
    /* FEATURED LISTING */
    /* ============================= */

    else if (type === "feature") {
      amount = 1000;
      name = "Featured Listing";
    }

    /* ============================= */
    /* INVALID */
    /* ============================= */

    else {
      return res.status(400).json({
        error: "Invalid payment",
      });
    }

    /* ============================= */
    /* CREATE YOCO CHECKOUT */
    /* ============================= */

    const response = await axios.post(
      "https://payments.yoco.com/api/checkouts",

      {
        amount,
        currency: "ZAR",

        successUrl:
          `${FRONTEND_URL}/payment-success`,

        cancelUrl:
          `${FRONTEND_URL}/subscribe`,

        metadata: {
          userId,
          email,
          plan: plan || null,
          type,
          listingId:
            listingId || null,
        },

        items: [
          {
            name,
            quantity: 1,
            amount,
          },
        ],
      },

      {
        headers: {
          Authorization:
            `Bearer ${YOCO_SECRET_KEY}`,

          "Content-Type":
            "application/json",
        },
      }
    );

    console.log(
      "✅ YOCO RESPONSE:",
      response.data
    );

    return res.json({
      url: response.data.redirectUrl,
    });

  } catch (err) {

    console.error(
      "❌ YOCO ERROR:",
      err.response?.data ||
      err.message
    );

    return res.status(500).json({
      error: "Payment failed",
    });
  }
};
/* ============================= */
/* 🔐 VERIFY WEBHOOK SIGNATURE */
/* ============================= */
const verifyWebhook = (req) => {
  const signature = req.headers["webhook-signature"];

  const expected = crypto
    .createHmac("sha256", YOCO_WEBHOOK_SECRET)
    .update(req.body)
    .digest("hex");

  if (signature !== expected) {
    throw new Error("Invalid webhook signature");
  }
};

/* ============================= */
/* 📅 GET EXPIRY DATE */
/* ============================= */
const getExpiryDate = (plan) => {
  const days = SUB_DAYS[plan] || 30;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};

/* ============================= */
/* 🔔 HANDLE WEBHOOK */
/* ============================= */
const handleWebhook = async (req, res) => {
  try {
    // 🔐 verify signature
    verifyWebhook(req);

    const event = JSON.parse(req.body.toString());

    // 🛑 prevent duplicate processing
    const eventRef = db.collection("webhooks").doc(event.id);
    const exists = await eventRef.get();

    if (exists.exists) return res.sendStatus(200);

    await eventRef.set({ createdAt: new Date() });

    // ✅ only process successful payments
    if (event.type !== "payment.succeeded") {
      return res.sendStatus(200);
    }

    const metadata = event.data?.metadata;

    if (!metadata) {
      console.log("⚠️ No metadata found");
      return res.sendStatus(200);
    }

    const { userId, plan, type, listingId } = metadata;

    console.log("🔥 PAYMENT SUCCESS:", metadata);

    const userRef = db.collection("users").doc(userId);

    /* ================= SUBSCRIPTION ================= */
    if (type === "subscription") {
      await userRef.set(
        {
          plan,
          subscriptionActive: true,
          subscriptionExpires: getExpiryDate(plan),
        },
        { merge: true }
      );
    }

    /* ================= VERIFY ================= */
    if (type === "verify_seller") {
      await userRef.set(
        { verified: true },
        { merge: true }
      );
    }

    /* ================= FEATURE ================= */
    if (type === "feature" && listingId) {
      await db.collection("products").doc(listingId).set(
        {
          featured: true,
          featuredAt: new Date(),
        },
        { merge: true }
      );
    }

    res.sendStatus(200);

  } catch (err) {
    console.error("❌ Webhook error:", err.message);
    res.sendStatus(400);
  }
};

/* ============================= */
/* 📊 CHECK USER STATUS */
/* ============================= */
const checkUserStatus = async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    const userDoc = await db.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(userDoc.data());
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Failed to fetch user status" });
  }
};

module.exports = {
  createCheckout,
  handleWebhook,
  checkUserStatus,
};