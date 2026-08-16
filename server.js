require("dotenv").config();

const express = require("express");

const {
  initDatabase,
  saveBusinessConnection,
  getBusinessConnection,
  saveMessage,
  saveEvent,
  getUserStats
} = require("./src/database");

const {
  handleUpdate,
  sendMessage,
  deleteBusinessMessages
} = require("./src/business");

const app = express();

app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 10000;
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN is missing");
  process.exit(1);
}

const TELEGRAM_API =
  `https://api.telegram.org/bot${BOT_TOKEN}`;

async function telegram(method, body = {}) {
  const response = await fetch(
    `${TELEGRAM_API}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      `Telegram ${method}: ${data.description || "Unknown error"}`
    );
  }

  return data.result;
}

async function main() {
  await initDatabase();

  app.get("/", (req, res) => {
    res.json({
      ok: true,
      service: "STMA",
      version: "1.0.0",
      status: "online"
    });
  });

  app.get("/health", (req, res) => {
    res.json({
      ok: true,
      service: "STMA"
    });
  });

  app.post("/webhook", async (req, res) => {
    try {
      await handleUpdate(req.body, {
        telegram,
        saveBusinessConnection,
        getBusinessConnection,
        saveMessage,
        saveEvent,
        getUserStats,
        sendMessage,
        deleteBusinessMessages
      });

      res.sendStatus(200);
    } catch (error) {
      console.error("Webhook error:", error);
      res.sendStatus(200);
    }
  });

  app.listen(PORT, async () => {
    console.log(`STMA running on port ${PORT}`);

    if (!process.env.WEBHOOK_URL) {
      console.log("WEBHOOK_URL is not configured yet.");
      return;
    }

    try {
      const result = await telegram(
        "setWebhook",
        {
          url: `${process.env.WEBHOOK_URL}/webhook`,
          allowed_updates: [
            "message",
            "business_connection",
            "business_message",
            "edited_business_message",
            "deleted_business_messages"
          ]
        }
      );

      console.log("Webhook configured:", result);
    } catch (error) {
      console.error(
        "Webhook setup failed:",
        error.message
      );
    }
  });
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});