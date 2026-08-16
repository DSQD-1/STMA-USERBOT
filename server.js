require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");

const db = require("./src/database");
const business = require("./src/business");

const app = express();

/*
==================================================
CONFIG
==================================================
*/

const PORT =
  Number(process.env.PORT) || 3000;

const BOT_TOKEN =
  String(process.env.BOT_TOKEN || "").trim();

const WEB_APP_URL =
  String(process.env.WEB_APP_URL || "").trim();

const WEBHOOK_SECRET =
  String(
    process.env.WEBHOOK_SECRET || ""
  ).trim();

/*
==================================================
 EXPRESS
==================================================
*/

app.disable("x-powered-by");

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

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
    const params =
      new URLSearchParams(initData);

    const receivedHash =
      params.get("hash");

    if (!receivedHash) {
      return null;
    }

    params.delete("hash");

    const dataCheckString =
      [...params.entries()]
        .sort(([a], [b]) =>
          a.localeCompare(b)
        )
        .map(
          ([key, value]) =>
            `${key}=${value}`
        )
        .join("\n");

    /*
    Telegram Web App verification
    */

    const secretKey =
      crypto
        .createHmac(
          "sha256",
          "WebAppData"
        )
        .update(BOT_TOKEN)
        .digest();

    const calculatedHash =
      crypto
        .createHmac(
          "sha256",
          secretKey
        )
        .update(dataCheckString)
        .digest("hex");

    if (
      calculatedHash.length !==
      receivedHash.length
    ) {
      return null;
    }

    if (
      !crypto.timingSafeEqual(
        Buffer.from(
          calculatedHash,
          "utf8"
        ),
        Buffer.from(
          receivedHash,
          "utf8"
        )
      )
    ) {
      return null;
    }

    const userRaw =
      params.get("user");

    if (!userRaw) {
      return null;
    }

    const user =
      JSON.parse(userRaw);

    if (!user || !user.id) {
      return null;
    }

    return user;
  } catch (error) {
    console.error(
      "INIT DATA ERROR:",
      error.message
    );

    return null;
  }
}

/*
==================================================
 TELEGRAM USER
==================================================
*/

function getTelegramUser(req) {
  /*
  Основной вариант:
  Telegram Web App отправляет initData
  */

  const initData =
    req.headers[
      "x-telegram-init-data"
    ] ||
    req.headers[
      "x-telegram-initdata"
    ] ||
    "";

  return verifyTelegramInitData(
    initData
  );
}

/*
==================================================
 AUTH MIDDLEWARE
==================================================
*/

function requireAuth(req, res, next) {
  const user =
    getTelegramUser(req);

  if (!user) {
    return res.status(401).json({
      ok: false,
      authenticated: false,
      error:
        "Открой STMA через Telegram-бота."
    });
  }

  req.telegramUser =
    user;

  next();
}

/*
==================================================
 CONNECTION
==================================================
*/

function getConnectionForUser(userId) {
  if (
    typeof db.getConnectionsForUser ===
    "function"
  ) {
    const connections =
      db.getConnectionsForUser(
        userId
      );

    return (
      connections[0] ||
      null
    );
  }

  /*
  Совместимость с текущей database.js
  */

  const result =
    db.db
      ?.prepare(
        `
        SELECT *
        FROM business_connections
        WHERE user_id = ?
          AND is_enabled = 1
        ORDER BY updated_at DESC
        `
      )
      ?.all(userId);

  return (
    result?.[0] ||
    null
  );
}

/*
==================================================
 EMPTY STATS
==================================================
*/

function emptyStats() {
  return {
    messages: 0,
    edits: 0,
    deleted: 0,
    events: 0
  };
}

/*
==================================================
 HOME
==================================================
*/

app.get(
  "/api/me",
  requireAuth,
  (req, res) => {
    const user =
      req.telegramUser;

    const connection =
      getConnectionForUser(
        user.id
      );

    const stats =
      connection
        ? db.getStats(
            connection.id
          )
        : emptyStats();

    res.json({
      ok: true,

      authenticated: true,

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

      connected:
        Boolean(connection),

      connection:
        connection
          ? {
              id:
                connection.id,

              username:
                connection.username ||
                "",

              first_name:
                connection.first_name ||
                ""
            }
          : null,

      stats
    });
  }
);

/*
==================================================
 BOT INFO
==================================================
*/

app.get(
  "/api/bot",
  requireAuth,
  async (req, res) => {
    try {
      if (!BOT_TOKEN) {
        return res.status(500).json({
          ok: false,
          error:
            "BOT_TOKEN не настроен"
        });
      }

      const bot =
        await business.getBotInfo(
          BOT_TOKEN
        );

      res.json({
        ok: true,
        bot
      });
    } catch (error) {
      console.error(
        "BOT INFO ERROR:",
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
 AI PARSER
==================================================
*/

function parseAI(prompt) {
  const text =
    String(
      prompt || ""
    ).trim();

  const lower =
    text.toLowerCase();

  /*
  MUTE
  */

  const mute =
    lower.match(
      /(?:замуть|замути|замьют|мут|mute)\s+(@?[a-zA-Z0-9_]+|\d+)(?:\s+на\s+)?(.+)?/i
    );

  if (mute) {
    return {
      action: "mute",
      target: mute[1],
      duration:
        mute[2] ||
        "Навсегда"
    };
  }

  /*
  UNMUTE
  */

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

  /*
  WATCH
  */

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

/*
==================================================
 DURATION
==================================================
*/

function parseDuration(value) {
  if (!value) {
    return null;
  }

  const text =
    String(value)
      .toLowerCase()
      .replace(",", ".")
      .trim();

  if (
    text.includes("навсегда") ||
    text === "forever"
  ) {
    return null;
  }

  const match =
    text.match(
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
    [
      "s",
      "сек",
      "секунд",
      "second",
      "seconds"
    ].some(x =>
      unit.startsWith(x)
    )
  ) {
    return Math.round(number);
  }

  if (
    [
      "h",
      "ч",
      "час",
      "часа",
      "hour",
      "hours"
    ].some(x =>
      unit.startsWith(x)
    )
  ) {
    return Math.round(
      number * 3600
    );
  }

  if (
    [
      "d",
      "д",
      "день",
      "дня",
      "day",
      "days"
    ].some(x =>
      unit.startsWith(x)
    )
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
 TARGET
==================================================
*/

function findUserId(target) {
  if (!target) {
    return null;
  }

  const value =
    String(target).trim();

  if (
    /^\d+$/.test(value)
  ) {
    const id =
      Number(value);

    if (
      Number.isSafeInteger(id) &&
      id > 0
    ) {
      return id;
    }
  }

  return null;
}

/*
==================================================
 AI EXECUTION
==================================================
*/

async function executeAI(
  req,
  prompt
) {
  const parsed =
    parseAI(prompt);

  const connection =
    getConnectionForUser(
      req.telegramUser.id
    );

  if (!connection) {
    return {
      reply:
        "Telegram Business пока не подключён к STMA."
    };
  }

  /*
  MUTE
  */

  if (
    parsed.action === "mute"
  ) {
    const userId =
      findUserId(
        parsed.target
      );

    if (!userId) {
      return {
        reply:
          "Для мута нужен Telegram ID.\n\nПример:\nзамуть 123456789 на 30 минут"
      };
    }

    const seconds =
      parseDuration(
        parsed.duration
      );

    const expiresAt =
      seconds
        ? Math.floor(
            Date.now() / 1000
          ) + seconds
        : null;

    db.addMute(
      connection.id,
      userId,
      parsed.target,
      expiresAt
    );

    db.addEvent({
      connectionId:
        connection.id,

      type:
        "mute",

      data: {
        userId,
        expiresAt
      }
    });

    return {
      reply:
        expiresAt
          ? `Готово. Пользователь ${parsed.target} добавлен в мут на ${parsed.duration}.`
          : `Готово. Пользователь ${parsed.target} добавлен в постоянный мут.`
    };
  }

  /*
  UNMUTE
  */

  if (
    parsed.action === "unmute"
  ) {
    const userId =
      findUserId(
        parsed.target
      );

    if (!userId) {
      return {
        reply:
          "Для снятия мута нужен Telegram ID."
      };
    }

    db.removeMute(
      connection.id,
      userId
    );

    db.addEvent({
      connectionId:
        connection.id,

      type:
        "unmute",

      data: {
        userId
      }
    });

    return {
      reply:
        `Готово. Мут с ${parsed.target} снят.`
    };
  }

  /*
  WATCH
  */

  if (
    parsed.action === "watch"
  ) {
    try {
      db.addWatch(
        connection.id,
        parsed.target
      );

      db.addEvent({
        connectionId:
          connection.id,

        type:
          "watch_add",

        data: {
          target:
            parsed.target
        }
      });

      return {
        reply:
          `Готово. ${parsed.target} добавлен в слежку.`
      };
    } catch (error) {
      return {
        reply:
          error.message
      };
    }
  }

  return {
    reply:
      "Я понимаю команды:\n\n" +
      "• замуть 123456789 на 30 минут\n" +
      "• размути 123456789\n" +
      "• следи за @username"
  };
}

/*
==================================================
 AI
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
          error:
            "Пустой запрос"
        });
      }

      const result =
        await executeAI(
          req,
          prompt
        );

      res.json({
        ok: true,
        ...result
      });
    } catch (error) {
      console.error(
        "AI ERROR:",
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
 MUTES
==================================================
*/

app.get(
  "/api/mutes",
  requireAuth,
  (req, res) => {
    const connection =
      getConnectionForUser(
        req.telegramUser.id
      );

    if (!connection) {
      return res.json({
        ok: true,
        users: []
      });
    }

    res.json({
      ok: true,
      users:
        db.getMutes(
          connection.id
        )
    });
  }
);

app.post(
  "/api/mute",
  requireAuth,
  (req, res) => {
    try {
      const connection =
        getConnectionForUser(
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
        !Number.isSafeInteger(
          userId
        ) ||
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

      const expiresAt =
        seconds
          ? Math.floor(
              Date.now() / 1000
            ) + seconds
          : null;

      db.addMute(
        connection.id,
        userId,
        req.body?.username ||
          null,
        expiresAt
      );

      db.addEvent({
        connectionId:
          connection.id,

        type:
          "mute",

        data: {
          userId,
          expiresAt
        }
      });

      res.json({
        ok: true
      });
    } catch (error) {
      console.error(
        "MUTE ERROR:",
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

app.post(
  "/api/unmute",
  requireAuth,
  (req, res) => {
    try {
      const connection =
        getConnectionForUser(
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
        !Number.isSafeInteger(
          userId
        ) ||
        userId <= 0
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Некорректный Telegram ID"
        });
      }

      db.removeMute(
        connection.id,
        userId
      );

      db.addEvent({
        connectionId:
          connection.id,

        type:
          "unmute",

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
        error:
          error.message
      });
    }
  }
);

/*
==================================================
 SEND
==================================================
*/

app.post(
  "/api/send",
  requireAuth,
  async (req, res) => {
    try {
      const connection =
        getConnectionForUser(
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
        !Number.isSafeInteger(
          chatId
        ) ||
        !text
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Нужны chat_id и text"
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

        db.scheduleDelete(
          connection.id,
          chatId,
          sent.message_id,
          deleteAt
        );
      }

      db.addEvent({
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
        error:
          error.message
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
  (req, res) => {
    const connection =
      getConnectionForUser(
        req.telegramUser.id
      );

    if (!connection) {
      return res.json({
        ok: true,
        watches: []
      });
    }

    res.json({
      ok: true,
      watches:
        db.getWatches(
          connection.id
        )
    });
  }
);

app.post(
  "/api/watches",
  requireAuth,
  (req, res) => {
    try {
      const connection =
        getConnectionForUser(
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

      const result =
        db.addWatch(
          connection.id,
          target
        );

      db.addEvent({
        connectionId:
          connection.id,

        type:
          "watch_add",

        data: {
          target
        }
      });

      res.json({
        ok: true,
        id:
          result?.lastInsertRowid ||
          null
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

app.delete(
  "/api/watches/:id",
  requireAuth,
  (req, res) => {
    const connection =
      getConnectionForUser(
        req.telegramUser.id
      );

    if (!connection) {
      return res.status(400).json({
        ok: false,
        error:
          "Telegram Business не подключён"
      });
    }

    db.removeWatch(
      connection.id,
      req.params.id
    );

    db.addEvent({
      connectionId:
        connection.id,

      type:
        "watch_remove",

      data: {
        id:
          req.params.id
      }
    });

    res.json({
      ok: true
    });
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
  (req, res) => {
    const connection =
      getConnectionForUser(
        req.telegramUser.id
      );

    if (!connection) {
      return res.json({
        ok: true,
        messages: []
      });
    }

    res.json({
      ok: true,
      messages:
        db.getHistory(
          connection.id,
          100
        )
    });
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
  (req, res) => {
    const connection =
      getConnectionForUser(
        req.telegramUser.id
      );

    if (!connection) {
      return res.json({
        ok: true,
        events: []
      });
    }

    res.json({
      ok: true,
      events:
        db.getEvents(
          connection.id,
          100
        )
    });
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
  (req, res) => {
    const connection =
      getConnectionForUser(
        req.telegramUser.id
      );

    if (!connection) {
      return res.json({
        ok: true,
        stats:
          emptyStats()
      });
    }

    res.json({
      ok: true,
      stats:
        db.getStats(
          connection.id
        )
    });
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
      /*
      Необязательно, но можно защитить webhook
      секретным заголовком.
      */

      if (WEBHOOK_SECRET) {
        const received =
          req.headers[
            "x-telegram-bot-api-secret-token"
          ];

        if (
          received !==
          WEBHOOK_SECRET
        ) {
          return res.status(403).json({
            ok: false,
            error:
              "Invalid webhook secret"
          });
        }
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
        error:
          error.message
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
  (req, res) => {
    const databasePath =
      typeof db.getDatabasePath ===
      "function"
        ? db.getDatabasePath()
        : "stma-data.json";

    res.json({
      ok: true,
      service: "STMA",
      time:
        new Date().toISOString(),
      database:
        databasePath
    });
  }
);

/*
==================================================
 SET WEBHOOK
==================================================
*/

async function setupWebhook() {
  if (
    !BOT_TOKEN ||
    !WEB_APP_URL
  ) {
    console.log(
      "Webhook setup skipped: BOT_TOKEN or WEB_APP_URL missing"
    );

    return;
  }

  try {
    const webhookUrl =
      `${WEB_APP_URL.replace(/\/$/, "")}/telegram/webhook`;

    await business.setWebhook(
      BOT_TOKEN,
      webhookUrl
    );

    console.log(
      `Telegram webhook: ${webhookUrl}`
    );
  } catch (error) {
    console.error(
      "WEBHOOK SETUP ERROR:",
      error.message
    );
  }
}

/*
==================================================
 TELEGRAM MENU BUTTON
==================================================

После запуска бот получит кнопку
"Открыть STMA" в меню.
==================================================
*/

async function setupBotMenu() {
  if (
    !BOT_TOKEN ||
    !WEB_APP_URL
  ) {
    return;
  }

  try {
    const response =
      await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton`,
        {
          method: "POST",

          headers: {
            "content-type":
              "application/json"
          },

          body:
            JSON.stringify({
              menu_button: {
                type:
                  "web_app",

                text:
                  "Открыть STMA",

                web_app: {
                  url:
                    WEB_APP_URL
                }
              }
            })
        }
      );

    const result =
      await response.json();

    if (!result.ok) {
      throw new Error(
        result.description ||
          "Telegram API error"
      );
    }

    console.log(
      "Telegram menu button configured"
    );
  } catch (error) {
    console.error(
      "MENU BUTTON ERROR:",
      error.message
    );
  }
}

/*
==================================================
 DELETE LOOP
==================================================
*/

setInterval(
  async () => {
    try {
      if (!BOT_TOKEN) {
        return;
      }

      await business.processDueDeletes({
        token:
          BOT_TOKEN
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
 SPA FALLBACK
==================================================
*/

app.use(
  (req, res, next) => {
    if (
      req.method !== "GET" ||
      req.path.startsWith("/api/") ||
      req.path.startsWith("/telegram/") ||
      req.path === "/health"
    ) {
      return next();
    }

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
 START
==================================================
*/

const server =
  app.listen(
    PORT,
    async () => {
      console.log("");
      console.log(
        "================================"
      );
      console.log(
        "          STMA 2.0"
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
        `WEB APP URL: ${
          WEB_APP_URL ||
          "NOT SET"
        }`
      );

      console.log(
        `DATABASE: ${
          typeof db.getDatabasePath ===
          "function"
            ? db.getDatabasePath()
            : "stma-data.json"
        }`
      );

      console.log(
        "================================"
      );
      console.log("");

      await setupWebhook();
      await setupBotMenu();
    }
  );

/*
==================================================
 GRACEFUL SHUTDOWN
==================================================
*/

function shutdown(signal) {
  console.log(
    `${signal}: shutting down...`
  );

  server.close(() => {
    process.exit(0);
  });
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);