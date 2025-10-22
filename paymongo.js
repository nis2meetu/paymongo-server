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
      const quantity = transaction.quantity || 1;
      const offerId = transaction.offer_id || null;

      // ✅ Update transaction status
      await doc.ref.update({
        status: payment_status,
        last_updated: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`✅ Updated transaction ${doc.id} → ${payment_status}`);

      // ✅ Only process successful/paid transactions
      if ((payment_status === "successful" || payment_status === "paid") && userId && offerId) {
        const offerSnapshot = await db.collection("offers").doc(offerId).get();
        if (!offerSnapshot.exists) {
          console.warn(`⚠️ Offer not found: ${offerId}`);
          continue;
        }

        const offerData = offerSnapshot.data();
        const offerItems = offerData.items || [];
        const isBundle = offerData.is_bundle === true;

        const inventoryDocRef = db.doc(`users/players/${userId}/inventory`);
        const inventoryDoc = await inventoryDocRef.get();
        const currentInventory = inventoryDoc.exists ? inventoryDoc.data() : {};
        let gems = currentInventory.gems || 0;
        let items = currentInventory.items || {};

        // Loop through all items in the offer
        for (const offerItem of offerItems) {
          const itemId = offerItem.item_id;
          const totalQty = (offerItem.quantity || 1) * (purchaseData.quantity || 1);

          // 🔍 Get item details from /items collection
          const itemSnapshot = await db.collection("items").doc(itemId).get();
          const itemData = itemSnapshot.exists ? itemSnapshot.data() : {};
          const isGem = (itemData.category || "").toLowerCase() === "gem";

          if (isGem) {
            // 💎 Add gems to inventory
            gems += totalQty;
            await inventoryDocRef.set(
              {
                gems,
                last_updated: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
            console.log(`💎 Added ${totalQty} Gems → Total: ${gems}`);
          } else {
            // 🎁 Add non-gem items
            const existing = items[itemId] || {};
            const updatedQty = (existing.quantity || 0) + totalQty;

            items[itemId] = {
              ...existing,
              item_id: itemId,
              quantity: updatedQty,
              obtained_at: admin.firestore.FieldValue.serverTimestamp(),
            };

            await inventoryDocRef.set(
              {
                items,
                last_updated: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
            console.log(`🎁 Added item ${itemId} +${totalQty} → ${updatedQty}`);
          }
        }
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
















