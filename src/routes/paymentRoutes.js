const express = require("express");

const router = express.Router();

const {
  createCheckout,
  handleWebhook,
  checkUserStatus,
  getSubscription,
} = require("../controllers/paymentController");

/* =========================================
   CREATE CHECKOUT
========================================= */

router.post(
  "/create-checkout",
  createCheckout
);

/* =========================================
   YOCO WEBHOOK
========================================= */

router.post(
  "/webhook",
  express.raw({
    type: "application/json",
  }),
  handleWebhook
);

/* =========================================
   GET USER SUBSCRIPTION
========================================= */

router.get(
  "/subscription",
  getSubscription
);

/* =========================================
   GET USER STATUS
========================================= */

router.get(
  "/status",
  checkUserStatus
);

module.exports = router;