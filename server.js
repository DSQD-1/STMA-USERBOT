require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");

const db = require("./src/database");
const business = require("./src/business");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const OWNER_ID = Number(
  process.env.OWNER_ID || db.getSetting("owner_id") || 0
);

if (OWNER_ID) {
  db.setSetting("owner_id", OWNER_ID);
}

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

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

    return JSON.parse(userRaw);
  } catch {
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
    req.headers["x-telegram-init-data"] || "";

  const telegramUser =
    verifyTelegramInitData(initData);

  if (telegramUser) {
    return telegramUser;
  }

  /*
    В development можно работать без Telegram,
    если ENABLE_DEV_AUTH=true.
  */

  if (
    process.env.ENABLE_DEV_AUTH === "true" &&
    OWNER_ID
  ) {
    return {
      id: OWNER_ID,
      first_name: "STMA",
      username: "developer"
    };
  }

  return null;
}

function requireAuth(req, res, next) {
  const user = getWebAppUser(req);

  if (!user) {
    return res.status(401).json({
      ok: false,
      error: "Не удалось подтвердить Telegram-пользователя"
    });
  }

  req.telegramUser = user;

  next();
}

/*
==================================================
CONNECTION
==================================================
*/

function getConnectionForUser(userId) {
  const rows = db.db
    .prepare(`
      SELECT *
      FROM business_connections
      WHERE user_id = ?
        AND is_enabled = 1
      ORDER BY updated_at DESC
    `)
    .all(Number(userId));

  return rows[0] || null;
}

/*
==================================================
HOME / ME
==================================================
*/

app.get("/api/me", requireAuth, (req, res) => {
  const user =
    req.telegramUser;

  const connection =
    getConnectionForUser(user.id);

  const stats =
    connection
      ? db.getStats(connection.id)
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
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      username: user.username || "",
      language_code: user.language_code || ""
    },

    connected: Boolean(connection),

    connection: connection
      ? {
          id: connection.id,
          username: connection.username,
          first_name: connection.first_name
        }
      : null,

    stats
  });
});

/*
==================================================
AI
==================================================
*/

function parseAI(prompt) {
  const text =
    String(prompt || "")
      .trim();

  const lower =
    text.toLowerCase();

  /*
    MUTE
  */

  const mute =
    lower.match(
      /(?:замути|замьют|мут|mute)\s+(@?[a-zA-Z0-9_]+|\d+)(?:\s+на\s+)?(.+)?/i
    );

  if (mute) {
    const target =
      mute[1];

    const duration =
      mute[2] ||
      "Навсегда";

    return {
      action: "mute",
      target,
      duration
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

function findUserIdFromTarget(target) {
  if (!target) {
    return null;
  }

  const value =
    String(target).trim();

  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  return null;
}

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
        "Сначала подключи Telegram к STMA."
    };
  }

  /*
    MUTE
  */

  if (parsed.action === "mute") {
    const userId =
      findUserIdFromTarget(
        parsed.target
      );

    if (!userId) {
      return {
        reply:
          "Для мута через AI сейчас нужен Telegram ID пользователя. Например: «замуть 123456789 на 30 минут»."
      };
    }

    const seconds =
      parseDuration(parsed.duration);

    const expires =
      seconds
        ? Math.floor(Date.now() / 1000) +
          seconds
        : null;

    db.addMute(
      connection.id,
      userId,
      parsed.target,
      expires
    );

    db.addEvent({
      connectionId: connection.id,
      type: "mute",
      data: {
        userId,
        expires
      }
    });

    return {
      reply:
        expires
          ? `Готово. Пользователь ${parsed.target} замьючен на ${parsed.duration}.`
          : `Готово. Пользователь ${parsed.target} замьючен навсегда.`
    };
  }

  /*
    UNMUTE
  */

  if (parsed.action === "unmute") {
    const userId =
      findUserIdFromTarget(
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
      connectionId: connection.id,
      type: "unmute",
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

  if (parsed.action === "watch") {
    try {
      db.addWatch(
        connection.id,
        parsed.target
      );

      db.addEvent({
        connectionId: connection.id,
        type: "watch_add",
        data: {
          target: parsed.target
        }
      });

      return {
        reply:
          `Готово. ${parsed.target} добавлен в слежку.`
      };
    } catch (error) {
      return {
        reply:
          error.message ||
          "Не удалось добавить цель."
      };
    }
  }

  return {
    reply:
      "Я могу выполнить команды вроде:\n\n" +
      "• замуть 123456789 на 30 минут\n" +
      "• размути 123456789\n" +
      "• следи за @username\n\n" +
      "Все результаты действий отображаются внутри STMA."
  };
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

  const n =
    Number(match[1]);

  const unit =
    match[2];

  if (
    ["s", "sec", "сек", "секунд", "seconds", "second"]
      .some(x =>
        unit.startsWith(x)
      )
  ) {
    return Math.round(n);
  }

  if (
    ["h", "ч", "час", "часа", "hours", "hour"]
      .some(x =>
        unit.startsWith(x)
      )
  ) {
    return Math.round(n * 3600);
  }

  if (
    ["d", "д", "день", "дня", "days", "day"]
      .some(x =>
        unit.startsWith(x)
      )
  ) {
    return Math.round(n * 86400);
  }

  return Math.round(n * 60);
}

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
          error: "STMA не подключён"
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
          error: "Некорректный Telegram ID"
        });
      }

      const seconds =
        parseDuration(
          req.body?.duration
        );

      const expires =
        seconds
          ? Math.floor(Date.now() / 1000) +
            seconds
          : null;

      db.addMute(
        connection.id,
        userId,
        null,
        expires
      );

      db.addEvent({
        connectionId: connection.id,
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
  (req, res) => {
    try {
      const connection =
        getConnectionForUser(
          req.telegramUser.id
        );

      if (!connection) {
        return res.status(400).json({
          ok: false,
          error: "STMA не подключён"
        });
      }

      const userId =
        Number(
          req.body?.user_id
        );

      db.removeMute(
        connection.id,
        userId
      );

      db.addEvent({
        connectionId: connection.id,
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
SEND MESSAGE
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
          error: "STMA не подключён"
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

      const oneTime =
        Boolean(
          req.body?.one_time
        );

      if (
        !Number.isInteger(chatId) ||
        !text
      ) {
        return res.status(400).json({
          ok: false,
          error: "Нужны chat ID и текст"
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
          Math.floor(Date.now() / 1000) +
          deleteAfter;

        db.scheduleDelete(
          connection.id,
          chatId,
          sent.message_id,
          deleteAt
        );
      }

      db.addEvent({
        connectionId: connection.id,
        type: "send_message",
        chatId,
        messageId:
          sent.message_id,
        data: {
          deleteAfter,
          oneTime
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
          error: "STMA не подключён"
        });
      }

      const target =
        String(
          req.body?.target || ""
        ).trim();

      if (!target) {
        return res.status(400).json({
          ok: false,
          error: "Укажи username или ID"
        });
      }

      db.addWatch(
        connection.id,
        target
      );

      db.addEvent({
        connectionId: connection.id,
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
  (req, res) => {
    const connection =
      getConnectionForUser(
        req.telegramUser.id
      );

    if (!connection) {
      return res.status(400).json({
        ok: false,
        error: "STMA не подключён"
      });
    }

    db.removeWatch(
      connection.id,
      req.params.id
    );

    db.addEvent({
      connectionId: connection.id,
      type: "watch_remove",
      data: {
        id: req.params.id
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
        stats: {
          messages: 0,
          edits: 0,
          deleted: 0,
          events: 0
        }
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
  (req, res) => {
    res.json({
      ok: true,
      service: "STMA",
      time: new Date().toISOString()
    });
  }
);

/*
==================================================
SPA FALLBACK
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
SCHEDULED DELETE LOOP
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
        error
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
    console.log("================================");
    console.log("          STMA STARTED");
    console.log("================================");
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
      `OWNER ID: ${
        OWNER_ID || "NOT SET"
      }`
    );
    console.log("================================");
    console.log("");
  }
);