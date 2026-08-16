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
app.use(
  express.json({
    limit: "10mb"
  })
);
const PORT =
  process.env.PORT || 10000;
const BOT_TOKEN =
  process.env.BOT_TOKEN;
const WEBHOOK_URL =
  process.env.WEBHOOK_URL;
if (!BOT_TOKEN) {
  console.error(
    "❌ BOT_TOKEN is missing"
  );
  process.exit(1);
}
if (!process.env.TURSO_DATABASE_URL) {
  console.error(
    "❌ TURSO_DATABASE_URL is missing"
  );
  process.exit(1);
}
if (!process.env.TURSO_AUTH_TOKEN) {
  console.error(
    "❌ TURSO_AUTH_TOKEN is missing"
  );
  process.exit(1);
}
const TELEGRAM_API =
  `https://api.telegram.org/bot${BOT_TOKEN}`;
/*
==================================================
TELEGRAM API
==================================================
*/
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
  const data =
    await response.json();
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
UPDATE TYPE DETECTOR
==================================================
*/
function getUpdateType(update) {
  if (update.business_connection) {
    return "business_connection";
  }
  if (update.business_message) {
    return "business_message";
  }
  if (
    update.edited_business_message
  ) {
    return "edited_business_message";
  }
  if (
    update.deleted_business_messages
  ) {
    return "deleted_business_messages";
  }
  if (update.message) {
    return "message";
  }
  if (update.edited_message) {
    return "edited_message";
  }
  if (update.channel_post) {
    return "channel_post";
  }
  if (update.edited_channel_post) {
    return "edited_channel_post";
  }
  if (update.callback_query) {
    return "callback_query";
  }
  if (update.inline_query) {
    return "inline_query";
  }
  if (update.chat_member) {
    return "chat_member";
  }
  if (update.my_chat_member) {
    return "my_chat_member";
  }
  if (update.chat_join_request) {
    return "chat_join_request";
  }
  return "unknown";
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
        true
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
      status: "online",
      time:
        new Date().toISOString()
    });
  }
);
/*
==================================================
WEBHOOK TEST
==================================================
*/
app.post(
  "/webhook",
  async (req, res) => {
    const update =
      req.body || {};
    const updateType =
      getUpdateType(update);
    console.log("");
    console.log(
      "=========================================="
    );
    console.log(
      "📩 TELEGRAM UPDATE RECEIVED"
    );
    console.log(
      "=========================================="
    );
    console.log(
      `📌 UPDATE TYPE: ${updateType}`
    );
    console.log(
      `🆔 UPDATE ID: ${
        update.update_id ??
        "unknown"
      }`
    );
    console.log(
      "=========================================="
    );
    /*
    --------------------------------------------
    BUSINESS CONNECTION
    --------------------------------------------
    */
    if (
      update.business_connection
    ) {
      const connection =
        update.business_connection;
      console.log(
        "🔗 BUSINESS CONNECTION"
      );
      console.log(
        `ID: ${connection.id}`
      );
      console.log(
        `User: ${
          connection.user?.id ||
          "unknown"
        }`
      );
      console.log(
        `Enabled: ${
          connection.is_enabled
        }`
      );
      console.log(
        `Can read messages: ${
          connection.rights
            ?.can_read_messages
        }`
      );
      console.log(
        `Can reply: ${
          connection.rights
            ?.can_reply
        }`
      );
      console.log(
        `Can delete all: ${
          connection.rights
            ?.can_delete_all_messages
        }`
      );
      console.log(
        "=========================================="
      );
    }
    /*
    --------------------------------------------
    BUSINESS MESSAGE
    --------------------------------------------
    */
    if (
      update.business_message
    ) {
      const message =
        update.business_message;
      console.log(
        "🔥🔥🔥 BUSINESS MESSAGE RECEIVED 🔥🔥🔥"
      );
      console.log(
        `Connection: ${
          message.business_connection_id
        }`
      );
      console.log(
        `Chat: ${
          message.chat?.id
        }`
      );
      console.log(
        `Message ID: ${
          message.message_id
        }`
      );
      console.log(
        `From: ${
          message.from?.id
        }`
      );
      console.log(
        `Text: ${
          message.text ||
          message.caption ||
          "[NO TEXT]"
        }`
      );
      console.log(
        "=========================================="
      );
    }
    /*
    --------------------------------------------
    EDITED BUSINESS MESSAGE
    --------------------------------------------
    */
    if (
      update.edited_business_message
    ) {
      const message =
        update.edited_business_message;
      console.log(
        "✏️ EDITED BUSINESS MESSAGE"
      );
      console.log(
        `Connection: ${
          message.business_connection_id
        }`
      );
      console.log(
        `Chat: ${
          message.chat?.id
        }`
      );
      console.log(
        `Message ID: ${
          message.message_id
        }`
      );
      console.log(
        `Text: ${
          message.text ||
          message.caption ||
          "[NO TEXT]"
        }`
      );
      console.log(
        "=========================================="
      );
    }
    /*
    --------------------------------------------
    DELETED BUSINESS MESSAGES
    --------------------------------------------
    */
    if (
      update.deleted_business_messages
    ) {
      const deleted =
        update.deleted_business_messages;
      console.log(
        "🗑 DELETED BUSINESS MESSAGES"
      );
      console.log(
        `Connection: ${
          deleted.business_connection_id
        }`
      );
      console.log(
        `Chat: ${
          deleted.chat?.id
        }`
      );
      console.log(
        `Message IDs: ${
          JSON.stringify(
            deleted.message_ids
          )
        }`
      );
      console.log(
        "=========================================="
      );
    }
    /*
    --------------------------------------------
    FULL UPDATE
    --------------------------------------------
    */
    console.log(
      "📦 FULL TELEGRAM UPDATE:"
    );
    console.log(
      JSON.stringify(
        update,
        null,
        2
      )
    );
    console.log(
      "=========================================="
    );
    /*
    Telegram должен получить 200.
    */
    res.status(200).json({
      ok: true
    });
    /*
    --------------------------------------------
    PROCESS UPDATE
    --------------------------------------------
    */
    try {
      await handleUpdate(
        update,
        {
          telegram,
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
          getRecentEvents,
          sendMessage,
          deleteBusinessMessages
        }
      );
      console.log(
        `✅ ${updateType} processed`
      );
    } catch (error) {
      console.error(
        "❌ UPDATE PROCESSING ERROR"
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
API — STATS
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
        "❌ Stats error:",
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
API — MESSAGES
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
        "❌ Messages error:",
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
API — EVENTS
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
        "❌ Events error:",
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
404
==================================================
*/
app.use(
  (req, res) => {
    res.status(404).json({
      ok: false,
      error:
        "Not Found",
      path:
        req.path
    });
  }
);
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
        "🔎 Update diagnostics: enabled"
      );
      console.log(
        "=========================================="
      );
      console.log("");
      /*
      -------------------------------------------
      WEBHOOK URL
      -------------------------------------------
      */
      if (!WEBHOOK_URL) {
        console.error(
          "❌ WEBHOOK_URL is missing"
        );
        return;
      }
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
      GET WEBHOOK INFO
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
        console.log(
          `📨 Pending updates: ${
            info.pending_update_count ??
            0
          }`
        );
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
  error => {
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