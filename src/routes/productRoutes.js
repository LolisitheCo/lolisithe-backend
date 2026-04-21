const express = require("express");
const router = express.Router();

const {
  getProducts,
  createProduct,
  setSubscription,
} = require("../controllers/productController");

router.get("/", getProducts);
router.post("/", createProduct);

router.post("/subscribe", setSubscription);

module.exports = router;