const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/auth");

const {
  sendMessage,
  getMessages,
  markAsRead,
  deleteMessage,
} = require("../controllers/messagesController");

// USER
router.post("/", verifyToken, sendMessage);

// ADMIN
router.get("/", verifyToken, getMessages);
router.put("/:id/read", verifyToken, markAsRead);
router.delete("/:id", verifyToken, deleteMessage);

module.exports = router;