const axios = require("axios");
const admin = require("firebase-admin");
const crypto = require("crypto");

/* ===================================== */
/* FIREBASE ADMIN */
/* ===================================== */

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,

      clientEmail:
        process.env.FIREBASE_CLIENT_EMAIL,

      privateKey:
        process.env.FIREBASE_PRIVATE_KEY
          ? process.env.FIREBASE_PRIVATE_KEY.replace(
          /\\n/g,
          "\n"
        )
        : undefined,
    }),
  });
}

const db = admin.firestore();

/* ===================================== */
/* ENV VARIABLES */
/* ===================================== */

const YOCO_SECRET_KEY =
  process.env.YOCO_SECRET_KEY;

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
/* GET EXPIRY DATE */
/* ===================================== */

const getExpiryDate = (plan) => {

  const days =
    SUB_DAYS[plan] || 30;

  const expiry = new Date();

  expiry.setDate(
    expiry.getDate() + days
  );

  return expiry;
};

/* ===================================== */
/* CREATE YOCO CHECKOUT */
/* ===================================== */

const createCheckout = async (
  req,
  res
) => {

  try {

    console.log(
      "📦 PAYMENT REQUEST:",
      req.body
    );

    const {
      email,
      plan,
      userId,
      type,
      listingId,
    } = req.body;

    /* ===================================== */
    /* VALIDATION */
    /* ===================================== */

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

    let name = "";

    /* ===================================== */
    /* SUBSCRIPTIONS */
    /* ===================================== */

    if (type === "subscription") {

      if (plan === "hustler") {

        amount = 19900;

        name = "Hustler Plan";
      }

      else if (
        plan === "business"
      ) {

        amount = 39900;

        name = "Business Plan";
      }

      else {

        return res.status(400).json({
          error: "Invalid plan",
        });
      }
    }

    /* ===================================== */
    /* VERIFIED SELLER */
    /* ===================================== */

    else if (
      type === "verify_seller"
    ) {

      amount = 10000;

      name = "Verified Seller";
    }

    /* ===================================== */
    /* FEATURED LISTING */
    /* ===================================== */

    else if (type === "feature") {

      amount = 1000;

      name = "Featured Listing";
    }

    /* ===================================== */
    /* INVALID TYPE */
    /* ===================================== */

    else {

      return res.status(400).json({
        error:
          "Invalid payment type",
      });
    }

    /* ===================================== */
    /* CREATE YOCO CHECKOUT */
    /* ===================================== */

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

          plan:
            plan || null,

          type,

          listingId:
            listingId || null,
        },
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
      url:
        response.data.redirectUrl,
    });

  } catch (err) {

    console.error(
      "❌ YOCO ERROR:",
      err.response?.data ||
      err.message
    );

    return res.status(500).json({
      error:
        err.response?.data ||
        err.message,
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
      "🔥 YOCO WEBHOOK:",
      event
    );

    /* ===================================== */
    /* PREVENT DUPLICATES */
    /* ===================================== */

    const eventRef =
      db.collection("webhooks")
        .doc(event.id);

    const existing =
      await eventRef.get();

    if (existing.exists) {

      return res.sendStatus(200);
    }

    await eventRef.set({
      createdAt: new Date(),
    });

    /* ===================================== */
    /* ONLY HANDLE SUCCESS */
    /* ===================================== */

    if (
      event.type !==
      "payment.succeeded"
    ) {

      return res.sendStatus(200);
    }

    /* ===================================== */
    /* GET METADATA */
    /* ===================================== */

    const metadata =
      event.payload?.metadata ||
      event.data?.metadata;

    if (!metadata) {

      console.log(
        "⚠️ No metadata found"
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

    /* ===================================== */
    /* SUBSCRIPTIONS */
    /* ===================================== */

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

    /* ===================================== */
    /* VERIFIED SELLER */
    /* ===================================== */

    if (
      type === "verify_seller"
    ) {

      await userRef.set(
        {
          verified: true,
        },

        { merge: true }
      );
    }

    /* ===================================== */
    /* FEATURED LISTING */
    /* ===================================== */

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
              new Date(),
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

    console.error(
      "❌ STATUS ERROR:",
      err
    );

    return res.status(500).json({
      error:
        "Failed to fetch user status",
    });
  }
};

/* ===================================== */
/* EXPORTS */
/* ===================================== */

module.exports = {
  createCheckout,
  handleWebhook,
  checkUserStatus,
};