const admin = require("firebase-admin");

const db = admin.firestore();

const runExpiryCheck = async () => {
  const snap = await db.collection("users").get();

  const now = new Date();

  snap.forEach(async (doc) => {
    const u = doc.data();

    const expiry = u.subscriptionExpires?.toDate?.();

    if (!expiry) return;

    if (expiry < now) {
      await doc.ref.update({
        plan: "free",
        subscriptionActive: false,
        canPost: false,
        downgradedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log("⬇ AUTO-DOWNGRADED:", doc.id);
    }
  });
};

module.exports = runExpiryCheck;