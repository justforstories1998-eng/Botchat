require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

// IMPORTANT: Allow your Netlify frontend domain
app.use(cors({
  origin: [
    "https://botchatsai.netlify.app",  // ← Replace with YOUR Netlify URL
    "http://localhost:5500",
    "http://127.0.0.1:5500"
  ],
  methods: ["GET", "POST"],
  credentials: true
}));

app.use(express.json());

// Health check route — so you can test if backend is alive
app.get("/", (req, res) => {
  res.json({ status: "Varta AI Backend is running" });
});

app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;

    if (!userMessage) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (!process.env.API_KEY) {
      console.error("API_KEY is not set in environment variables");
      return res.status(500).json({ error: "Server configuration error" });
    }

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openrouter/auto",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: userMessage }
        ]
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://botchatsai.netlify.app",
          "X-Title": "Varta AI"
        }
      }
    );

    const reply = response.data.choices[0].message;
    res.json(reply);

  } catch (error) {
    console.error("API Error:", error.response?.data || error.message);
    res.status(500).json({
      content: "Sorry, something went wrong. Please try again.",
      error: error.response?.data?.error?.message || error.message
    });
  }
});

// IMPORTANT: Railway assigns a dynamic PORT — never hardcode 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
