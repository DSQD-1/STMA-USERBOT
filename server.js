require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");

const db = require("./src/database");
const business = require("./src/business");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const WEB_APP_URL = process.env.WEB_APP_URL || "";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

/*
==================================================
TELEGRAM INIT DATA
==================================================
*/

function verifyTelegramInitData(initData) {
  if (!initData || !BOT_TOKEN) {
    return null;
  }

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");

    if (!hash) {
      return null;
    }

    params.delete("hash");

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
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

    if (!userRaw) {
      return null;
    }

    const user = JSON.parse(userRaw);

    if (!user?.id) {
      return null;
    }

    return user;
  } catch (error) {
    console.error("INIT DATA ERROR:", error.message);
    return null;
  }
}

/*
==================================================
AUTH
==================================================
*/

function getWebAppUser(req) {
  const initData =
    req.headers["x-telegram-init-data"] ||
    req.body?.initData ||
    "";

  return verifyTelegramInitData(initData);
}

async function requireAuth(req, res, next) {
  const user = getWebAppUser(req);

  if (!user) {
    return res.status(401).json({
      ok: false,
      error: "Telegram-пользователь не подтверждён"
    });
  }

  req.telegramUser = user;

  next();
}

/*
==================================================
 USER CONNECTION
==================================================
*/

async function getConnectionForUser(userId) {
  const connections =
    await db.getConnectionsForUser(
      Number(userId)
    );

  return connections.find(
    connection =>
      Number(connection.user_id) ===
      Number(userId)
  ) || null;
}

/*
==================================================
 HOME
==================================================
*/

app.get(
  "/api/me",
  requireAuth,
  async (req, res) => {
    try {
      const user = req.telegramUser;

      const connection =
        await getConnectionForUser(user.id);

      const stats =
        connection
          ? await db.getStats(connection.id)
          : {
              messages: 0,
              edits: 0,
              deleted: 0,
              events: 0
            };

      res.json({
        ok: true,

        user: {
          id: user.id,
          first_name:
            user.first_name || "",
          last_name:
            user.last_name || "",
          username:
            user.username || "",
          language_code:
            user.language_code || ""
        },

        connected: Boolean(connection),

        connection: connection
          ? {
              id: connection.id,
              username:
                connection.username || "",
              first_name:
                connection.first_name || ""
            }
          : null,

        stats
      });
    } catch (error) {
      console.error(
        "ME ERROR:",
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
AI PARSER
==================================================
*/

function parseAI(prompt) {
  const text =
    String(prompt || "").trim();

  const lower =
    text.toLowerCase();

  const mute =
    lower.match(
      /(?:замути|замьют|мут|mute)\s+(@?[a-zA-Z0-9_]+|\d+)(?:\s+на\s+)?(.+)?/i
    );

  if (mute) {
    return {
      action: "mute",
      target: mute[1],
      duration:
        mute[2] || "навсегда"
    };
  }

  const unmute =
    lower.match(
      /(?:размути|сними\s+мут|unmute)\s+(@?[a-zA-Z0-9_]+|\d+)/i
    );

  if (unmute) {
    return {
      action: "unmute",
      target: unmute[1]
    };
  }

  const watch =
    lower.match(
      /(?:следи|слежка|следить)\s+за\s+(@?[a-zA-Z0-9_]+|\d+)/i
    );

  if (watch) {
    return {
      action: "watch",
      target: watch[1]
    };
  }

  return {
    action: "help"
  };
}

function findUserIdFromTarget(target) {
  const value =
    String(target || "").trim();

  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  return null;
}

function parseDuration(value) {
  if (!value) {
    return null;
  }

  const s =
    String(value)
      .toLowerCase()
      .replace(",", ".")
      .trim();

  if (
    s.includes("навсегда") ||
    s === "forever"
  ) {
    return null;
  }

  const match =
    s.match(
      /(\d+(?:\.\d+)?)\s*(секунд|сек|s|seconds?|минут|мин|m|minutes?|час|часа|ч|h|hours?|день|дня|д|d|days?)/i
    );

  if (!match) {
    return null;
  }

  const number =
    Number(match[1]);

  const unit =
    match[2].toLowerCase();

  if (
    ["s", "сек", "секунд", "second", "seconds"]
      .some(x => unit.startsWith(x))
  ) {
    return Math.round(number);
  }

  if (
    ["h", "ч", "час", "часа", "hour", "hours"]
      .some(x => unit.startsWith(x))
  ) {
    return Math.round(
      number * 3600
    );
  }

  if (
    ["d", "д", "день", "дня", "day", "days"]
      .some(x => unit.startsWith(x))
  ) {
    return Math.round(
      number * 86400
    );
  }

  return Math.round(
    number * 60
  );
}

/*
==================================================
AI EXECUTION
==================================================
*/

app.post(
  "/api/ai",
  requireAuth,
  async (req, res) => {
    try {
      const prompt =
        String(
          req.body?.prompt || ""
        ).trim();

      if (!prompt) {
        return res.status(400).json({
          ok: false,
          error: "Пустой запрос"
        });
      }

      const user =
        req.telegramUser;

      const connection =
        await getConnectionForUser(
          user.id
        );

      if (!connection) {
        return res.json({
          ok: true,
          reply:
            "Сначала подключи Telegram Business к STMA."
        });
      }

      const parsed =
        parseAI(prompt);

      /*
      MUTE
      */

      if (
        parsed.action === "mute"
      ) {
        const userId =
          findUserIdFromTarget(
            parsed.target
          );

        if (!userId) {
          return res.json({
            ok: true,
            reply:
              "Для мута сейчас нужен Telegram ID. Например: «замуть 123456789 на 30 минут»."
          });
        }

        const seconds =
          parseDuration(
            parsed.duration
          );

        const expires =
          seconds
            ? Math.floor(
                Date.now() / 1000
              ) + seconds
            : null;

        await db.addMute(
          connection.id,
          userId,
          parsed.target,
          expires
        );

        await db.addEvent({
          connectionId:
            connection.id,
          type: "mute",
          data: {
            userId,
            expires
          }
        });

        return res.json({
          ok: true,
          reply:
            expires
              ? `Готово. ${parsed.target} замьючен на ${parsed.duration}.`
              : `Готово. ${parsed.target} замьючен навсегда.`
        });
      }

      /*
      UNMUTE
      */

      if (
        parsed.action === "unmute"
      ) {
        const userId =
          findUserIdFromTarget(
            parsed.target
          );

        if (!userId) {
          return res.json({
            ok: true,
            reply:
              "Для снятия мута нужен Telegram ID."
          });
        }

        await db.removeMute(
          connection.id,
          userId
        );

        await db.addEvent({
          connectionId:
            connection.id,
          type: "unmute",
          data: {
            userId
          }
        });

        return res.json({
          ok: true,
          reply:
            `Готово. Мут с ${parsed.target} снят.`
        });
      }

      /*
      WATCH
      */

      if (
        parsed.action === "watch"
      ) {
        try {
          await db.addWatch(
            connection.id,
            parsed.target
          );

          await db.addEvent({
            connectionId:
              connection.id,
            type: "watch_add",
            data: {
              target:
                parsed.target
            }
          });

          return res.json({
            ok: true,
            reply:
              `Готово. ${parsed.target} добавлен в слежку.`
          });
        } catch (error) {
          return res.json({
            ok: true,
            reply:
              error.message
          });
        }
      }

      return res.json({
        ok: true,
        reply:
          "Доступные команды:\n\n" +
          "• замуть 123456789 на 30 минут\n" +
          "• размути 123456789\n" +
          "• следи за @username"
      });
    } catch (error) {
      console.error(
        "AI ERROR:",
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
MUTES
==================================================
*/

app.get(
  "/api/mutes",
  requireAuth,
  async (req, res) => {
    try {
      const connection =
        await getConnectionForUser(
          req.telegramUser.id
        );

      if (!connection) {
        return res.json({
          ok: true,
          users: []
        });
      }

      const users =
        await db.getMutes(
          connection.id
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

app.post(
  "/api/mute",
  requireAuth,
  async (req, res) => {
    try {
      const connection =
        await getConnectionForUser(
          req.telegramUser.id
        );

      if (!connection) {
        return res.status(400).json({
          ok: false,
          error:
            "Telegram Business не подключён"
        });
      }

      const userId =
        Number(
          req.body?.user_id
        );

      if (
        !Number.isInteger(userId) ||
        userId <= 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Некорректный Telegram ID"
        });
      }

      const seconds =
        parseDuration(
          req.body?.duration
        );

      const expires =
        seconds
          ? Math.floor(
              Date.now() / 1000
            ) + seconds
          : null;

      await db.addMute(
        connection.id,
        userId,
        req.body?.username || null,
        expires
      );

      await db.addEvent({
        connectionId:
          connection.id,
        type: "mute",
        data: {
          userId,
          expires
        }
      });

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

app.post(
  "/api/unmute",
  requireAuth,
  async (req, res) => {
    try {
      const connection =
        await getConnectionForUser(
          req.telegramUser.id
        );

      if (!connection) {
        return res.status(400).json({
          ok: false,
          error:
            "Telegram Business не подключён"
        });
      }

      const userId =
        Number(
          req.body?.user_id
        );

      await db.removeMute(
        connection.id,
        userId
      );

      await db.addEvent({
        connectionId:
          connection.id,
        type: "unmute",
        data: {
          userId
        }
      });

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
WATCHES
==================================================
*/

app.get(
  "/api/watches",
  requireAuth,
  async (req, res) => {
    try {
      const connection =
        await getConnectionForUser(
          req.telegramUser.id
        );

      if (!connection) {
        return res.json({
          ok: true,
          watches: []
        });
      }

      const watches =
        await db.getWatches(
          connection.id
        );

      res.json({
        ok: true,
        watches
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

app.post(
  "/api/watches",
  requireAuth,
  async (req, res) => {
    try {
      const connection =
        await getConnectionForUser(
          req.telegramUser.id
        );

      if (!connection) {
        return res.status(400).json({
          ok: false,
          error:
            "Telegram Business не подключён"
        });
      }

      const target =
        String(
          req.body?.target || ""
        ).trim();

      if (!target) {
        return res.status(400).json({
          ok: false,
          error:
            "Укажи username или ID"
        });
      }

      await db.addWatch(
        connection.id,
        target
      );

      await db.addEvent({
        connectionId:
          connection.id,
        type: "watch_add",
        data: {
          target
        }
      });

      res.json({
        ok: true
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

app.delete(
  "/api/watches/:id",
  requireAuth,
  async (req, res) => {
    try {
      const connection =
        await getConnectionForUser(
          req.telegramUser.id
        );

      if (!connection) {
        return res.status(400).json({
          ok: false,
          error:
            "Telegram Business не подключён"
        });
      }

      await db.removeWatch(
        connection.id,
        req.params.id
      );

      await db.addEvent({
        connectionId:
          connection.id,
        type: "watch_remove",
        data: {
          id: req.params.id
        }
      });

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
HISTORY
==================================================
*/

app.get(
  "/api/history",
  requireAuth,
  async (req, res) => {
    try {
      const connection =
        await getConnectionForUser(
          req.telegramUser.id
        );

      if (!connection) {
        return res.json({
          ok: true,
          messages: []
        });
      }

      const messages =
        await db.getHistory(
          connection.id,
          100
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
  requireAuth,
  async (req, res) => {
    try {
      const connection =
        await getConnectionForUser(
          req.telegramUser.id
        );

      if (!connection) {
        return res.json({
          ok: true,
          events: []
        });
      }

      const events =
        await db.getEvents(
          connection.id,
          100
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
STATS
==================================================
*/

app.get(
  "/api/stats",
  requireAuth,
  async (req, res) => {
    try {
      const connection =
        await getConnectionForUser(
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
        await db.getStats(
          connection.id
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
SEND MESSAGE
==================================================
*/

app.post(
  "/api/send",
  requireAuth,
  async (req, res) => {
    try {
      const connection =
        await getConnectionForUser(
          req.telegramUser.id
        );

      if (!connection) {
        return res.status(400).json({
          ok: false,
          error:
            "Telegram Business не подключён"
        });
      }

      const chatId =
        Number(
          req.body?.chat_id
        );

      const text =
        String(
          req.body?.text || ""
        ).trim();

      const deleteAfter =
        Number(
          req.body?.delete_after || 0
        );

      if (
        !Number.isInteger(chatId) ||
        !text
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Нужны chat_id и текст"
        });
      }

      const sent =
        await business.sendBusinessMessage(
          BOT_TOKEN,
          connection.id,
          chatId,
          text
        );

      if (
        deleteAfter > 0
      ) {
        const deleteAt =
          Math.floor(
            Date.now() / 1000
          ) + deleteAfter;

        await db.scheduleDelete(
          connection.id,
          chatId,
          sent.message_id,
          deleteAt
        );
      }

      await db.addEvent({
        connectionId:
          connection.id,
        type:
          "send_message",
        chatId,
        messageId:
          sent.message_id,
        data: {
          deleteAfter
        }
      });

      res.json({
        ok: true,
        message_id:
          sent.message_id
      });
    } catch (error) {
      console.error(
        "SEND ERROR:",
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
  "/telegram/webhook",
  async (req, res) => {
    try {
      if (
        WEBHOOK_SECRET &&
        req.headers["x-telegram-bot-api-secret-token"] !==
          WEBHOOK_SECRET
      ) {
        return res.status(403).json({
          ok: false,
          error: "Forbidden"
        });
      }

      await business.handleUpdate(
        req.body,
        {
          token: BOT_TOKEN
        }
      );

      res.json({
        ok: true
      });
    } catch (error) {
      console.error(
        "WEBHOOK ERROR:",
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
HEALTH
==================================================
*/

app.get(
  "/health",
  async (req, res) => {
    res.json({
      ok: true,
      service: "STMA",
      database: "libsql",
      time:
        new Date().toISOString()
    });
  }
);

/*
==================================================
SPA
==================================================
*/

app.get(
  "*",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

/*
==================================================
SCHEDULED DELETES
==================================================
*/

setInterval(
  async () => {
    try {
      await business.processDueDeletes({
        token: BOT_TOKEN
      });
    } catch (error) {
      console.error(
        "DELETE LOOP ERROR:",
        error.message
      );
    }
  },
  5000
);

/*
==================================================
START
==================================================
*/

app.listen(
  PORT,
  () => {
    console.log("");
    console.log(
      "================================"
    );
    console.log(
      "          STMA STARTED"
    );
    console.log(
      "================================"
    );
    console.log(
      `PORT: ${PORT}`
    );
    console.log(
      `BOT TOKEN: ${
        BOT_TOKEN
          ? "configured"
          : "NOT SET"
      }`
    );
    console.log(
      `TURSO URL: ${
        process.env.TURSO_DATABASE_URL
          ? "configured"
          : "NOT SET"
      }`
    );
    console.log(
      `TURSO TOKEN: ${
        process.env.TURSO_AUTH_TOKEN
          ? "configured"
          : "NOT SET"
      }`
    );
    console.log(
      `WEB APP URL: ${
        WEB_APP_URL || "NOT SET"
      }`
    );
    console.log(
      "================================"
    );
    console.log("");
  }
);