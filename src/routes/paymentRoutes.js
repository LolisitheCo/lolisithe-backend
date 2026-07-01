const express = require("express");
const router = express.Router();

const {
  createCheckout,
  handleWebhook,
  checkUserStatus,
  getSubscription,
} = require("../controllers/paymentController");

const verifyToken = require("../middleware/verifyToken");

/* ================= CREATE CHECKOUT ================= */
router.post(
  "/create-checkout",   // ✅ FIXED (THIS IS WHAT FRONTEND USES)
  verifyToken,
  createCheckout
);

/* ================= YOCO WEBHOOK ================= */
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  handleWebhook
);

/* ================= SUBSCRIPTION ================= */
router.get(
  "/subscription",
  verifyToken,
  getSubscription
);

/* ================= USER STATUS ================= */
router.get(
  "/status",
  verifyToken,
  checkUserStatus
);

module.exports = router;