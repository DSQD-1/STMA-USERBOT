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

app.use(express.json({
  limit: "10mb"
}));

const PORT = process.env.PORT || 10000;
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is missing");
  process.exit(1);
}

const TELEGRAM_API =
  `https://api.telegram.org/bot${BOT_TOKEN}`;

async function telegram(method, body = {}) {
  console.log(`➡️ Telegram API: ${method}`);

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
    console.error(
      `❌ Telegram ${method}:`,
      data.description
    );

    throw new Error(
      `Telegram ${method}: ${
        data.description || "Unknown error"
      }`
    );
  }

  return data.result;
}

async function main() {
  await initDatabase();

  // ==========================================
  // HEALTH
  // ==========================================

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
      service: "STMA",
      status: "online",
      time: new Date().toISOString()
    });
  });

  // ==========================================
  // WEBHOOK
  // ==========================================

  app.post("/webhook", async (req, res) => {
    console.log("");
    console.log("==========================================");
    console.log("📩 TELEGRAM UPDATE");
    console.log("==========================================");

    try {
      console.log(
        JSON.stringify(
          req.body,
          null,
          2
        )
      );
    } catch (error) {
      console.error(
        "❌ Failed to print update:",
        error
      );
    }

    console.log("==========================================");
    console.log("");

    try {
      await handleUpdate(
        req.body,
        {
          telegram,

          saveBusinessConnection,

          getBusinessConnection,

          saveMessage,

          saveEvent,

          getUserStats,

          sendMessage,

          deleteBusinessMessages
        }
      );

      console.log("✅ Update processed");
    } catch (error) {
      console.error(
        "❌ Webhook processing error:"
      );

      console.error(error);

      if (error?.stack) {
        console.error(error.stack);
      }
    }

    // Telegram должен получить HTTP 200.
    // Даже если обработчик упал, отвечаем 200,
    // чтобы Telegram не зацикливал повторную доставку.
    res.sendStatus(200);
  });

  // ==========================================
  // START SERVER
  // ==========================================

  app.listen(PORT, async () => {
    console.log("");
    console.log("==========================================");
    console.log("🔥 STMA STARTED");
    console.log("==========================================");

    console.log(
      `🌐 Port: ${PORT}`
    );

    console.log(
      `🗄️ Database: connected`
    );

    console.log(
      `🤖 Bot: configured`
    );

    console.log("==========================================");
    console.log("");

    // ========================================
    // WEBHOOK SETUP
    // ========================================

    if (!process.env.WEBHOOK_URL) {
      console.log(
        "⚠️ WEBHOOK_URL is not configured."
      );

      return;
    }

    const webhookUrl =
      `${process.env.WEBHOOK_URL}/webhook`;

    console.log(
      `🔗 Setting webhook: ${webhookUrl}`
    );

    try {
      const result =
        await telegram(
          "setWebhook",
          {
            url: webhookUrl,

            allowed_updates: [
              "message",
              "business_connection",
              "business_message",
              "edited_business_message",
              "deleted_business_messages"
            ]
          }
        );

      console.log(
        "✅ Webhook configured:",
        result
      );

      // Проверяем установленный webhook
      try {
        const info =
          await telegram(
            "getWebhookInfo"
          );

        console.log("");
        console.log(
          "📡 WEBHOOK INFO"
        );
        console.log(
          JSON.stringify(
            info,
            null,
            2
          )
        );
        console.log("");
      } catch (error) {
        console.error(
          "⚠️ Could not get webhook info:",
          error.message
        );
      }

    } catch (error) {
      console.error(
        "❌ Webhook setup failed:"
      );

      console.error(
        error.message
      );
    }
  });
}

// ==========================================
// GLOBAL ERROR HANDLING
// ==========================================

process.on(
  "unhandledRejection",
  (error) => {
    console.error(
      "❌ UNHANDLED REJECTION:"
    );

    console.error(error);
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "❌ UNCAUGHT EXCEPTION:"
    );

    console.error(error);
  }
);

// ==========================================
// START
// ==========================================

main().catch(
  (error) => {
    console.error(
      "❌ STMA failed to start:"
    );

    console.error(error);

    process.exit(1);
  }
);