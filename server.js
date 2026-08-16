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

if (!process.env.TURSO_DATABASE_URL) {
  console.error("❌ TURSO_DATABASE_URL is missing");
  process.exit(1);
}

if (!process.env.TURSO_AUTH_TOKEN) {
  console.error("❌ TURSO_AUTH_TOKEN is missing");
  process.exit(1);
}

const TELEGRAM_API =
  `https://api.telegram.org/bot${BOT_TOKEN}`;


/*
==================================================
TELEGRAM API
==================================================
*/

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


/*
==================================================
HEALTH
==================================================
*/

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


/*
==================================================
WEBHOOK
==================================================
*/

app.post("/webhook", async (req, res) => {

  console.log("");
  console.log("==========================================");
  console.log("📩 TELEGRAM UPDATE");
  console.log("==========================================");

  console.log(
    JSON.stringify(
      req.body,
      null,
      2
    )
  );

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

    console.error(
      error.message
    );

    if (error.stack) {
      console.error(
        error.stack
      );
    }

  }

  /*
   Telegram должен получить HTTP 200.
  */

  res.status(200).json({
    ok: true
  });
});


/*
==================================================
START SERVER
==================================================
*/

async function start() {

  /*
  -----------------------------------------------
  DATABASE
  -----------------------------------------------
  */

  await initDatabase();


  /*
  -----------------------------------------------
  SERVER
  -----------------------------------------------
  */

  app.listen(
    PORT,
    async () => {

      console.log("");
      console.log("==========================================");
      console.log("🔥 STMA STARTED");
      console.log("==========================================");

      console.log(
        `🌐 Port: ${PORT}`
      );

      console.log(
        "🗄️ Database: connected"
      );

      console.log(
        "🤖 Bot: configured"
      );

      console.log("==========================================");
      console.log("");


      /*
      -------------------------------------------
      WEBHOOK
      -------------------------------------------
      */

      if (!process.env.WEBHOOK_URL) {

        console.error(
          "❌ WEBHOOK_URL is missing"
        );

        return;
      }


      /*
      Убираем ВСЕ слэши с конца URL.
      Это предотвращает:
      //webhook
      */

      const baseUrl =
        process.env.WEBHOOK_URL
          .trim()
          .replace(/\/+$/, "");


      const webhookUrl =
        `${baseUrl}/webhook`;


      console.log(
        `🔗 Webhook URL: ${webhookUrl}`
      );


      /*
      -------------------------------------------
      SET WEBHOOK
      -------------------------------------------
      */

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
              ],

              drop_pending_updates: false
            }
          );


        console.log(
          "✅ Webhook configured:",
          result
        );


      } catch (error) {

        console.error(
          "❌ Failed to configure webhook:"
        );

        console.error(
          error.message
        );

      }


      /*
      -------------------------------------------
      VERIFY WEBHOOK
      -------------------------------------------
      */

      try {

        const info =
          await telegram(
            "getWebhookInfo"
          );


        console.log("");
        console.log(
          "=========================================="
        );
        console.log(
          "📡 WEBHOOK INFO"
        );
        console.log(
          "=========================================="
        );


        console.log(
          JSON.stringify(
            info,
            null,
            2
          )
        );


        console.log(
          "=========================================="
        );
        console.log("");


        /*
        Проверяем ошибки Telegram.
        */

        if (
          info.last_error_message
        ) {

          console.error(
            "⚠️ TELEGRAM WEBHOOK ERROR:"
          );

          console.error(
            info.last_error_message
          );

        } else {

          console.log(
            "✅ Telegram webhook has no errors"
          );

        }

      } catch (error) {

        console.error(
          "❌ Could not verify webhook:"
        );

        console.error(
          error.message
        );

      }

    }
  );
}


/*
==================================================
ERROR HANDLERS
==================================================
*/

process.on(
  "unhandledRejection",
  (error) => {

    console.error(
      "❌ UNHANDLED REJECTION"
    );

    console.error(
      error
    );

  }
);


process.on(
  "uncaughtException",
  (error) => {

    console.error(
      "❌ UNCAUGHT EXCEPTION"
    );

    console.error(
      error
    );

  }
);


/*
==================================================
START STMA
==================================================
*/

start().catch(
  (error) => {

    console.error(
      "❌ STMA FAILED TO START"
    );

    console.error(
      error
    );

    process.exit(1);

  }
);