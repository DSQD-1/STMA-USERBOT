require("dotenv").config();

const express = require("express");
const path = require("path");

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

const PORT = Number(process.env.PORT) || 10000;
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
MIDDLEWARE
==================================================
*/

app.use(express.json({
  limit: "10mb"
}));

app.use(express.urlencoded({
  extended: true
}));

/*
==================================================
STATIC MINI APP
==================================================
*/

const publicPath =
  path.join(__dirname, "public");

app.use(
  express.static(publicPath)
);

/*
==================================================
TELEGRAM API
==================================================
*/

async function telegram(
  method,
  body = {}
) {
  console.log(`➡️ Telegram API: ${method}`);

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
HELPERS
==================================================
*/

function getConnectionId(req) {
  return (
    req.headers["x-business-connection-id"] ||
    req.query.connection_id ||
    req.body?.connection_id ||
    null
  );
}

async function requireConnection(req, res) {
  const connectionId =
    getConnectionId(req);

  if (!connectionId) {
    res.status(400).json({
      ok: false,
      error:
        "Business connection is required"
    });

    return null;
  }

  const connection =
    await getBusinessConnection(
      connectionId
    );

  if (!connection) {
    res.status(404).json({
      ok: false,
      error:
        "Business connection not found"
    });

    return null;
  }

  if (!connection.is_enabled) {
    res.status(403).json({
      ok: false,
      error:
        "Business connection is disabled"
    });

    return null;
  }

  return {
    id: connectionId,
    connection
  };
}

function safeJson(value) {
  if (!value) {
    return {};
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/*
==================================================
HOME
==================================================
*/

app.get("/", (req, res) => {
  res.sendFile(
    path.join(
      publicPath,
      "index.html"
    )
  );
});

/*
==================================================
HEALTH
==================================================
*/

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "STMA",
    version: "3.0.0",
    status: "online",
    time:
      new Date().toISOString()
  });
});

/*
==================================================
API
==================================================
*/

app.get(
  "/api/me",
  async (req, res) => {
    try {
      const auth =
        await requireConnection(
          req,
          res
        );

      if (!auth) return;

      const stats =
        await getUserStats(
          auth.id
        );

      const ignored =
        await getIgnoredUsers(
          auth.id
        );

      const watch =
        await getWatchSettings(
          auth.id
        );

      res.json({
        ok: true,

        connection: {
          id: auth.id,

          user_id:
            auth.connection.user_id,

          user_chat_id:
            auth.connection.user_chat_id,

          enabled:
            Boolean(
              auth.connection
                .is_enabled
            ),

          rights:
            safeJson(
              auth.connection.rights
            )
        },

        stats,

        ignored_users:
          ignored,

        watch
      });

    } catch (error) {
      console.error(
        "API /api/me:",
        error
      );

      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/*
==================================================
STATS
==================================================
*/

app.get(
  "/api/stats",
  async (req, res) => {
    try {
      const auth =
        await requireConnection(
          req,
          res
        );

      if (!auth) return;

      const stats =
        await getUserStats(
          auth.id
        );

      res.json({
        ok: true,
        stats
      });

    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/*
==================================================
HISTORY
==================================================
*/

app.get(
  "/api/history",
  async (req, res) => {
    try {
      const auth =
        await requireConnection(
          req,
          res
        );

      if (!auth) return;

      const limit =
        Number(req.query.limit) || 30;

      const messages =
        await getRecentMessages(
          auth.id,
          limit
        );

      res.json({
        ok: true,
        messages
      });

    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/*
==================================================
EVENTS
==================================================
*/

app.get(
  "/api/events",
  async (req, res) => {
    try {
      const auth =
        await requireConnection(
          req,
          res
        );

      if (!auth) return;

      const limit =
        Number(req.query.limit) || 30;

      const events =
        await getRecentEvents(
          auth.id,
          limit
        );

      res.json({
        ok: true,
        events
      });

    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/*
==================================================
MUTE
==================================================
*/

app.post(
  "/api/mute",
  async (req, res) => {
    try {
      const auth =
        await requireConnection(
          req,
          res
        );

      if (!auth) return;

      const {
        user_id,
        username,
        duration,
        reason
      } = req.body;

      if (!user_id && !username) {
        return res.status(400).json({
          ok: false,
          error:
            "user_id or username is required"
        });
      }

      /*
      Telegram Business API не даёт
      универсальной функции "заблокировать
      пользователя в чужом чате".

      Поэтому STMA использует собственный
      список игнорирования для автоматической
      обработки входящих сообщений.
      */

      const target =
        user_id || username;

      await addIgnore(
        auth.id,
        String(target)
      );

      await saveEvent({
        connectionId:
          auth.id,

        type:
          "mute",

        data: {
          user_id:
            user_id || null,

          username:
            username || null,

          duration:
            duration || null,

          reason:
            reason || null
        }
      });

      res.json({
        ok: true,

        action: "mute",

        target,

        duration:
          duration || null,

        reason:
          reason || null
      });

    } catch (error) {
      console.error(
        "API /api/mute:",
        error
      );

      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/*
==================================================
UNMUTE
==================================================
*/

app.post(
  "/api/unmute",
  async (req, res) => {
    try {
      const auth =
        await requireConnection(
          req,
          res
        );

      if (!auth) return;

      const {
        user_id,
        username
      } = req.body;

      const target =
        user_id || username;

      if (!target) {
        return res.status(400).json({
          ok: false,
          error:
            "user_id or username is required"
        });
      }

      await removeIgnore(
        auth.id,
        String(target)
      );

      await saveEvent({
        connectionId:
          auth.id,

        type:
          "unmute",

        data: {
          user_id:
            user_id || null,

          username:
            username || null
        }
      });

      res.json({
        ok: true,
        action: "unmute",
        target
      });

    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/*
==================================================
IGNORED USERS
==================================================
*/

app.get(
  "/api/mutes",
  async (req, res) => {
    try {
      const auth =
        await requireConnection(
          req,
          res
        );

      if (!auth) return;

      const users =
        await getIgnoredUsers(
          auth.id
        );

      res.json({
        ok: true,
        users
      });

    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/*
==================================================
WATCH
==================================================
*/

app.get(
  "/api/watch",
  async (req, res) => {
    try {
      const auth =
        await requireConnection(
          req,
          res
        );

      if (!auth) return;

      const settings =
        await getWatchSettings(
          auth.id
        );

      res.json({
        ok: true,
        settings
      });

    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/*
==================================================
UPDATE WATCH
==================================================
*/

app.post(
  "/api/watch",
  async (req, res) => {
    try {
      const auth =
        await requireConnection(
          req,
          res
        );

      if (!auth) return;

      const {
        enabled,
        new_messages,
        edited_messages,
        deleted_messages
      } = req.body;

      await setWatchSettings(
        auth.id,
        {
          enabled:
            enabled !== undefined
              ? Boolean(enabled)
              : undefined,

          new_messages:
            new_messages !== undefined
              ? Boolean(
                  new_messages
                )
              : undefined,

          edited_messages:
            edited_messages !== undefined
              ? Boolean(
                  edited_messages
                )
              : undefined,

          deleted_messages:
            deleted_messages !== undefined
              ? Boolean(
                  deleted_messages
                )
              : undefined
        }
      );

      const settings =
        await getWatchSettings(
          auth.id
        );

      res.json({
        ok: true,
        settings
      });

    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/*
==================================================
SEND MESSAGE
==================================================
*/

app.post(
  "/api/send",
  async (req, res) => {
    try {
      const auth =
        await requireConnection(
          req,
          res
        );

      if (!auth) return;

      const {
        chat_id,
        text,
        delete_after,
        once
      } = req.body;

      if (!chat_id) {
        return res.status(400).json({
          ok: false,
          error:
            "chat_id is required"
        });
      }

      if (
        !text ||
        !String(text).trim()
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "text is required"
        });
      }

      const sent =
        await sendMessage(
          telegram,
          auth.id,
          chat_id,
          String(text)
        );

      await saveEvent({
        connectionId:
          auth.id,

        type:
          "sent_message",

        chatId:
          chat_id,

        messageId:
          sent.message_id,

        data: {
          text:
            String(text),

          delete_after:
            delete_after || null,

          once:
            Boolean(once)
        }
      });

      /*
      Автоудаление сообщения.
      */

      if (
        delete_after &&
        Number(delete_after) > 0
      ) {
        const seconds =
          Math.min(
            86400,
            Number(delete_after)
          );

        setTimeout(
          async () => {
            try {
              await deleteBusinessMessages(
                telegram,
                auth.id,
                [
                  sent.message_id
                ]
              );

              await saveEvent({
                connectionId:
                  auth.id,

                type:
                  "auto_deleted_message",

                chatId:
                  chat_id,

                messageId:
                  sent.message_id,

                data: {
                  reason:
                    "timer"
                }
              });

            } catch (error) {
              console.error(
                "Auto delete error:",
                error.message
              );
            }
          },
          seconds * 1000
        );
      }

      res.json({
        ok: true,

        message: sent,

        delete_after:
          delete_after || null,

        once:
          Boolean(once)
      });

    } catch (error) {
      console.error(
        "API /api/send:",
        error
      );

      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/*
==================================================
DELETE MESSAGE
==================================================
*/

app.post(
  "/api/delete",
  async (req, res) => {
    try {
      const auth =
        await requireConnection(
          req,
          res
        );

      if (!auth) return;

      const {
        message_ids
      } = req.body;

      if (
        !Array.isArray(message_ids) ||
        !message_ids.length
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "message_ids must be an array"
        });
      }

      const result =
        await deleteBusinessMessages(
          telegram,
          auth.id,
          message_ids
        );

      await saveEvent({
        connectionId:
          auth.id,

        type:
          "manual_delete",

        data: {
          message_ids
        }
      });

      res.json({
        ok: true,
        result
      });

    } catch (error) {
      console.error(
        "API /api/delete:",
        error
      );

      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/*
==================================================
TELEGRAM WEBHOOK
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
      "📩 TELEGRAM UPDATE RECEIVED"
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

    try {
      await handleUpdate(
        req.body,
        {
          telegram,

          saveBusinessConnection,
          getBusinessConnection,

          saveMessage,
          saveMessageEdit,
          saveDeletedMessages,

          saveEvent,

          getUserStats,

          sendMessage,
          deleteBusinessMessages,

          addIgnore,
          removeIgnore,
          isIgnored,
          getIgnoredUsers,

          setWatchSettings,
          getWatchSettings,

          getRecentMessages,
          getRecentEvents
        }
      );

      console.log(
        "✅ Update processed"
      );

    } catch (error) {
      console.error(
        "❌ UPDATE PROCESSING ERROR"
      );

      console.error(
        error
      );
    }

    /*
    Telegram всегда получает 200.
    */

    res.status(200).json({
      ok: true
    });
  }
);

/*
==================================================
SET WEBHOOK
==================================================
*/

async function configureWebhook() {
  if (
    !process.env.WEBHOOK_URL
  ) {
    console.error(
      "❌ WEBHOOK_URL is missing"
    );

    return;
  }

  const baseUrl =
    process.env.WEBHOOK_URL
      .trim()
      .replace(/\/+$/, "");

  const webhookUrl =
    `${baseUrl}/webhook`;

  console.log(
    `🔗 Webhook URL: ${webhookUrl}`
  );

  try {
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
      "✅ Webhook configured"
    );

    const info =
      await telegram(
        "getWebhookInfo"
      );

    console.log(
      "=========================================="
    );

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

    console.log(
      "=========================================="
    );

    if (
      info.last_error_message
    ) {
      console.error(
        "⚠️ Telegram webhook error:",
        info.last_error_message
      );
    } else {
      console.log(
        "✅ Telegram webhook has no errors"
      );
    }

  } catch (error) {
    console.error(
      "❌ Webhook configuration error:",
      error.message
    );
  }
}

/*
==================================================
START
==================================================
*/

async function start() {
  console.log(
    "🗄️ Initializing database..."
  );

  await initDatabase();

  console.log(
    "✅ Database initialized"
  );

  app.listen(
    PORT,
    async () => {
      console.log("");
      console.log(
        "=========================================="
      );

      console.log(
        "🔥 STMA v3.0.0 STARTED"
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
        "📱 Mini App: enabled"
      );

      console.log(
        "=========================================="
      );

      await configureWebhook();
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
      "❌ UNHANDLED REJECTION:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "❌ UNCAUGHT EXCEPTION:",
      error
    );
  }
);

/*
==================================================
RUN
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