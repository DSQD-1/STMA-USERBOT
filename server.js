const express = require("express");
const crypto = require("crypto");
const path = require("path");

const db = require("./src/database");
const business = require("./src/business");

const app = express();

const PORT = Number(
  process.env.PORT || 10000
);

const TOKEN =
  process.env.BOT_TOKEN;

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use(
  express.urlencoded({
    extended: false
  })
);

if (!TOKEN) {
  console.error(
    "❌ BOT_TOKEN не задан."
  );

  process.exit(1);
}

/* =========================
   HELPERS
========================= */

function error(res, status, message) {
  return res
    .status(status)
    .json({
      ok: false,
      error: message
    });
}

async function telegram(
  method,
  payload = {}
) {
  return business.callTelegram(
    TOKEN,
    method,
    payload
  );
}

/* =========================
   TELEGRAM MINI APP AUTH
========================= */

function validateInitData(initData) {
  if (
    !initData ||
    typeof initData !== "string"
  ) {
    return null;
  }

  const params =
    new URLSearchParams(initData);

  const hash =
    params.get("hash");

  const authDate =
    Number(
      params.get("auth_date") || 0
    );

  if (!hash || !authDate) {
    return null;
  }

  const maxAge =
    24 * 60 * 60;

  if (
    Math.floor(Date.now() / 1000) -
      authDate >
    maxAge
  ) {
    return null;
  }

  const checkString =
    [...params.entries()]
      .filter(
        ([key]) => key !== "hash"
      )
      .sort(([a], [b]) =>
        a.localeCompare(b)
      )
      .map(
        ([key, value]) =>
          `${key}=${value}`
      )
      .join("\n");

  const secret =
    crypto
      .createHmac(
        "sha256",
        "WebAppData"
      )
      .update(TOKEN)
      .digest();

  const calculated =
    crypto
      .createHmac(
        "sha256",
        secret
      )
      .update(checkString)
      .digest("hex");

  if (
    calculated.length !==
    hash.length
  ) {
    return null;
  }

  if (
    !crypto.timingSafeEqual(
      Buffer.from(calculated),
      Buffer.from(hash)
    )
  ) {
    return null;
  }

  try {
    const user =
      JSON.parse(
        params.get("user") || "null"
      );

    if (!user?.id) {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}

function auth(req, res, next) {
  const user =
    validateInitData(
      req.get(
        "X-Telegram-Init-Data"
      ) || ""
    );

  if (!user) {
    return error(
      res,
      401,
      "Telegram authorization required."
    );
  }

  db.saveUser(user);

  if (
    !db.getSetting("owner_id")
  ) {
    db.setSetting(
      "owner_id",
      user.id
    );
  }

  req.telegramUser = user;

  next();
}

/* =========================
   CONNECTION
========================= */

function currentConnection() {
  return (
    db
      .getConnections()
      .find(
        connection =>
          Number(
            connection.is_enabled
          ) === 1
      ) || null
  );
}

/* =========================
   WEBHOOK
========================= */

app.use(
  "/telegram/webhook",
  (req, res, next) => {
    const expected =
      process.env.WEBHOOK_SECRET;

    if (!expected) {
      return next();
    }

    const actual =
      req.get(
        "X-Telegram-Bot-Api-Secret-Token"
      );

    if (actual !== expected) {
      return res
        .status(403)
        .send("Forbidden");
    }

    next();
  }
);

app.post(
  "/telegram/webhook",
  async (req, res) => {
    try {
      await business.handleUpdate(
        req.body,
        {
          token: TOKEN
        }
      );

      res.json({
        ok: true
      });
    } catch (e) {
      console.error(
        "Webhook error:",
        e
      );

      res.json({
        ok: true
      });
    }
  }
);

/* =========================
   ME
========================= */

app.get(
  "/api/me",
  auth,
  (req, res) => {
    const connection =
      currentConnection();

    const stats =
      connection
        ? db.getStats(
            connection.id
          )
        : {
            messages: 0,
            edits: 0,
            deleted: 0,
            events: 0
          };

    res.json({
      ok: true,

      user:
        req.telegramUser,

      connected:
        Boolean(connection),

      connection:
        connection
          ? {
              id: connection.id,
              enabled:
                Boolean(
                  connection.is_enabled
                ),
              rights:
                JSON.parse(
                  connection.rights_json ||
                    "{}"
                )
            }
          : null,

      stats
    });
  }
);

/* =========================
   AI
========================= */

function parseDuration(
  amount,
  unit
) {
  if (!amount) {
    return null;
  }

  const n =
    Number(amount);

  const u =
    String(unit || "")
      .toLowerCase();

  if (
    u.startsWith("сек") ||
    u === "с"
  ) {
    return n;
  }

  if (
    u.startsWith("мин") ||
    u === "м"
  ) {
    return n * 60;
  }

  if (
    u.startsWith("час") ||
    u === "ч"
  ) {
    return n * 3600;
  }

  if (
    u.startsWith("д")
  ) {
    return n * 86400;
  }

  return n * 60;
}

function parseAI(text) {
  const prompt =
    String(text || "")
      .trim();

  let match =
    prompt.match(
      /(?:замути|замьют|мут|mute)\s+(@?[A-Za-z0-9_]+|\d+)(?:\s+(?:на\s+)?(\d+)\s*(секунд[а-я]*|сек|с|минут[а-я]*|мин|м|час(?:а|ов)?|ч|дн(?:ей|я)?|д))?/i
    );

  if (match) {
    return {
      action: "mute",
      target: match[1],
      seconds:
        match[2]
          ? parseDuration(
              match[2],
              match[3]
            )
          : null
    };
  }

  match =
    prompt.match(
      /(?:размуть|сними\s+мут|unmute)\s+(@?[A-Za-z0-9_]+|\d+)/i
    );

  if (match) {
    return {
      action: "unmute",
      target: match[1]
    };
  }

  match =
    prompt.match(
      /(?:отправь|напиши|написать)\s+(@?[A-Za-z0-9_]+|\d+)\s*[:,-]\s*(.+)/i
    );

  if (match) {
    return {
      action: "send",
      target: match[1],
      text: match[2]
    };
  }

  return {
    action: "unknown"
  };
}

app.post(
  "/api/ai",
  auth,
  async (req, res) => {
    const connection =
      currentConnection();

    if (!connection) {
      return error(
        res,
        400,
        "Нет активного подключения."
      );
    }

    const parsed =
      parseAI(
        req.body?.prompt
      );

    try {
      /* MUTЕ */

      if (
        parsed.action ===
        "mute"
      ) {
        if (
          !/^\d+$/.test(
            parsed.target
          )
        ) {
          return res.json({
            ok: true,
            reply:
              "Для @username нужен Telegram ID или используй мут ответом на сообщение пользователя."
          });
        }

        const expires =
          parsed.seconds
            ? Math.floor(
                Date.now() / 1000
              ) +
              parsed.seconds
            : null;

        db.addMute(
          connection.id,
          Number(parsed.target),
          parsed.target,
          expires
        );

        db.addEvent({
          connectionId:
            connection.id,
          type: "mute",
          data: {
            userId:
              Number(
                parsed.target
              ),
            expires,
            source: "ai"
          }
        });

        return res.json({
          ok: true,
          reply:
            `🔇 ${parsed.target} замьючен.`
        });
      }

      /* UNMUTE */

      if (
        parsed.action ===
        "unmute"
      ) {
        if (
          !/^\d+$/.test(
            parsed.target
          )
        ) {
          return res.json({
            ok: true,
            reply:
              "Для @username нужен Telegram ID."
          });
        }

        db.removeMute(
          connection.id,
          Number(parsed.target)
        );

        db.addEvent({
          connectionId:
            connection.id,
          type: "unmute",
          data: {
            userId:
              Number(
                parsed.target
              ),
            source: "ai"
          }
        });

        return res.json({
          ok: true,
          reply:
            `🔊 Мут с ${parsed.target} снят.`
        });
      }

      /* SEND */

      if (
        parsed.action ===
        "send"
      ) {
        if (
          !/^-?\d+$/.test(
            parsed.target
          )
        ) {
          return res.json({
            ok: true,
            reply:
              "Для отправки сейчас нужен Telegram chat ID."
          });
        }

        const sent =
          await business.sendBusinessMessage(
            TOKEN,
            connection.id,
            Number(
              parsed.target
            ),
            parsed.text
          );

        db.addEvent({
          connectionId:
            connection.id,
          type:
            "send_message",
          chatId:
            Number(
              parsed.target
            ),
          messageId:
            sent.message_id,
          data: {
            source: "ai"
          }
        });

        return res.json({
          ok: true,
          reply:
            "✉️ Сообщение отправлено."
        });
      }

      return res.json({
        ok: true,
        reply:
          "Попробуй: «замуть 123456789 на 30 минут», «сними мут с 123456789» или «отправь 123456789: Привет»."
      });
    } catch (e) {
      return error(
        res,
        500,
        e.message
      );
    }
  }
);

/* =========================
   MUTES
========================= */

app.get(
  "/api/mutes",
  auth,
  (req, res) => {
    const connection =
      currentConnection();

    res.json({
      ok: true,
      users:
        connection
          ? db.getMutes(
              connection.id
            )
          : []
    });
  }
);

app.post(
  "/api/mute",
  auth,
  (req, res) => {
    const connection =
      currentConnection();

    if (!connection) {
      return error(
        res,
        400,
        "Нет подключения."
      );
    }

    const userId =
      String(
        req.body?.user_id ||
          ""
      ).trim();

    if (
      !/^\d+$/.test(
        userId
      )
    ) {
      return error(
        res,
        400,
        "Нужен Telegram ID."
      );
    }

    const durations = {
      "10 секунд": 10,
      "1 минута": 60,
      "5 минут": 300,
      "30 минут": 1800,
      "1 час": 3600,
      "24 часа": 86400,
      "Навсегда": null
    };

    const duration =
      String(
        req.body?.duration ||
          "Навсегда"
      );

    const seconds =
      Object.prototype.hasOwnProperty.call(
        durations,
        duration
      )
        ? durations[duration]
        : null;

    const expires =
      seconds
        ? Math.floor(
            Date.now() / 1000
          ) + seconds
        : null;

    db.addMute(
      connection.id,
      Number(userId),
      null,
      expires
    );

    db.addEvent({
      connectionId:
        connection.id,
      type: "mute",
      data: {
        userId:
          Number(userId),
        expires,
        source:
          "miniapp"
      }
    });

    res.json({
      ok: true
    });
  }
);

app.post(
  "/api/unmute",
  auth,
  (req, res) => {
    const connection =
      currentConnection();

    if (!connection) {
      return error(
        res,
        400,
        "Нет подключения."
      );
    }

    const userId =
      String(
        req.body?.user_id ||
          ""
      ).trim();

    if (
      !/^\d+$/.test(
        userId
      )
    ) {
      return error(
        res,
        400,
        "Нужен Telegram ID."
      );
    }

    db.removeMute(
      connection.id,
      Number(userId)
    );

    db.addEvent({
      connectionId:
        connection.id,
      type: "unmute",
      data: {
        userId:
          Number(userId),
        source:
          "miniapp"
      }
    });

    res.json({
      ok: true
    });
  }
);

/* =========================
   SEND MESSAGE
========================= */

app.post(
  "/api/send",
  auth,
  async (req, res) => {
    const connection =
      currentConnection();

    if (!connection) {
      return error(
        res,
        400,
        "Нет подключения."
      );
    }

    const chatId =
      String(
        req.body?.chat_id ||
          ""
      ).trim();

    const text =
      String(
        req.body?.text ||
          ""
      ).trim();

    const deleteAfter =
      Math.max(
        0,
        Number(
          req.body?.delete_after ||
            0
        )
      );

    const oneTime =
      Boolean(
        req.body?.one_time
      );

    if (
      !/^-?\d+$/.test(
        chatId
      )
    ) {
      return error(
        res,
        400,
        "Нужен Telegram chat ID."
      );
    }

    if (!text) {
      return error(
        res,
        400,
        "Введите сообщение."
      );
    }

    try {
      const sent =
        await business.sendBusinessMessage(
          TOKEN,
          connection.id,
          Number(chatId),
          text
        );

      /*
       * Одноразовое сообщение:
       * удаляем после первого заданного
       * таймера. Если таймер не указан —
       * через 1 секунду.
       */

      if (
        deleteAfter > 0 ||
        oneTime
      ) {
        db.addScheduledDelete(
          connection.id,
          Number(chatId),
          sent.message_id,
          Math.min(
            deleteAfter ||
              1,
            7 * 86400
          )
        );
      }

      db.addEvent({
        connectionId:
          connection.id,
        type:
          "send_message",
        chatId:
          Number(chatId),
        messageId:
          sent.message_id,
        data: {
          deleteAfter,
          oneTime
        }
      });

      res.json({
        ok: true,
        message: sent
      });
    } catch (e) {
      return error(
        res,
        400,
        e.message
      );
    }
  }
);

/* =========================
   HISTORY
========================= */

app.get(
  "/api/history",
  auth,
  (req, res) => {
    const connection =
      currentConnection();

    res.json({
      ok: true,
      messages:
        connection
          ? db.getMessages(
              connection.id,
              50
            )
          : []
    });
  }
);

app.get(
  "/api/events",
  auth,
  (req, res) => {
    const connection =
      currentConnection();

    res.json({
      ok: true,
      events:
        connection
          ? db.getEvents(
              connection.id,
              50
            )
          : []
    });
  }
);

app.get(
  "/api/stats",
  auth,
  (req, res) => {
    const connection =
      currentConnection();

    res.json({
      ok: true,
      stats:
        connection
          ? db.getStats(
              connection.id
            )
          : {
              messages: 0,
              edits: 0,
              deleted: 0,
              events: 0
            }
    });
  }
);

/* =========================
   WATCH
========================= */

app.get(
  "/api/watches",
  auth,
  (req, res) => {
    const connection =
      currentConnection();

    res.json({
      ok: true,
      watches:
        connection
          ? db.getWatches(
              connection.id
            )
          : []
    });
  }
);

app.post(
  "/api/watches",
  auth,
  (req, res) => {
    const connection =
      currentConnection();

    if (!connection) {
      return error(
        res,
        400,
        "Нет подключения."
      );
    }

    const target =
      String(
        req.body?.target ||
          ""
      ).trim();

    if (!target) {
      return error(
        res,
        400,
        "Укажи username или ID."
      );
    }

    try {
      const id =
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
        id
      });
    } catch (e) {
      return error(
        res,
        400,
        e.message
      );
    }
  }
);

app.delete(
  "/api/watches/:id",
  auth,
  (req, res) => {
    const connection =
      currentConnection();

    if (!connection) {
      return error(
        res,
        400,
        "Нет подключения."
      );
    }

    const id =
      Number(
        req.params.id
      );

    db.removeWatch(
      connection.id,
      id
    );

    db.addEvent({
      connectionId:
        connection.id,
      type:
        "watch_remove",
      data: {
        id
      }
    });

    res.json({
      ok: true
    });
  }
);

/* =========================
   CONFIGURE WEBHOOK
========================= */

app.post(
  "/api/configure-bot",
  auth,
  async (req, res) => {
    const base =
      process.env.PUBLIC_BASE_URL;

    if (!base) {
      return error(
        res,
        400,
        "PUBLIC_BASE_URL не задан."
      );
    }

    try {
      const secret =
        process.env.WEBHOOK_SECRET ||
        "stma";

      const webhookUrl =
        `${base.replace(
          /\/$/,
          ""
        )}/telegram/webhook`;

      await telegram(
        "setWebhook",
        {
          url:
            webhookUrl,

          secret_token:
            secret,

          allowed_updates: [
            "business_connection",
            "business_message",
            "edited_business_message",
            "deleted_business_messages"
          ]
        }
      );

      res.json({
        ok: true,
        webhookUrl
      });
    } catch (e) {
      return error(
        res,
        500,
        e.message
      );
    }
  }
);

/* =========================
   STATIC FILES
========================= */

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
  )
);

app.get(
  "*splat",
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

/* =========================
   AUTO DELETE WORKER
========================= */

setInterval(
  async () => {
    try {
      await business.processDueDeletes(
        {
          token: TOKEN
        }
      );
    } catch (e) {
      console.error(
        "Delete worker:",
        e.message
      );
    }
  },
  5000
);

/* =========================
   START
========================= */

app.listen(
  PORT,
  async () => {
    console.log(
      `🔥 STMA запущен на порту ${PORT}`
    );

    try {
      const me =
        await telegram(
          "getMe"
        );

      console.log(
        `🤖 Бот: @${me.username}`
      );

      const base =
        process.env.PUBLIC_BASE_URL;

      if (base) {
        const secret =
          process.env.WEBHOOK_SECRET ||
          "stma";

        const webhookUrl =
          `${base.replace(
            /\/$/,
            ""
          )}/telegram/webhook`;

        await telegram(
          "setWebhook",
          {
            url:
              webhookUrl,

            secret_token:
              secret,

            allowed_updates: [
              "business_connection",
              "business_message",
              "edited_business_message",
              "deleted_business_messages"
            ]
          }
        );

        console.log(
          `🔗 Webhook установлен: ${webhookUrl}`
        );
      } else {
        console.log(
          "⚠️ PUBLIC_BASE_URL не задан."
        );
      }
    } catch (e) {
      console.error(
        "❌ Telegram:",
        e.message
      );
    }
  }
);