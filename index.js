require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors({
  origin: [
    "https://botchatsai.netlify.app",
    "http://localhost:5500",
    "http://127.0.0.1:5500"
  ],
  methods: ["GET", "POST"],
  credentials: true
}));

app.use(express.json({ limit: "10mb" }));

// Health check
app.get("/", (req, res) => {
  res.json({ status: "MyChatBot AI Backend is running", memory: "unlimited" });
});

// ===== SMART MEMORY SYSTEM =====

// How many recent messages to always keep in full
const RECENT_MESSAGES_LIMIT = 100;

// How many old messages to summarize at once
const SUMMARIZE_BATCH_SIZE = 50;

// In-memory store for conversation summaries (per chat session)
// In production, use Redis or a database
const conversationSummaries = new Map();

// Estimate token count (rough: 1 token ≈ 4 characters)
function estimateTokens(messages) {
  let total = 0;
  messages.forEach(function (msg) {
    total += Math.ceil((msg.content || "").length / 4);
  });
  return total;
}

// Ask AI to summarize old messages into a compact summary
async function summarizeMessages(oldMessages, existingSummary) {
  const summaryPrompt = [];

  summaryPrompt.push({
    role: "system",
    content:
      "You are a conversation summarizer. Create a detailed summary that preserves ALL important information including: " +
      "- User's name, preferences, personal details\n" +
      "- Key topics discussed\n" +
      "- Decisions made or conclusions reached\n" +
      "- Any specific facts, numbers, or data mentioned\n" +
      "- User's opinions, likes, dislikes\n" +
      "- Any tasks, promises, or action items\n" +
      "- Technical details or code discussed\n" +
      "Keep the summary concise but NEVER lose important personal or factual details. " +
      "Format as a clear, organized summary."
  });

  let contentToSummarize = "";

  // Include existing summary if there is one
  if (existingSummary) {
    contentToSummarize += "PREVIOUS CONVERSATION SUMMARY:\n" + existingSummary + "\n\n";
  }

  contentToSummarize += "NEW MESSAGES TO ADD TO SUMMARY:\n";
  oldMessages.forEach(function (msg) {
    var role = msg.role === "user" ? "User" : "Assistant";
    contentToSummarize += role + ": " + msg.content + "\n";
  });

  summaryPrompt.push({
    role: "user",
    content:
      "Summarize this conversation, preserving ALL important details:\n\n" +
      contentToSummarize
  });

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openrouter/auto",
        messages: summaryPrompt,
        max_tokens: 2000
      },
      {
        headers: {
          Authorization: "Bearer " + process.env.API_KEY,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://botchatsai.netlify.app",
          "X-Title": "MyChatBot AI"
        },
        timeout: 30000
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error("Summary generation failed:", error.message);
    // Fallback: create a basic manual summary
    var fallback = "";
    if (existingSummary) fallback = existingSummary + "\n\n";
    oldMessages.forEach(function (msg) {
      var role = msg.role === "user" ? "User" : "Assistant";
      fallback += role + ": " + msg.content.substring(0, 200) + "\n";
    });
    return fallback;
  }
}

// ===== MAIN CHAT ENDPOINT =====
app.post("/chat", async (req, res) => {
  try {
    const { message, history, chatId, summary: clientSummary } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (!process.env.API_KEY) {
      console.error("API_KEY is not set");
      return res.status(500).json({ error: "Server configuration error" });
    }

    // Get or create conversation ID
    const convId = chatId || "default";

    // Get existing summary from server memory or from client
    let existingSummary =
      conversationSummaries.get(convId) || clientSummary || null;

    // Process history
    let processedHistory = [];
    let newSummary = existingSummary;

    if (history && Array.isArray(history) && history.length > 0) {
      if (history.length > RECENT_MESSAGES_LIMIT) {
        // Split: older messages get summarized, recent ones stay full
        const oldMessages = history.slice(
          0,
          history.length - RECENT_MESSAGES_LIMIT
        );
        const recentMessages = history.slice(-RECENT_MESSAGES_LIMIT);

        console.log(
          "Summarizing " +
            oldMessages.length +
            " old messages, keeping " +
            recentMessages.length +
            " recent"
        );

        // Summarize the old messages
        newSummary = await summarizeMessages(oldMessages, existingSummary);

        // Store summary on server
        conversationSummaries.set(convId, newSummary);

        processedHistory = recentMessages;
      } else {
        // History is small enough, use it all
        processedHistory = history;
      }
    }

    // ===== BUILD FINAL MESSAGES ARRAY =====
    const messages = [];

    // System prompt with summary baked in
    let systemContent =
      "You are MyChatBot AI, a helpful, intelligent, and friendly assistant. " +
      "You have perfect memory of the entire conversation. " +
      "Be concise but thorough. Use markdown formatting when helpful.";

    if (newSummary) {
      systemContent +=
        "\n\n===== CONVERSATION MEMORY (Summary of earlier messages) =====\n" +
        newSummary +
        "\n===== END OF MEMORY =====\n\n" +
        "Use this memory to maintain context. The user expects you to remember everything discussed.";
    }

    messages.push({ role: "system", content: systemContent });

    // Add recent conversation history
    processedHistory.forEach(function (msg) {
      if (msg.role && msg.content) {
        messages.push({ role: msg.role, content: msg.content });
      }
    });

    // Add current message
    messages.push({ role: "user", content: message });

    // Check estimated tokens and trim if needed
    let tokenEstimate = estimateTokens(messages);
    console.log(
      "Total messages: " +
        messages.length +
        ", Estimated tokens: " +
        tokenEstimate
    );

    // Safety: if still too large, trim from oldest (after system prompt)
    while (tokenEstimate > 100000 && messages.length > 3) {
      messages.splice(1, 1); // Remove oldest message after system prompt
      tokenEstimate = estimateTokens(messages);
    }

    // ===== CALL AI =====
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openrouter/auto",
        messages: messages,
        max_tokens: 4096
      },
      {
        headers: {
          Authorization: "Bearer " + process.env.API_KEY,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://botchatsai.netlify.app",
          "X-Title": "MyChatBot AI"
        },
        timeout: 120000 // 2 minutes for long conversations
      }
    );

    const reply = response.data.choices[0].message;

    // Send back reply + updated summary so frontend can store it
    res.json({
      role: reply.role,
      content: reply.content,
      summary: newSummary,
      messageCount: messages.length,
      memoryActive: !!newSummary
    });
  } catch (error) {
    console.error("API Error:", error.response?.data || error.message);

    const errorMsg = error.response?.data?.error?.message || error.message;
    const statusCode = error.response?.status || 500;

    res.status(statusCode).json({
      role: "assistant",
      content: "I'm sorry, I encountered an error. Please try again.",
      error: errorMsg
    });
  }
});

// Clean up old summaries every hour (prevent memory leak)
setInterval(function () {
  if (conversationSummaries.size > 1000) {
    console.log("Cleaning up old conversation summaries");
    const entries = Array.from(conversationSummaries.entries());
    // Keep only the most recent 500
    conversationSummaries.clear();
    entries.slice(-500).forEach(function (entry) {
      conversationSummaries.set(entry[0], entry[1]);
    });
  }
}, 3600000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
  console.log("Smart memory system active");
  console.log("Recent messages limit: " + RECENT_MESSAGES_LIMIT);
});
