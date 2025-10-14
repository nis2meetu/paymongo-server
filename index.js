require("dotenv").config(); // must be at the very top
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const path = require("path");
const app = express();
const fetch = require("node-fetch");



const OpenAI = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


// Load service account key
const serviceAccount = require(path.join(__dirname, "serviceAccountKey.json"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://dbcodeventures.firebaseio.com"
});

const db = admin.firestore();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());

// ✅ Health check
app.get("/", (req, res) => {
  res.send("Express + Firebase server running 🚀");
});

// ✅ Admin login
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password required" });
    }

    const snapshot = await db
      .collection("users")
      .where("email", "==", email)
      .where("password_hash", "==", password) // 🔑 Use bcrypt in production
      .get();

    if (snapshot.empty) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();

    res.json({
      success: true,
      message: "Login successful",
      user: {
        id: userDoc.id,
        email: userData.email,
        role: userData.role || "user"
      }
    });

  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});



const gameModeRoutes = require("./gameMode"); // <-- use gameMode.js
app.use("/api/game", gameModeRoutes);


const paymongoRoutes = require("./paymongo"); // <-- use paymongo.js
app.use("/api/paymongo", paymongoRoutes);


const notifRoutes = require("./notif");
app.use("/api/notifications", notifRoutes);

const itemRoutes = require("./item");
app.use("/api/items", itemRoutes);

const offerRoutes = require("./offer");
app.use("/api/offers", offerRoutes);

const feedbackRoutes = require("./feedback"); // import routes
app.use("/api/feedback", feedbackRoutes);


const playersRoutes = require("./players");
app.use("/api/players", playersRoutes);



app.listen(5000, "0.0.0.0", () => console.log("Server running on all interfaces"));



app.get("/users/players", async (req, res) => {
  try {
    const playersDocRef = db.collection("users").doc("players");
    const uidCollections = await playersDocRef.listCollections();

    // 🔹 Collect promises for all player data
    const playerPromises = uidCollections.map(async (uidCollection) => {
      const [infoDoc, progressDoc, inventoryDoc] = await Promise.all([
        uidCollection.doc("info").get(),
        uidCollection.doc("progress").get(),
        uidCollection.doc("inventory").get(),
      ]);

      return {
        id: uidCollection.id,
        info: infoDoc.exists ? infoDoc.data() : {},
        progress: progressDoc.exists ? progressDoc.data() : {},
        inventory: inventoryDoc.exists ? inventoryDoc.data() : {},
      };
    });

    // 🔹 Resolve all promises at once
    const players = await Promise.all(playerPromises);

    res.json(players);
  } catch (err) {
    console.error("Error fetching players:", err);
    res.status(500).json({ error: err.message });
  }
});


const nodemailer = require("nodemailer");
// Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// --- Send verification code ---
app.post("/admin/forgot-password", async (req, res) => {
  try {
    const senderEmail = process.env.GMAIL_USER;
    const receiverEmail = "codeventurers3@gmail.com"; // admin receiver

    const verificationCode = Math.floor(100000 + Math.random() * 900000);

    const mailOptions = {
      from: senderEmail,
      to: receiverEmail,
      subject: "Admin Password Reset Verification Code",
      text: `Hello! Your verification code is: ${verificationCode}`,
    };

    await transporter.sendMail(mailOptions);

    await db.collection("admin_password_resets").doc("admin").set({
      code: verificationCode,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, message: "Verification code sent!" });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({ success: false, message: "Failed to send code" });
  }
});

// --- Verify code ---
app.post("/admin/verify-code", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, message: "Code required" });

    const docSnap = await db.collection("admin_password_resets").doc("admin").get();
    if (!docSnap.exists) return res.status(400).json({ success: false, message: "No code found" });

    const storedCode = docSnap.data().code;
    if (storedCode.toString() === code.toString()) {
      res.json({ success: true, message: "Code verified" });
    } else {
      res.status(401).json({ success: false, message: "Incorrect code" });
    }
  } catch (err) {
    console.error("Verify code error:", err);
    res.status(500).json({ success: false, message: "Failed to verify code" });
  }
});

app.post("/admin/change-password", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ success: false, message: "Email and password required" });

    // Find admin by email
    const usersRef = db.collection("users");
    const querySnap = await usersRef.where("email", "==", email).get();

    if (querySnap.empty)
      return res.status(404).json({ success: false, message: "Admin not found" });

    const adminDocRef = querySnap.docs[0].ref;

    // Update password (plaintext)
    await adminDocRef.update({
      password_hash: password,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ success: false, message: "Failed to update password" });
  }
});

