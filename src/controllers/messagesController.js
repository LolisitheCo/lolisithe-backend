const admin = require("firebase-admin");

const db = admin.firestore();

// =============================
// SEND MESSAGE (USER → ADMIN)
// =============================
const sendMessage = async (req, res) => {
  try {
    // 🔐 REQUIRE AUTH
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { subject, message } = req.body;

    // ❌ VALIDATION
    if (!subject || !message) {
      return res.status(400).json({
        error: "Subject and message are required",
      });
    }

    if (message.length < 5) {
      return res.status(400).json({
        error: "Message too short",
      });
    }

    // ✅ CREATE MESSAGE
    const newMessage = {
      userId: req.user.uid,
      email: req.user.email,
      subject,
      message,
      createdAt: new Date(),
      read: false, // 🔥 unread badge support
    };

    // 🔥 SAVE TO FIRESTORE
    const docRef = await db.collection("messages").add(newMessage);

    res.json({
      success: true,
      id: docRef.id,
    });
  } catch (error) {
    console.error("Send message error:", error);
    res.status(500).json({ error: "Failed to send message" });
  }
};

// =============================
// ADMIN: GET ALL MESSAGES
// =============================
const getMessages = async (req, res) => {
  try {
    // 🔐 ADMIN ONLY
    if (!req.user?.isAdmin) {
      return res.status(403).json({
        error: "Admin access only",
      });
    }

    const snapshot = await db
      .collection("messages")
      .orderBy("createdAt", "desc")
      .get();

    const messages = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json(messages);
  } catch (error) {
    console.error("Fetch messages error:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
};

// =============================
// ADMIN: MARK AS READ
// =============================
const markAsRead = async (req, res) => {
  try {
    if (!req.user?.isAdmin) {
      return res.status(403).json({
        error: "Admin access only",
      });
    }

    const { id } = req.params;

    await db.collection("messages").doc(id).update({
      read: true,
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Mark read error:", error);
    res.status(500).json({ error: "Failed to update message" });
  }
};

// =============================
// ADMIN: DELETE MESSAGE
// =============================
const deleteMessage = async (req, res) => {
  try {
    if (!req.user?.isAdmin) {
      return res.status(403).json({
        error: "Admin access only",
      });
    }

    const { id } = req.params;

    await db.collection("messages").doc(id).delete();

    res.json({ success: true });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({ error: "Failed to delete message" });
  }
};

module.exports = {
  sendMessage,
  getMessages,
  markAsRead,
  deleteMessage,
};