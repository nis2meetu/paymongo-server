import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";

const app = express();
app.use(express.json());
app.use(cors());

// Temporary store (you can use Redis or Firestore for production)
const verificationCodes = new Map();

app.post("/api/send-verification", async (req, res) => {
  const { email, user_id } = req.body;

  if (!email || !user_id)
    return res.status(400).json({ error: "Missing email or user_id" });

  // Generate 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  verificationCodes.set(user_id, code);

  console.log(`Generated code for ${user_id}: ${code}`);

  // Configure your mail transport
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER, // your Gmail address
      pass: process.env.EMAIL_PASS, // app password (not your real password)
    },
  });

  const mailOptions = {
    from: `"Game Support" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Verify your email address",
    text: `Your verification code is: ${code}`,
    html: `<h2>Your verification code</h2><p style="font-size:18px;"><b>${code}</b></p>`,
  };

  try {
    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: "Verification email sent." });
  } catch (err) {
    console.error("Error sending email:", err);
    res.status(500).json({ success: false, error: "Failed to send email." });
  }
});

// Verify endpoint
app.post("/api/verify-code", (req, res) => {
  const { user_id, code } = req.body;

  if (!verificationCodes.has(user_id))
    return res.status(400).json({ success: false, message: "No code found." });

  const storedCode = verificationCodes.get(user_id);
  if (storedCode === code) {
    verificationCodes.delete(user_id);
    return res.json({ success: true, message: "Email verified!" });
  }

  res.status(400).json({ success: false, message: "Invalid code." });
});

app.listen(3000, () => console.log("✅ Server running on port 3000"));
