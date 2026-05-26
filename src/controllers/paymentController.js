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

        amount = 15000;

        description =
          "Hustler Plan";
      }

      if (plan === "business") {

        amount = 30000;

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
          amount: {
            amount,
            currency: "ZAR",
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

const handleWebhook = async (
  req,
  res
) => {

  try {

    let event =
      Buffer.isBuffer(req.body)
        ? JSON.parse(
            req.body.toString("utf8")
          )
        : req.body;

    console.log(
      "🔥 WEBHOOK:",
      JSON.stringify(
        event,
        null,
        2
      )
    );

    const eventId =
      event.id ||
      event.payload?.id;

    if (!eventId) {

      return res.sendStatus(200);
    }

    /* ================= PREVENT DUPLICATES ================= */

    const webhookRef =
      db.collection("webhooks")
        .doc(eventId);

    const exists =
      await webhookRef.get();

    if (exists.exists) {

      return res.sendStatus(200);
    }

    await webhookRef.set({

      createdAt:
        admin.firestore.FieldValue.serverTimestamp(),
    });

    /* ================= ONLY SUCCESS PAYMENTS ================= */

    if (
      event.type !==
      "payment.succeeded"
    ) {

      return res.sendStatus(200);
    }

    /* ================= PAYMENT LINK ID ================= */

    const paymentLinkId =

      event.payload
        ?.paymentLinkId ||

      event.payload
        ?.payment_link_id ||

      event.payload?.id;

    if (!paymentLinkId) {

      console.log(
        "❌ Missing payment link id"
      );

      return res.sendStatus(200);
    }

    /* ================= FIND PENDING PAYMENT ================= */

    const pendingSnap =
      await db
        .collection(
          "pendingPayments"
        )
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

    const {
      userId,
      type,
      plan,
      listingId,
      email,
      amount,
    } = paymentData;

    const userRef =
      db.collection("users")
        .doc(userId);

    /* ================= SAVE PAYMENT ================= */

    await db
      .collection("payments")
      .doc(eventId)
      .set({

        userId,

        email,

        type,

        plan:
          plan || null,

        listingId:
          listingId || null,

        amount,

        createdAt:
          admin.firestore.FieldValue.serverTimestamp(),
      });

    /* ================= SUBSCRIPTIONS ================= */

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

    /* ================= VERIFIED SELLER ================= */

    if (
      type === "verify_seller"
    ) {

      await userRef.set(

        {

          verified: true,

          verifiedAt:
            admin.firestore.FieldValue.serverTimestamp(),

          verificationSource:
            "yoco",
        },

        { merge: true }
      );

      console.log(
        "✅ USER VERIFIED"
      );
    }

    /* ================= FEATURE LISTING ================= */

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

    /* ================= REMOVE PENDING PAYMENT ================= */

    await pendingDoc.ref.delete();

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
   EXPORTS
========================================================= */

module.exports = {

  createCheckout,

  handleWebhook,

  checkUserStatus,
};