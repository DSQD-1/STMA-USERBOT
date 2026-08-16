require("dotenv").config();

const express = require("express");

const {
  initDatabase,

  saveBusinessConnection,
  getBusinessConnection,

  saveMessage,
  saveMessageEdit,
  saveDeletedMessages,

  saveEvent,

  getUserStats,

  addIgnore,
  removeIgnore,
  isIgnored,
  getIgnoredUsers,

  setWatchSettings,
  getWatchSettings,

  getRecentMessages,
  getRecentEvents
} = require("./src/database");

const {
  handleUpdate,
  sendMessage,
  deleteBusinessMessages
} = require("./src/business");

const app = express();

/*
==================================================
EXPRESS
==================================================
*/

app.use(
  express.json({
    limit: "10mb"
  })
);

/*
==================================================
CONFIG
==================================================
*/

const PORT =
  process.env.PORT || 10000;

const BOT_TOKEN =
  process.env.BOT_TOKEN;

const TURSO_DATABASE_URL =
  process.env.TURSO_DATABASE_URL;

const TURSO_AUTH_TOKEN =
  process.env.TURSO_AUTH_TOKEN;

const WEBHOOK_URL =
  process.env.WEBHOOK_URL;

/*
==================================================
ENV CHECK
==================================================
*/

if (!BOT_TOKEN) {
  console.error(
    "❌ BOT_TOKEN is missing"
  );

  process.exit(1);
}

if (!TURSO_DATABASE_URL) {
  console.error(
    "❌ TURSO_DATABASE_URL is missing"
  );

  process.exit(1);
}

if (!TURSO_AUTH_TOKEN) {
  console.error(
    "❌ TURSO_AUTH_TOKEN is missing"
  );

  process.exit(1);
}

/*
==================================================
TELEGRAM API
==================================================
*/

const TELEGRAM_API =
  `https://api.telegram.org/bot${BOT_TOKEN}`;

async function telegram(
  method,
  body = {}
) {
  console.log(
    `➡️ Telegram API: ${method}`
  );

  const response =
    await fetch(
      `${TELEGRAM_API}/${method}`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(body)
      }
    );

  let data;

  try {
    data =
      await response.json();
  } catch {
    throw new Error(
      `Telegram ${method}: invalid JSON response`
    );
  }

  if (!data.ok) {
    console.error(
      `❌ Telegram ${method}:`,
      data.description
    );

    throw new Error(
      `Telegram ${method}: ${
        data.description ||
        "Unknown error"
      }`
    );
  }

  return data.result;
}

/*
==================================================
ROOT
==================================================
*/

app.get(
  "/",
  (req, res) => {
    res.json({
      ok: true,

      service: "STMA",

      version: "2.0.0",

      status: "online",

      telegram_business:
        true,

      database:
        "Turso"
    });
  }
);

/*
==================================================
HEALTH
==================================================
*/

app.get(
  "/health",
  (req, res) => {
    res.json({
      ok: true,

      service: "STMA",

      version: "2.0.0",

      status: "online",

      time:
        new Date().toISOString()
    });
  }
);

/*
==================================================
API — BASIC STATS
==================================================
*/

app.get(
  "/api/stats/:connectionId",
  async (req, res) => {
    try {
      const connectionId =
        req.params.connectionId;

      const stats =
        await getUserStats(
          connectionId
        );

      res.json({
        ok: true,

        connection_id:
          connectionId,

        stats
      });

    } catch (error) {
      console.error(
        "❌ Stats API error:",
        error
      );

      res.status(500).json({
        ok: false,

        error:
          error.message
      });
    }
  }
);

/*
==================================================
API — RECENT MESSAGES
==================================================
*/

app.get(
  "/api/messages/:connectionId",
  async (req, res) => {
    try {
      const connectionId =
        req.params.connectionId;

      const limit =
        Number(
          req.query.limit || 50
        );

      const messages =
        await getRecentMessages(
          connectionId,
          limit
        );

      res.json({
        ok: true,

        connection_id:
          connectionId,

        count:
          messages.length,

        messages
      });

    } catch (error) {
      console.error(
        "❌ Messages API error:",
        error
      );

      res.status(500).json({
        ok: false,

        error:
          error.message
      });
    }
  }
);

/*
==================================================
API — RECENT EVENTS
==================================================
*/

app.get(
  "/api/events/:connectionId",
  async (req, res) => {
    try {
      const connectionId =
        req.params.connectionId;

      const limit =
        Number(
          req.query.limit || 50
        );

      const events =
        await getRecentEvents(
          connectionId,
          limit
        );

      res.json({
        ok: true,

        connection_id:
          connectionId,

        count:
          events.length,

        events
      });

    } catch (error) {
      console.error(
        "❌ Events API error:",
        error
      );

      res.status(500).json({
        ok: false,

        error:
          error.message
      });
    }
  }
);

/*
==================================================
WEBHOOK
==================================================
*/

app.post(
  "/webhook",
  async (req, res) => {

    console.log("");
    console.log(
      "=========================================="
    );

    console.log(
      "📩 TELEGRAM UPDATE"
    );

    console.log(
      "=========================================="
    );

    console.log(
      JSON.stringify(
        req.body,
        null,
        2
      )
    );

    console.log(
      "=========================================="
    );

    console.log("");

    /*
    Telegram должен получить 200.
    Отвечаем сразу, чтобы Telegram
    не ждал завершения всей обработки.
    */

    res.status(200).json({
      ok: true
    });

    try {

      await handleUpdate(
        req.body,
        {
          /*
          Telegram
          */

          telegram,

          /*
          Business Connection
          */

          saveBusinessConnection,
          getBusinessConnection,

          /*
          Messages
          */

          saveMessage,
          saveMessageEdit,
          saveDeletedMessages,

          /*
          Events
          */

          saveEvent,

          /*
          Statistics
          */

          getUserStats,

          /*
          Ignore
          */

          addIgnore,
          removeIgnore,
          isIgnored,
          getIgnoredUsers,

          /*
          Monitoring
          */

          setWatchSettings,
          getWatchSettings,

          /*
          History
          */

          getRecentMessages,
          getRecentEvents,

          /*
          Telegram actions
          */

          sendMessage,
          deleteBusinessMessages
        }
      );

      console.log(
        "✅ Update processed"
      );

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
  }
);

/*
==================================================
404
==================================================
*/

app.use(
  (req, res) => {
    res.status(404).json({
      ok: false,

      error: "Not Found",

      path: req.path
    });
  }
);

/*
==================================================
START
==================================================
*/

async function start() {

  /*
  -----------------------------------------------
  DATABASE
  -----------------------------------------------
  */

  console.log(
    "🗄️ Initializing database..."
  );

  await initDatabase();

  console.log(
    "✅ Database initialized"
  );

  /*
  -----------------------------------------------
  SERVER
  -----------------------------------------------
  */

  app.listen(
    PORT,
    async () => {

      console.log("");

      console.log(
        "=========================================="
      );

      console.log(
        "🔥 STMA v2.0.0 STARTED"
      );

      console.log(
        "=========================================="
      );

      console.log(
        `🌐 Port: ${PORT}`
      );

      console.log(
        "🗄️ Database: Turso"
      );

      console.log(
        "🤖 Bot: configured"
      );

      console.log(
        "📡 Telegram Business: enabled"
      );

      console.log(
        "=========================================="
      );

      console.log("");

      /*
      -------------------------------------------
      WEBHOOK CONFIG
      -------------------------------------------
      */

      if (!WEBHOOK_URL) {

        console.error(
          "❌ WEBHOOK_URL is missing"
        );

        console.error(
          "⚠️ Server is running, but Telegram webhook was not configured."
        );

        return;
      }

      /*
      Убираем слэши в конце.
      */

      const baseUrl =
        WEBHOOK_URL
          .trim()
          .replace(
            /\/+$/,
            ""
          );

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
              url:
                webhookUrl,

              allowed_updates: [
                "message",
                "business_connection",
                "business_message",
                "edited_business_message",
                "deleted_business_messages"
              ],

              drop_pending_updates:
                false
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
        Telegram webhook errors
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

        /*
        Pending updates
        */

        if (
          typeof info.pending_update_count ===
          "number"
        ) {

          console.log(
            `📨 Pending updates: ${info.pending_update_count}`
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
UNHANDLED REJECTION
==================================================
*/

process.on(
  "unhandledRejection",
  error => {

    console.error(
      "❌ UNHANDLED REJECTION"
    );

    console.error(
      error
    );
  }
);

/*
==================================================
UNCAUGHT EXCEPTION
==================================================
*/

process.on(
  "uncaughtException",
  error => {

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
  error => {

    console.error(
      "❌ STMA FAILED TO START"
    );

    console.error(
      error
    );

    process.exit(1);
  }
);