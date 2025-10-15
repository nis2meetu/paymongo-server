require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());
app.use(cors());

// ---------------- FIREBASE INITIALIZATION ----------------
// Decode the base64 service account JSON from environment variable
const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, "base64").toString("utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ---------------- PAYMONGO CHECKOUT ----------------
app.post("/api/paymongo/checkout", async (req, res) => {
  try {
    const { name, amount } = req.body;

    const response = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization":
          "Basic " + Buffer.from(process.env.PAYMONGO_SECRET_KEY + ":").toString("base64"),
      },
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: [
              {
                name: name || "GCash Purchase",
                quantity: 1,
                amount: amount || 5000, // ₱50.00 (centavos)
                currency: "PHP",
              },
            ],
            payment_method_types: ["gcash", "card"],
            success_url: "https://paymongo.com",
            cancel_url: "https://paymongo.com",
          },
        },
      }),
    });

    const data = await response.json();

    if (response.status >= 400) {
      console.error("❌ PayMongo API error:", data);
      return res.status(response.status).json({ success: false, error: data });
    }

    const reference_id = data?.data?.attributes?.reference_number || null;

    res.json({
      success: true,
      checkout_url: data.data.attributes.checkout_url,
      reference_id,
    });
  } catch (err) {
    console.error("Checkout creation failed:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Failed to create checkout",
    });
  }
});

// ---------------- PAYMONGO WEBHOOK ----------------
app.post("/api/paymongo/webhook", async (req, res) => {
  try {
    const event = req.body;
    const data = event.data;

    if (!data || !data.attributes) return res.sendStatus(400);

    const attributes = data.attributes;
    const reference_id = attributes.reference_number;
    const status = attributes.payment_intent?.data?.attributes?.status || "unknown";

    if (reference_id) {
      const transactionsRef = db.collection("transactions");
      const snapshot = await transactionsRef
        .where("reference_id.stringValue", "==", reference_id)
        .get();

      if (snapshot.empty) {
        console.log("⚠️ No matching transaction found for:", reference_id);
      } else {
        snapshot.forEach(async (doc) => {
          await doc.ref.update({
            status: {
              stringValue: status === "succeeded" || status === "paid" ? "Success" : "Failed",
            },
          });
          console.log(`✅ Updated transaction ${doc.id} → ${status}`);
        });
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook error:", err);
    res.sendStatus(500);
  }
});
