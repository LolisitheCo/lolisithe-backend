const admin = require("firebase-admin");

// 🔐 AUTH MIDDLEWARE
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // ❌ NO TOKEN
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized: No token" });
    }

    const token = authHeader.split("Bearer ")[1];

    // ✅ VERIFY FIREBASE TOKEN
    const decoded = await admin.auth().verifyIdToken(token);

    // 🔥 ATTACH BASIC USER
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
    };

    // 🔥 FETCH USER FROM FIRESTORE
    const userDoc = await admin
      .firestore()
      .collection("users")
      .doc(decoded.uid)
      .get();

    if (userDoc.exists) {
      const data = userDoc.data();

      // 🔥 HANDLE SUBSCRIPTION EXPIRY
      let plan = "free";

      if (
        data.subscription &&
        data.subscription.expiresAt &&
        new Date(data.subscription.expiresAt) > new Date()
      ) {
        plan = data.subscription.plan;
      }

      req.user = {
        ...req.user,
        plan,
        verified: data.verified || false,
        isAdmin:
          decoded.email === process.env.ADMIN_EMAIL, // 🔥 secure admin
      };
    } else {
      // 🔥 DEFAULT USER (FIRST TIME LOGIN)
      req.user = {
        ...req.user,
        plan: "free",
        verified: false,
        isAdmin: false,
      };
    }

    next();
  } catch (error) {
    console.error("Auth error:", error.message);
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};

module.exports = verifyToken;