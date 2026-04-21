const express = require("express");
const router = express.Router();

const {
  createCheckout,
  handleWebhook,
  getSubscription,
  getUserStatus,
} = require("../controllers/paymentController");

// ✅ CREATE PAYMENT
router.post("/create-checkout", createCheckout);

router.post("/webhook", handleWebhook);



// ✅ GET PLAN
router.get("/subscription", getSubscription);

// ✅ GET STATUS
router.get("/status", getUserStatus);

module.exports = router;