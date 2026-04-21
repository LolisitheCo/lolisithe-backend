const admin = require("firebase-admin");

// 🔥 INIT FIREBASE
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

const db = admin.firestore();

/* =============================
   PLAN LIMITS
============================= */
const PLAN_LIMITS = {
  free: 2,
  starter: 10,
  pro: 999,
};

/* =============================
   GET PRODUCTS
============================= */
const getProducts = async (req, res) => {
  try {
    const snapshot = await db.collection("products").get();

    const products = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch products" });
  }
};

/* =============================
   CREATE PRODUCT (🔥 ENFORCED)
============================= */
const createProduct = async (req, res) => {
  try {
    const userId = req.user?.uid;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // 🔥 GET USER PLAN FROM FIRESTORE
    const userDoc = await db.collection("users").doc(userId).get();

    const userData = userDoc.exists ? userDoc.data() : {};
    const plan = userData.plan || "free";

    const limit = PLAN_LIMITS[plan] || 2;

    // 🔥 COUNT USER PRODUCTS
    const snapshot = await db
      .collection("products")
      .where("userId", "==", userId)
      .get();

    if (snapshot.size >= limit) {
      return res.status(403).json({
        error: `Limit reached (${limit}). Upgrade your plan 🚀`,
      });
    }

    // 🔥 CREATE PRODUCT
    const newProduct = {
      ...req.body,
      userId,
      featured: false,
      verifiedSeller: userData.verified || false,
      createdAt: new Date(),
    };

    const docRef = await db.collection("products").add(newProduct);

    res.json({
      id: docRef.id,
      ...newProduct,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create product" });
  }
};

/* =============================
   SET SUBSCRIPTION (FROM WEBHOOK)
============================= */
const setSubscription = async (req, res) => {
  try {
    const { userId, plan } = req.body;

    if (!userId || !plan) {
      return res.status(400).json({ error: "Missing data" });
    }

    await db.collection("users").doc(userId).set(
      {
        plan,
        updatedAt: new Date(),
      },
      { merge: true }
    );

    res.json({
      message: "Subscription updated",
      plan,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to update subscription" });
  }
};

module.exports = {
  getProducts,
  createProduct,
  setSubscription,
};