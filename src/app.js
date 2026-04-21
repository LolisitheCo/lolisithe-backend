const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use("/api/payments/webhook", express.raw({ type: "*/*" }));
app.use(express.json());

// ROUTES
const productRoutes = require("./routes/productRoutes");

app.use("/api/products", productRoutes);

const paymentRoutes = require("./routes/paymentRoutes");

app.use("/api/payments", paymentRoutes);

app.get("/", (req, res) => {
  res.send("WorldMarket API running 🚀");
});

module.exports = app;