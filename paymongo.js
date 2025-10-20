require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());
app.use(cors());

// ---------------- FIREBASE INITIALIZATION ----------------
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
                amount: amount || 5000, // ₱50.00
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

    // ✅ Use the checkout session ID as the reference ID
    const reference_id = data?.data?.id || null;

    res.json({
      success: true,
      checkout_url: data.data.attributes.checkout_url,
      reference_id, // e.g., "chkout_abc123"
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
    const type = event?.type;
    const data = event?.data;

    if (!data || !data.attributes) return res.sendStatus(400);

    const attributes = data.attributes;

    // ✅ Extract reference or checkout session ID safely
    const reference_id =
      attributes.reference_number ||
      attributes.checkout_session_id ||
      attributes.data?.id ||
      attributes.id ||
      null;

    // ✅ Default to unknown for debugging
    let payment_status = "successful";

    // ✅ Detect event type and assign proper status
    switch (type) {
      case "checkout_session.payment.paid":
      case "payment.paid":
        payment_status = "paid";
        break;
      case "payment.failed":
        payment_status = "failed";
        break;
      case "payment.refunded":
        payment_status = "refunded";
        break;
      default:
        payment_status =
          attributes.payment_intent?.data?.attributes?.status || "unknown";
        break;
    }

    console.log(`🔔 Webhook: ${type} | Ref: ${reference_id} | Status: ${payment_status}`);

    // ✅ Proceed only if we have a reference_id
    if (reference_id) {
      const transactionsRef = db.collection("transactions");
      const snapshot = await transactionsRef
        .where("reference_id", "==", reference_id)
        .get();

      if (snapshot.empty) {
        console.log("⚠️ No matching transaction found for:", reference_id);
      } else {
        for (const doc of snapshot.docs) {
          await doc.ref.update({
            status: payment_status,
            last_updated: admin.firestore.FieldValue.serverTimestamp(), // ✅ Automatic server time
          });
          console.log(`✅ Updated transaction ${doc.id} → ${payment_status}`);
        }
      }
    } else {
      console.log("⚠️ Missing reference ID in webhook data.");
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook error:", err);
    res.sendStatus(500);
  }
});



// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 PayMongo API running on port ${PORT}`);
});





