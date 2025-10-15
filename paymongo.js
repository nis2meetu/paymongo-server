// paymongo-only.js
require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

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

    res.json({ success: true, checkout_url: data.data.attributes.checkout_url });
  } catch (err) {
    console.error("Checkout creation failed:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to create checkout" });
  }
});


// ✅ PayMongo Webhook — called by PayMongo when payment status changes
app.post("/api/paymongo/webhook", async (req, res) => {
  try {
    const event = req.body;

    console.log("📩 Webhook received from PayMongo:");
    console.log(JSON.stringify(event, null, 2));

    // Get payment status type
    const eventType = event.data.type;
    const attributes = event.data.attributes;

    if (eventType === "checkout.session.payment_paid") {
      console.log("✅ Payment success for session:", attributes.id);

      // Example: you could update Firestore here or your database
      // await updateTransaction(attributes.reference_number, "Success");
    } else if (eventType === "checkout.session.payment_failed") {
      console.log("❌ Payment failed for session:", attributes.id);
      // You can also mark it as failed in your DB
    }

    // Always respond 200 OK so PayMongo knows you received it
    res.status(200).send("OK");
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(400).send("Webhook processing failed");
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 PayMongo API running on port ${PORT}`));


