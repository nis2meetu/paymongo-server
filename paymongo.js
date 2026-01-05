require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");


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
                amount: amount || 5000,
                currency: "PHP",
              },
            ],
            payment_method_types: ["gcash"],
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

    const reference_id = data?.data?.id || null;

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
// ---------------- PAYMONGO WEBHOOK ----------------
app.post("/api/paymongo/webhook", async (req, res) => {
  try {
    const event = req.body;
    const type = event?.type;
    const data = event?.data;

    if (!data || !data.attributes) {
      console.warn("⚠️ Invalid webhook payload — missing attributes.");
      return res.sendStatus(400);
    }

    const attributes = data.attributes;

    const reference_id =
      attributes.reference_number ||
      attributes.checkout_session_id ||
      attributes.data?.id ||
      attributes.id ||
      null;

    if (!reference_id) {
      console.warn("⚠️ Missing reference_id in webhook payload.", JSON.stringify(attributes, null, 2));
      return res.sendStatus(400);
    }

    // Determine payment status
    let payment_status = "successful";

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
        if (attributes.payment_intent?.data?.attributes?.status === "succeeded") {
          payment_status = "paid";
        } else if (attributes.payment_intent?.data?.attributes?.status) {
          payment_status = attributes.payment_intent.data.attributes.status;
        }
        break;
    }

    console.log(`🔔 Webhook: ${type} | Ref: ${reference_id} | Status: ${payment_status}`);

    const transactionsRef = db.collection("transactions");
    const snapshot = await transactionsRef.where("reference_id", "==", reference_id).get();

    if (snapshot.empty) {
      console.warn("⚠️ No matching transaction found for:", reference_id);
      return res.sendStatus(404);
    }

    for (const doc of snapshot.docs) {
      const transaction = doc.data();
      const userId = transaction.user_id;
      const offerId = transaction.offer_id || null;

      // Update transaction status
      await doc.ref.update({
        status: payment_status,
        last_updated: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`✅ Updated transaction ${doc.id} → ${payment_status}`);

     if ((payment_status === "successful" || payment_status === "paid") && userId && offerId) {

  const offerSnapshot = await db.collection("offers").doc(offerId).get();
  if (!offerSnapshot.exists) continue;

  const offerData = offerSnapshot.data();
  const offerItems = offerData.items || [];

  const inventoryRef = db.doc(`users/players/${userId}/inventory`);
  const inventorySnap = await inventoryRef.get();
  const currentInventory = inventorySnap.exists ? inventorySnap.data() : {};

  let gems = currentInventory.gems || 0;
  let hints = currentInventory.hints || 0;
  let items = currentInventory.items || {};
  let totalQuantity = 0;
  let itemDescriptions = [];
  let staminaPurchased = false;

  // ---------------- PROCESS ITEMS ----------------
  for (const offerItem of offerItems) {
    const itemSnap = await db.collection("items").doc(offerItem.item_id).get();
    if (!itemSnap.exists) continue;

    const itemData = itemSnap.data();
    const category = (itemData.category || "").toLowerCase();
    const quantity = offerItem.quantity || 1;

    // 💎 Gems
    if (category === "gem") {
      gems += quantity;
    }

    // 💡 Hints
    else if (category === "hint") {
      hints += quantity;
    }

    // ❤️ Stamina
    else if (category === "stamina") {
      staminaPurchased = true;
    }

    // 📦 Other items
    else {
      totalQuantity += quantity;
      itemDescriptions.push({
        item_id: offerItem.item_id,
        description: itemData.description || "",
      });
    }
  }

  // ---------------- INVENTORY ITEMS ----------------
  if (totalQuantity > 0) {
    if (!items[offerId]) {
      items[offerId] = {
        offer_id: offerId,
        title: offerData.title || "",
        description: itemDescriptions,
        quantity: totalQuantity,
        added_at: admin.firestore.FieldValue.serverTimestamp(),
        last_updated: admin.firestore.FieldValue.serverTimestamp(),
        is_bundle: offerData.is_bundle || false,
      };
    } else {
      items[offerId].quantity += totalQuantity;
      items[offerId].last_updated = admin.firestore.FieldValue.serverTimestamp();
    }
  }

  // ---------------- UPDATE INVENTORY ----------------
  await inventoryRef.set(
    {
      gems,
      hints,
      items,
      last_updated: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // ---------------- UPDATE UI STATE (STAMINA) ----------------
  if (staminaPurchased) {
    await db.doc(`users/players/${userId}/ui_state`).set(
      {
        current_hearts: 3,
        half_step: false,
        last_updated: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  console.log(`✅ Inventory + UI updated for ${userId}`);
}
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























