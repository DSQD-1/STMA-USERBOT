require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");

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
  getRecentEvents,
  createScheduledMessage,
  getScheduledMessages,
  deleteScheduledMessage
} = require("./src/database");

const {
  handleUpdate,
  sendMessage,
  deleteBusinessMessages
} = require("./src/business");

const app = express();

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

app.use(express.json({ limit: "10mb" }));

/*
==================================================
STATIC MINI APP
==================================================
*/

app.use(express.static(
  path.join(__dirname, "public")
));

/*
==================================================
TELEGRAM API
==================================================
*/

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
    console.error(
      `❌ Telegram ${method}:`,
      data.description
    );

    throw new Error(
      data.description || "Telegram API error"
    );
  }

  return data.result;
}

/*
==================================================
TELEGRAM WEB APP AUTH
==================================================
*/

function validateTelegramWebApp(initData) {
  if (!initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) return null;

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac(
      "sha256",
      "WebAppData"
    )
    .update(BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac(
      "sha256",
      secretKey
    )
    .update(dataCheckString)
    .digest("hex");

  if (
    calculatedHash.length !== hash.length ||
    !crypto.timingSafeEqual(
      Buffer.from(calculatedHash),
      Buffer.from(hash)
    )
  ) {
    return null;
  }

  const userRaw = params.get("user");

  if (!userRaw) return null;

  try {
    return JSON.parse(userRaw);
  } catch {
    return null;
  }
}

/*
==================================================
AUTH MIDDLEWARE
==================================================
*/

async function miniAppAuth(req, res, next) {
  const initData =
    req.headers["x-telegram-init-data"];

  const user =
    validateTelegramWebApp(initData);

  /*
   Во время разработки разрешаем DEMO.
   На production можно убрать этот режим.
  */

  if (!user) {
    if (process.env.DEV_MODE === "true") {
      req.telegramUser = {
        id: 8391457324,
        first_name: "Баобаб",
        username: "mrbro42"
      };

      return next();
    }

    return res.status(401).json({
      ok: false,
      error: "Telegram authorization required"
    });
  }

  req.telegramUser = user;

  next();
}

/*
==================================================
HEALTH
==================================================
*/

app.get("/", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "STMA",
    version: "3.0.0",
    status: "online",
    time: new Date().toISOString()
  });
});

/*
==================================================
MINI APP API
==================================================
*/

app.get(
  "/api/me",
  miniAppAuth,
  async (req, res) => {
    try {
      const user =
        req.telegramUser;

      const connection =
        await getBusinessConnectionForUser(
          user.id
        );

      if (!connection) {
        return res.json({
          ok: true,
          connected: false,
          user
        });
      }

      const stats =
        await getUserStats(
          connection.connection_id
        );

      const watch =
        await getWatchSettings(
          connection.connection_id
        );

      return res.json({
        ok: true,
        connected: true,
        user,
        connection,
        stats,
        watch
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

async function getBusinessConnectionForUser(
  userId
) {
  const result =
    await require("./src/database")
      .db
      .execute({
        sql: `
          SELECT *
          FROM business_connections
          WHERE user_id = ?
          AND is_enabled = 1
          ORDER BY updated_at DESC
          LIMIT 1
        `,
        args: [
          String(userId)
        ]
      });

  return result.rows[0] || null;
}

/*
==================================================
STATS
==================================================
*/

app.get(
  "/api/stats",
  miniAppAuth,
  async (req, res) => {
    try {
      const connection =
        await getBusinessConnectionForUser(
          req.telegramUser.id
        );

      if (!connection) {
        return res.json({
          ok: true,
          stats: {
            messages: 0,
            edits: 0,
            deleted: 0,
            events: 0
          }
        });
      }

      const stats =
        await getUserStats(
          connection.connection_id
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
  miniAppAuth,
  async (req, res) => {
    try {
      const connection =
        await getBusinessConnectionForUser(
          req.telegramUser.id
        );

      if (!connection) {
        return res.json({
          ok: true,
          messages: [],
          events: []
        });
      }

      const messages =
        await getRecentMessages(
          connection.connection_id,
          50
        );

      const events =
        await getRecentEvents(
          connection.connection_id,
          50
        );

      res.json({
        ok: true,
        messages,
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
  miniAppAuth,
  async (req, res) => {
    try {
      const {
        user_id,
        duration
      } = req.body;

      if (!user_id) {
        return res.status(400).json({
          ok: false,
          error: "user_id required"
        });
      }

      const connection =
        await getBusinessConnectionForUser(
          req.telegramUser.id
        );

      if (!connection) {
        return res.status(400).json({
          ok: false,
          error: "Business connection not found"
        });
      }

      await addIgnore(
        connection.connection_id,
        user_id
      );

      await saveEvent({
        connectionId:
          connection.connection_id,
        type: "mute",
        data: {
          user_id: String(user_id),
          duration:
            duration || null
        }
      });

      /*
       В личку владельцу.
       Не отправляем служебное сообщение
       в Business-чат.
      */

      await telegram(
        "sendMessage",
        {
          chat_id:
            req.telegramUser.id,

          text:
`🔇 Пользователь замучен

👤 ${String(user_id)}
⏱ ${duration || "Навсегда"}

Новые сообщения пользователя
будут автоматически удаляться.`
        }
      );

      res.json({
        ok: true
      });
    } catch (error) {
      console.error(error);

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
  miniAppAuth,
  async (req, res) => {
    try {
      const {
        user_id
      } = req.body;

      if (!user_id) {
        return res.status(400).json({
          ok: false,
          error: "user_id required"
        });
      }

      const connection =
        await getBusinessConnectionForUser(
          req.telegramUser.id
        );

      if (!connection) {
        return res.status(400).json({
          ok: false,
          error: "Business connection not found"
        });
      }

      await removeIgnore(
        connection.connection_id,
        user_id
      );

      await saveEvent({
        connectionId:
          connection.connection_id,
        type: "unmute",
        data: {
          user_id: String(user_id)
        }
      });

      await telegram(
        "sendMessage",
        {
          chat_id:
            req.telegramUser.id,

          text:
`🔊 Пользователь размьючен

👤 ${String(user_id)}

Его сообщения снова будут
поступать нормально.`
        }
      );

      res.json({
        ok: true
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
  miniAppAuth,
  async (req, res) => {
    try {
      const connection =
        await getBusinessConnectionForUser(
          req.telegramUser.id
        );

      if (!connection) {
        return res.json({
          ok: true,
          users: []
        });
      }

      const users =
        await getIgnoredUsers(
          connection.connection_id
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

app.post(
  "/api/watch",
  miniAppAuth,
  async (req, res) => {
    try {
      const connection =
        await getBusinessConnectionForUser(
          req.telegramUser.id
        );

      if (!connection) {
        return res.status(400).json({
          ok: false,
          error: "Business connection not found"
        });
      }

      await setWatchSettings(
        connection.connection_id,
        req.body
      );

      res.json({
        ok: true,
        watch:
          await getWatchSettings(
            connection.connection_id
          )
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
  miniAppAuth,
  async (req, res) => {
    try {
      const {
        chat_id,
        text,
        delete_after,
        one_time
      } = req.body;

      if (!chat_id || !text) {
        return res.status(400).json({
          ok: false,
          error: "chat_id and text required"
        });
      }

      const connection =
        await getBusinessConnectionForUser(
          req.telegramUser.id
        );

      if (!connection) {
        return res.status(400).json({
          ok: false,
          error: "Business connection not found"
        });
      }

      const sent =
        await sendMessage(
          telegram,
          connection.connection_id,
          chat_id,
          text
        );

      await saveEvent({
        connectionId:
          connection.connection_id,
        type: "message_sent",
        chatId: chat_id,
        messageId:
          sent.message_id,
        data: {
          text,
          delete_after:
            delete_after || null,
          one_time:
            Boolean(one_time)
        }
      });

      /*
       * Автоудаление
       */

      if (
        delete_after &&
        Number(delete_after) > 0
      ) {
        setTimeout(
          async () => {
            try {
              await deleteBusinessMessages(
                telegram,
                connection.connection_id,
                [sent.message_id]
              );

              await saveEvent({
                connectionId:
                  connection.connection_id,
                type:
                  "scheduled_message_deleted",
                chatId: chat_id,
                messageId:
                  sent.message_id
              });

              await telegram(
                "sendMessage",
                {
                  chat_id:
                    req.telegramUser.id,

                  text:
`🗑 Сообщение удалено

👤 ${chat_id}
⏱ Таймер завершён
🆔 ${sent.message_id}`
                }
              );
            } catch (error) {
              console.error(
                "Auto delete error:",
                error.message
              );
            }
          },
          Number(delete_after) * 1000
        );
      }

      await telegram(
        "sendMessage",
        {
          chat_id:
            req.telegramUser.id,

          text:
`✅ Сообщение отправлено

👤 ${chat_id}
⏱ Автоудаление: ${
            delete_after
              ? `${delete_after} сек.`
              : "выключено"
          }
🔂 Одноразовое: ${
            one_time ? "да" : "нет"
          }`
        }
      );

      res.json({
        ok: true,
        message: sent
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/*
==================================================
AI
==================================================
*/

app.post(
  "/api/ai",
  miniAppAuth,
  async (req, res) => {
    const prompt =
      String(req.body.prompt || "")
        .trim();

    if (!prompt) {
      return res.status(400).json({
        ok: false,
        error: "prompt required"
      });
    }

    /*
     * Пока AI-движок не подключён.
     * UI уже готов для него.
     */

    res.json({
      ok: true,
      reply:
        `Я понял запрос:\n\n«${prompt}»\n\nAI-модуль STMA будет выполнять действия после подтверждения.`,
      action: null
    });
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

    res.status(200).json({
      ok: true
    });
  }
);

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
        "🌐 Mini App: enabled"
      );

      console.log(
        "=========================================="
      );

      if (!process.env.WEBHOOK_URL) {
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
          JSON.stringify(
            info,
            null,
            2
          )
        );
      } catch (error) {
        console.error(
          "❌ Webhook error:",
          error.message
        );
      }
    }
  );
}

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "❌ UNHANDLED REJECTION",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "❌ UNCAUGHT EXCEPTION",
      error
    );
  }
);

start().catch(
  error => {
    console.error(
      "❌ STMA FAILED TO START",
      error
    );

    process.exit(1);
  }
);