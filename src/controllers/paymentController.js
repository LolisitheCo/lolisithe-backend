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

// =============================
// SUB PLAN DAYS
// =============================
const SUB_DAYS = {
  starter: 30,
  pro: 30,
};

// =============================
// CREATE CHECKOUT
// =============================
const createCheckout = async (req, res) => {
  const { email, plan, userId, type, listingId } = req.body;

  let amount = 0;

  if (type === "subscription") {
    if (plan === "starter") amount = 199;
    if (plan === "pro") amount = 399;
  }

  if (type === "boost") amount = 20;

  if (!amount) {
    return res.status(400).json({ error: "Invalid payment" });
  }

  try {
    const response = await axios.post(
      "https://online.yoco.com/v1/checkout/sessions",
      {
        amount: amount * 100,
        currency: "ZAR",

        successUrl: `${FRONTEND_URL}/payment-success`,
        cancelUrl: `${FRONTEND_URL}/subscribe`,

        metadata: {
          userId,
          email,
          plan,
          type,
          listingId,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${YOCO_SECRET_KEY}`,
        },
      }
    );

    res.json({ url: response.data.redirectUrl });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Payment failed" });
  }
};

// =============================
// VERIFY WEBHOOK (REAL SECURITY)
// =============================
const verifyWebhook = (req) => {
  const signature = req.headers["webhook-signature"];
  const payload = req.body;

  const expected = crypto
    .createHmac("sha256", YOCO_WEBHOOK_SECRET)
    .update(payload)
    .digest("hex");

  if (signature !== expected) {
    throw new Error("Invalid signature");
  }
};

// =============================
// GET EXPIRY DATE
// =============================
const getExpiryDate = (plan) => {
  const days = SUB_DAYS[plan] || 30;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};

// =============================
// WEBHOOK
// =============================
const handleWebhook = async (req, res) => {
  try {
    verifyWebhook(req);

    const event = JSON.parse(req.body.toString());

    console.log("✅ Webhook:", event.type);

    const eventRef = db.collection("webhooks").doc(event.id);
    const exists = await eventRef.get();

    if (exists.exists) {
      return res.sendStatus(200);
    }

    await eventRef.set({ createdAt: new Date() });

    if (event.type === "payment.succeeded") {
      const metadata = event.data?.metadata || {};
      const { userId, plan, type, listingId } = metadata;

      const userRef = db.collection("users").doc(userId);

      // SUB
      if (type === "subscription") {
        const expiry = getExpiryDate(plan);

        await userRef.set(
          {
            plan,
            subscriptionActive: true,
            subscriptionExpires: expiry,
          },
          { merge: true }
        );
      }

      // BOOST
      if (type === "boost" && listingId) {
        await db.collection("products").doc(listingId).update({
          featured: true,
        });
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err.message);
    res.sendStatus(400);
  }
};

// =============================
// CHECK USER STATUS (AUTO EXPIRE)
// =============================
const checkUserStatus = async (req, res) => {
  const { userId } = req.query;

  const doc = await db.collection("users").doc(userId).get();

  if (!doc.exists) {
    return res.json({ plan: "free", expired: false });
  }

  const data = doc.data();

  let expired = false;

  if (data.subscriptionExpires) {
    const now = new Date();
    const exp = data.subscriptionExpires.toDate();

    if (now > exp) {
      expired = true;

      await db.collection("users").doc(userId).set(
        {
          plan: "free",
          subscriptionActive: false,
        },
        { merge: true }
      );
    }
  }

  res.json({
    plan: expired ? "free" : data.plan,
    expired,
    expiresAt: data.subscriptionExpires || null,
  });
};

module.exports = {
  createCheckout,
  handleWebhook,
  checkUserStatus,
};