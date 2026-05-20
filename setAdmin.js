const admin = require("firebase-admin");
require("dotenv").config();

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const ADMIN_EMAIL = "sivuyilematras@gmail.com";

async function setAdmin() {
  try {
    const user = await admin.auth().getUserByEmail(ADMIN_EMAIL);

    await admin.auth().setCustomUserClaims(user.uid, {
      admin: true,
      role: "superAdmin",
    });

    console.log("✅ Admin granted to:", ADMIN_EMAIL);
    process.exit(0);
  } catch (err) {
    console.error("❌ Error setting admin:", err.message);
    process.exit(1);
  }
}

setAdmin();