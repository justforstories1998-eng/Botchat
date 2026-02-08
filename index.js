require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

// ══════════════════════════════════════════════
// CORS FIX — This is what was causing your error
// ══════════════════════════════════════════════
app.use(cors({
  origin: [
    "https://botchatsai.netlify.app",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:3000"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

// Handle preflight OPTIONS requests explicitly
app.options("*", cors());

app.use(express.json());

// Root route
app.get("/", (req, res) => {
  res.json({
    status: "Varta AI Backend is running",
    timestamp: new Date().toISOString(),
    hasApiKey: !!process.env.API_KEY
  });
});

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Chat endpoint
app.post("/chat", async (req, res) => {
  console.log("Received:", req.body);

  try {
    const userMessage = req.body.message;

    if (!userMessage) {
      return res.status(400).json({
        content: "No message provided."
      });
    }

    if (!process.env.API_KEY) {
      console.error("API_KEY not set!");
      return res.status(500).json({
        content: "Server config error. API key missing."
      });
    }

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openrouter/auto",
        messages: [
          { role: "system", content: "You are a helpful assistant called Varta AI." },
          { role: "user", content: userMessage }
        ]
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://botchatsai.netlify.app",
          "X-Title": "Varta AI"
        },
        timeout: 30000
      }
    );

    res.json(response.data.choices[0].message);

  } catch (error) {
    console.error("Error:", error.response?.data || error.message);
    res.status(500).json({
      content: "Sorry, something went wrong: " +
        (error.response?.data?.error?.message || error.message)
    });
  }
});

// Catch unknown routes
app.use("*", (req, res) => {
  res.status(404).json({ error: "Route not found" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API Key: ${!!process.env.API_KEY}`);
});
