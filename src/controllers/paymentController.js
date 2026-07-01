const axios = require("axios");
const admin = require("firebase-admin");
const crypto = require("crypto");

/* ================= FIREBASE ================= */

if (!admin.apps.length) {
  const privateKey =
    process.env.FIREBASE_PRIVATE_KEY
      ?.replace(/\\n/g, "\n")
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

/* ================= PLANS ================= */

const PLANS = {
  hustler: {
    listings: 15,
    featured: true,
    priority: true,
    premiumBadge: false,
  },

  business: {
    listings: 999999,
    featured: true,
    priority: true,
    premiumBadge: true,
  },
};

/* ================= HELPERS ================= */

const getExpiryDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d;
};

const verifySignature = (rawBody, signature) => {
  if (!YOCO_WEBHOOK_SECRET) return true;

  const expected = crypto
    .createHmac("sha256", YOCO_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature || "")
  );
};

/* =========================================================
   CREATE CHECKOUT
========================================================= */

const createCheckout = async (req, res) => {
  try {
    const { email, userId, type, plan, listingId } = req.body;

    if (!email || !userId || !type) {
      return res.status(400).json({ error: "Missing fields" });
    }

    let amount = 0;
    let description = "Payment";

    if (type === "subscription") {
      amount = plan === "business" ? 30000 : 15000;
      description = `${plan} subscription`;
    }

    if (type === "verify_seller") {
      amount = 9900;
      description = "Verify seller";
    }

    if (type === "feature") {
      amount = 1000;
      description = "Feature listing";
    }

    const response = await axios.post(
      "https://payments.yoco.com/api/create-checkout",
      {
        amount,
        currency: "ZAR",
        name: description,
        description,
        successUrl: `${process.env.FRONTEND_URL}/success`,
        cancelUrl: `${process.env.FRONTEND_URL}/cancel`,
      },
      {
        headers: {
          Authorization: `Bearer ${YOCO_SECRET_KEY}`,
        },
      }
    );

    const linkId = response.data.id;

    await db.collection("pendingPayments").doc(linkId).set({
      paymentLinkId: linkId,
      userId,
      email,
      type,
      plan: plan || null,
      listingId: listingId || null,
      amount,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ url: response.data.url });

  } catch (err) {
    console.error("CHECKOUT ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Checkout failed" });
  }
};

/* =========================================================
   WEBHOOK (FIXED + SAFE)
========================================================= */

const handleWebhook = async (req, res) => {
  try {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(JSON.stringify(req.body));

    const signature =
      req.headers["x-yoco-signature"] || "";

    if (!verifySignature(rawBody, signature)) {
      return res.sendStatus(401);
    }

    const event = JSON.parse(rawBody.toString());

    if (event.type !== "payment.succeeded") {
      return res.sendStatus(200);
    }

    const eventId = event.id;
    const paymentLinkId =
      event.data?.paymentLink?.id ||
      event.payload?.paymentLinkId;

    if (!eventId || !paymentLinkId) {
      return res.sendStatus(200);
    }

    /* prevent duplicates */
    const lockRef = db.collection("paymentLocks").doc(eventId);
    if ((await lockRef.get()).exists) return res.sendStatus(200);
    await lockRef.set({ done: true });

    const snap = await db.collection("pendingPayments").doc(paymentLinkId).get();
    if (!snap.exists) return res.sendStatus(200);

    const payment = snap.data();

    const userRef = db.collection("users").doc(payment.userId);

    await db.collection("payments").doc(eventId).set({
      ...payment,
      status: "paid",
      eventId,
    });

    if (payment.type === "subscription") {
      await userRef.set({
        plan: payment.plan,
        subscriptionActive: true,
        subscriptionExpires: getExpiryDate(),
        listingsLimit: PLANS[payment.plan].listings,
        featuredAccess: PLANS[payment.plan].featured,
        priorityAccess: PLANS[payment.plan].priority,
      }, { merge: true });
    }

    if (payment.type === "verify_seller") {
      await userRef.set({ verified: true }, { merge: true });
    }

    if (payment.type === "feature") {
      await db.collection("products").doc(payment.listingId).set({
        featured: true,
      }, { merge: true });
    }

    await snap.ref.delete();

    return res.sendStatus(200);

  } catch (err) {
    console.error("WEBHOOK ERROR:", err);
    return res.sendStatus(500);
  }
};

/* =========================================================
   STATUS
========================================================= */

const checkUserStatus = async (req, res) => {
  const snap = await db.collection("users").doc(req.query.userId).get();
  return res.json(snap.data() || {});
};

const getSubscription = async (req, res) => {
  const snap = await db.collection("users").doc(req.query.userId).get();
  return res.json(snap.data() || {});
};

/* =========================================================
   EXPORTS (IMPORTANT FIX)
========================================================= */

module.exports = {
  createCheckout,
  handleWebhook,
  checkUserStatus,
  getSubscription,
};