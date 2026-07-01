const axios = require("axios");
const admin = require("firebase-admin");

/* ================= FIREBASE INIT ================= */

if (!admin.apps.length) {

  const privateKey =
    process.env.FIREBASE_PRIVATE_KEY
      ?.replace(/\\n/g, "\n")
      .replace(/^"|"$/g, "");

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:
        process.env.FIREBASE_PROJECT_ID,

      clientEmail:
        process.env.FIREBASE_CLIENT_EMAIL,

      privateKey,
    }),
  });
}

const db = admin.firestore();

/* ================= CONFIG ================= */

const YOCO_SECRET_KEY =
  process.env.YOCO_SECRET_KEY;

/* ================= PLANS ================= */

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

  d.setDate(
    d.getDate() +
      (SUB_DAYS[plan] || 30)
  );

  return d;
};

const getGraceDate = (expiry) => {

  const d = new Date(expiry);

  d.setDate(
    d.getDate() + GRACE_DAYS
  );

  return d;
};

const isValidPlan = (plan) =>
  ["hustler", "business"]
    .includes(plan);

/* =========================================================
   CREATE CHECKOUT
========================================================= */

const createCheckout = async (
  req,
  res
) => {

  try {

    const {
      email,
      plan,
      userId,
      type,
      listingId,
    } = req.body;

    if (
      !email ||
      !userId ||
      !type
    ) {

      return res.status(400).json({
        error: "Missing fields",
      });
    }

    let amount = 0;

    let description =
      "Marketplace Payment";

    /* ================= SUBSCRIPTIONS ================= */

    if (type === "subscription") {

      if (!isValidPlan(plan)) {

        return res.status(400).json({
          error: "Invalid plan",
        });
      }

      if (plan === "hustler") {

        amount = 19900;

        description =
          "Hustler Plan";
      }

      if (plan === "business") {

        amount = 39900;

        description =
          "Business Plan";
      }
    }

    /* ================= VERIFIED ================= */

    if (type === "verify_seller") {

      amount = 9900;

      description =
        "Verified Seller Badge";
    }

    /* ================= FEATURE ================= */

    if (type === "feature") {

      amount = 1000;

      description =
        "Featured Listing";
    }

    /* ================= YOCO ================= */

    const response =
      await axios.post(

        "https://api.yoco.com/v1/payment_links/",

        {
          amount: amount,
          currency: "ZAR",
          successUrl: "https://lolisitheco.co.za/success",
          cancelUrl: "https://lolisitheco.co.za/cancel",
           metadata: {
      userId,
      plan,
      type,
    },
  

          customer_reference:
            email,

          customer_description:
            description,
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
      "✅ YOCO PAYMENT LINK:",
      response.data
    );

    /* ================= SAVE PENDING PAYMENT ================= */

    await db
      .collection(
        "pendingPayments"
      )
      .add({

        paymentLinkId:
          response.data.id,

        userId,

        email,

        type,

        plan:
          plan || null,

        listingId:
          listingId || null,

        amount,

        status: "pending",

        createdAt:
          admin.firestore.FieldValue.serverTimestamp(),
      });

    /* ================= RETURN URL ================= */

    return res.json({
      url: response.data.url,
    });

  } catch (err) {

    console.error(
      "❌ CREATE CHECKOUT ERROR:",
      err.response?.data ||
        err.message
    );

    return res.status(500).json({
      error: "Checkout failed",
    });
  }
};

/* =========================================================
   WEBHOOK
========================================================= */

const handleWebhook = async (req, res) => {
  try {
    const event = Buffer.isBuffer(req.body)
      ? JSON.parse(req.body.toString("utf8"))
      : req.body;

    console.log(
      "🔥 WEBHOOK RECEIVED:",
      JSON.stringify(event, null, 2)
    );

    /* ================= EVENT ID ================= */

    const eventId =
      event.id ||
      event.payload?.id ||
      `evt_${Date.now()}`;

    /* ================= PREVENT DUPLICATES ================= */

    const webhookRef =
      db.collection("webhooks").doc(eventId);

    const existingWebhook =
      await webhookRef.get();

      const webhookRef = db.collection("webhooks").doc(paymentLinkId);

    if (existingWebhook.exists) {
      console.log("⚠️ Duplicate webhook");

      return res.sendStatus(200);
    }

    await webhookRef.set({
      createdAt:
        admin.firestore.FieldValue.serverTimestamp(),
    });

    /* ================= ONLY SUCCESS ================= */

    if (
      event.type !== "payment.succeeded"
    ) {
      console.log("⚠️ Ignored event:", event.type);

      return res.sendStatus(200);
    }

    /* ================= FIND PAYMENT LINK ID ================= */

    const paymentLinkId =
      event.payload?.paymentLinkId ||
      event.payload?.payment_link_id ||

      event.payload?.paymentLink?.id ||
      event.payload?.payment_link?.id ||

      event.payload?.payment?.paymentLinkId ||
      event.payload?.payment?.payment_link_id ||

      event.payload?.payment?.paymentLink?.id ||
      event.payload?.payment?.payment_link?.id ||

      null;

    console.log(
      "🔥 PAYMENT LINK ID:",
      paymentLinkId
    );

    if (!paymentLinkId) {
      console.log(
        "❌ No payment link id found"
      );

      return res.sendStatus(200);
    }

    /* ================= FIND PENDING PAYMENT ================= */

    const pendingSnap = await db
      .collection("pendingPayments")
      .where(
        "paymentLinkId",
        "==",
        paymentLinkId
      )
      .limit(1)
      .get();

    if (pendingSnap.empty) {
      console.log(
        "❌ Pending payment not found"
      );

      return res.sendStatus(200);
    }

    const pendingDoc =
      pendingSnap.docs[0];

    const paymentData =
      pendingDoc.data();

    console.log(
      "🔥 PAYMENT DATA:",
      paymentData
    );

    const {
      userId,
      type,
      plan,
      listingId,
      email,
      amount,
    } = paymentData;

    const userRef =
      db.collection("users").doc(userId);

    /* ================= SAVE PAYMENT ================= */

    await db
      .collection("payments")
      .doc(eventId)
      .set({
        userId,
        email,
        type,
        plan: plan || null,
        listingId:
          listingId || null,
        amount,

        createdAt:
          admin.firestore.FieldValue.serverTimestamp(),
      });

    /* =====================================================
       SUBSCRIPTIONS
    ===================================================== */

    if (type === "subscription") {
      const expiry =
        getExpiryDate(plan);

      await userRef.set(
        {
          plan,

          subscriptionActive: true,

          subscriptionExpires:
            expiry,

          graceUntil:
            getGraceDate(expiry),

          canPost: true,

          isPremium:
            plan === "business",

          listingsLimit:
            PLANS[plan].listings,

          featuredAccess:
            PLANS[plan].featured,

          priorityAccess:
            PLANS[plan].priority,

          lastPaymentAt:
            admin.firestore.FieldValue.serverTimestamp(),

          updatedAt:
            admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      console.log(
        "✅ SUBSCRIPTION UPDATED"
      );
    }

    /* =====================================================
       VERIFIED SELLER
    ===================================================== */

    if (
      type === "verify_seller" ||
      type === "verification"
    ) {
      await userRef.set(
        {
          verified: true,

          verifiedAt:
            admin.firestore.FieldValue.serverTimestamp(),

          verificationSource:
            "yoco",

          updatedAt:
            admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      console.log(
        "✅ USER VERIFIED:",
        userId
      );
    }

    /* =====================================================
       FEATURED LISTING
    ===================================================== */

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

            featuredAt:
              admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

      console.log(
        "✅ LISTING FEATURED"
      );
    }

    /* ================= DELETE PENDING PAYMENT ================= */

    await pendingDoc.ref.delete();

    console.log(
      "✅ PAYMENT COMPLETED SUCCESSFULLY"
    );

    return res.sendStatus(200);

  } catch (err) {
    console.error(
      "❌ WEBHOOK ERROR:",
      err
    );

    return res.sendStatus(400);
  }
};

/* =========================================================
   USER STATUS
========================================================= */

const checkUserStatus = async (
  req,
  res
) => {

  try {

    const { userId } =
      req.query;

    if (!userId) {

      return res.status(400).json({
        error:
          "Missing userId",
      });
    }

    const snap =
      await db
        .collection("users")
        .doc(userId)
        .get();

    return res.json(
      snap.data() || {}
    );

  } catch (err) {

    return res.status(500).json({
      error:
        "Failed to fetch user",
    });
  }
};

/* =========================================================
   GET SUBSCRIPTION
========================================================= */

const getSubscription = async (
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

    const snap =
      await db
        .collection("users")
        .doc(userId)
        .get();

    if (!snap.exists) {

      return res.status(404).json({
        error: "User not found",
      });
    }

    const data = snap.data();

    return res.json({

      plan:
        data.plan || "free",

      subscriptionActive:
        data.subscriptionActive || false,

      subscriptionExpires:
        data.subscriptionExpires || null,

      verified:
        data.verified || false,

      listingsLimit:
        data.listingsLimit || 2,

      featuredAccess:
        data.featuredAccess || false,

      priorityAccess:
        data.priorityAccess || false,
    });

  } catch (err) {

    console.error(
      "GET SUBSCRIPTION ERROR:",
      err
    );

    return res.status(500).json({
      error:
        "Failed to fetch subscription",
    });
  }
};

/* =========================================================
   EXPORTS
========================================================= */

module.exports = {

  createCheckout,

  handleWebhook,

  checkUserStatus,

  getSubscription,
};