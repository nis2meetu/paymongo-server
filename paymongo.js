const express = require("express");
const fetch = require("node-fetch");
const router = express.Router();

// ✅ Use router.post, not app.post
router.post("/checkout", async (req, res) => {
  try {
    const { name, amount } = req.body;

    const response = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization":
          "Basic " +
          Buffer.from(process.env.PAYMONGO_SECRET_KEY + ":").toString("base64"),
      },
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: [
              {
                name: name || "GCash Purchase",
                quantity: 1,
                amount: amount || 5000, // ₱50.00 in centavos
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

    res.json({
      success: true,
      checkout_url: data.data.attributes.checkout_url,
    });
  } catch (err) {
    console.error("Checkout creation failed:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Failed to create checkout session",
    });
  }
});

module.exports = router;
