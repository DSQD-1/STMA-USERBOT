import express from "express";
import crypto from "crypto";

import {
  initDatabase,
  upsertUser,
  getUser,
  getConnections,
  getConnectionForOwner,
  getMessages,
  getMessage,
  addEvent,
  addWatch,
  removeWatch,
  getWatches,
  createScheduledDeletion,
  saveMessage,
  saveCommand,
  getEvents,
  getStats
} from "./src/database.js";

import {
  telegram,
  getMe,
  sendBusinessMessage,
  deleteBusinessMessage,
  muteUser,
  unmuteUser,
  parseCommand,
  handleUpdate,
  configureTelegram,
  restoreDeletionTimers,
  scheduleDeletion
} from "./src/business.js";

const app = express();

const PORT =
  Number(process.env.PORT) || 10000;

const BOT_TOKEN =
  String(process.env.BOT_TOKEN || "").trim();

if (!BOT_TOKEN) {
  throw new Error(
    "BOT_TOKEN environment variable is required"
  );
}

/* =========================================================
   EXPRESS
========================================================= */

app.disable("x-powered-by");

app.use(
  express.json({
    limit: "2mb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "2mb"
  })
);

/*
 * Telegram Mini App должен получать
 * telegram-web-app.js из index.html.
 */
app.use(
  express.static("public", {
    extensions: ["html"],
    index: "index.html"
  })
);

/* =========================================================
   TELEGRAM MINI APP AUTH
========================================================= */

/**
 * Проверка Telegram Web App initData.
 *
 * Telegram:
 *
 * secret_key =
 * HMAC_SHA256(
 *   key = "WebAppData",
 *   data = BOT_TOKEN
 * )
 *
 * hash =
 * HMAC_SHA256(
 *   key = secret_key,
 *   data = data_check_string
 * )
 */
function validateTelegramInitData(
  initData
) {
  try {
    if (
      !initData ||
      typeof initData !== "string"
    ) {
      return {
        valid: false,
        user: null,
        reason:
          "Telegram initData отсутствует"
      };
    }

    const params =
      new URLSearchParams(initData);

    const receivedHash =
      params.get("hash");

    if (!receivedHash) {
      return {
        valid: false,
        user: null,
        reason:
          "Telegram hash отсутствует"
      };
    }

    const dataCheckArray = [];

    for (
      const [key, value]
      of params.entries()
    ) {
      if (
        key === "hash" ||
        key === "signature"
      ) {
        continue;
      }

      dataCheckArray.push(
        `${key}=${value}`
      );
    }

    dataCheckArray.sort();

    const dataCheckString =
      dataCheckArray.join("\n");

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

    const receivedBuffer =
      Buffer.from(
        receivedHash,
        "hex"
      );

    const calculatedBuffer =
      Buffer.from(
        calculatedHash,
        "hex"
      );

    if (
      receivedBuffer.length !==
      calculatedBuffer.length
    ) {
      console.error(
        "[AUTH] Hash length mismatch"
      );

      return {
        valid: false,
        user: null,
        reason:
          "Telegram hash имеет неправильную длину"
      };
    }

    const valid =
      crypto.timingSafeEqual(
        calculatedBuffer,
        receivedBuffer
      );

    if (!valid) {
      console.error(
        "[AUTH] Telegram hash mismatch"
      );

      console.error(
        "[AUTH] auth_date:",
        params.get("auth_date")
      );

      console.error(
        "[AUTH] user:",
        params.get("user")
          ? "present"
          : "missing"
      );

      return {
        valid: false,
        user: null,
        reason:
          "Telegram hash не совпадает с BOT_TOKEN"
      };
    }

    const authDate =
      Number(
        params.get("auth_date")
      );

    if (
      !Number.isFinite(authDate)
    ) {
      return {
        valid: false,
        user: null,
        reason:
          "Telegram auth_date отсутствует или некорректен"
      };
    }

    const now =
      Math.floor(
        Date.now() / 1000
      );

    const age =
      now - authDate;

    /*
     * Разрешаем initData максимум на 24 часа.
     */
    if (
      age > 24 * 60 * 60
    ) {
      return {
        valid: false,
        user: null,
        reason:
          "Telegram initData устарел"
      };
    }

    /*
     * Защита от странных часов устройства/Telegram.
     */
    if (
      age < -300
    ) {
      return {
        valid: false,
        user: null,
        reason:
          "Telegram auth_date находится в будущем"
      };
    }

    const rawUser =
      params.get("user");

    if (!rawUser) {
      return {
        valid: false,
        user: null,
        reason:
          "Telegram user отсутствует"
      };
    }

    let user;

    try {
      user =
        JSON.parse(rawUser);
    } catch {
      return {
        valid: false,
        user: null,
        reason:
          "Telegram user имеет некорректный JSON"
      };
    }

    if (
      !user ||
      !user.id
    ) {
      return {
        valid: false,
        user: null,
        reason:
          "Telegram user.id отсутствует"
      };
    }

    return {
      valid: true,
      user,
      reason: null
    };
  } catch (error) {
    console.error(
      "[AUTH] Validation exception:",
      error
    );

    return {
      valid: false,
      user: null,
      reason:
        error.message ||
        "Ошибка проверки Telegram initData"
    };
  }
}

/* =========================================================
   AUTH MIDDLEWARE
========================================================= */

async function authMiddleware(
  req,
  res,
  next
) {
  try {
    /*
     * Основной вариант:
     *
     * X-Telegram-Init-Data
     *
     * Дополнительно поддерживаем body/query,
     * чтобы ничего не сломать.
     */
    const initData =
      req.get(
        "X-Telegram-Init-Data"
      ) ||
      req.body?.initData ||
      req.query?.initData ||
      "";

    if (!initData) {
      return res.status(401).json({
        ok: false,
        error:
          "Invalid Telegram Mini App authorization",
        reason:
          "Telegram initData не передан серверу"
      });
    }

    const result =
      validateTelegramInitData(
        initData
      );

    if (!result.valid) {
      console.error(
        "[AUTH] Authorization rejected:",
        result.reason
      );

      return res.status(401).json({
        ok: false,
        error:
          "Invalid Telegram Mini App authorization",
        reason:
          result.reason
      });
    }

    /*
     * Авторизация успешна.
     *
     * Сохраняем пользователя в Turso.
     */
    await upsertUser(
      result.user
    );

    req.telegramUser =
      result.user;

    next();
  } catch (error) {
    console.error(
      "[AUTH] Middleware error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        "Authentication error",
      reason:
        error.message
    });
  }
}

/* =========================================================
   BUSINESS CONNECTION ACCESS
========================================================= */

function requireConnection(
  req,
  res,
  next
) {
  const connectionId =
    req.params.connectionId;

  if (!connectionId) {
    return res.status(400).json({
      ok: false,
      error:
        "connectionId is required"
    });
  }

  getConnectionForOwner(
    connectionId,
    req.telegramUser.id
  )
    .then(
      (connection) => {
        if (!connection) {
          return res.status(404).json({
            ok: false,
            error:
              "Business Connection not found"
          });
        }

        if (
          !connection.is_enabled
        ) {
          return res.status(409).json({
            ok: false,
            error:
              "Business Connection is disabled"
          });
        }

        req.businessConnection =
          connection;

        next();
      }
    )
    .catch(next);
}

/* =========================================================
   HELPERS
========================================================= */

function normalizeChatId(
  value
) {
  if (
    typeof value === "number"
  ) {
    return value;
  }

  const text =
    String(value ?? "").trim();

  if (
    /^-?\d+$/.test(text)
  ) {
    const number =
      Number(text);

    if (
      Number.isSafeInteger(number)
    ) {
      return number;
    }
  }

  return text;
}

function parseRights(
  value
) {
  try {
    if (
      !value
    ) {
      return {};
    }

    if (
      typeof value === "object"
    ) {
      return value;
    }

    return JSON.parse(
      String(value)
    );
  } catch {
    return {};
  }
}

/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/health",
  async (req, res) => {
    res.json({
      ok: true,
      service: "STMA",
      version: "3.0.0",
      telegramMiniApp: true,
      time:
        new Date().toISOString()
    });
  }
);

/* =========================================================
   DEBUG AUTH
========================================================= */

/*
 * Этот endpoint НЕ авторизует пользователя.
 *
 * Он нужен только для проверки:
 * передаёт ли Mini App initData.
 */
app.get(
  "/api/auth/status",
  (req, res) => {
    const initData =
      req.get(
        "X-Telegram-Init-Data"
      ) ||
      req.query?.initData ||
      "";

    if (!initData) {
      return res.json({
        ok: true,
        authenticated: false,
        reason:
          "initData отсутствует"
      });
    }

    const result =
      validateTelegramInitData(
        initData
      );

    res.json({
      ok: true,
      authenticated:
        result.valid,
      reason:
        result.reason || null,
      user:
        result.valid
          ? result.user
          : null
    });
  }
);

/* =========================================================
   USER
========================================================= */

app.get(
  "/api/me",
  authMiddleware,
  async (req, res, next) => {
    try {
      const user =
        await getUser(
          req.telegramUser.id
        );

      res.json({
        ok: true,
        user:
          user ||
          req.telegramUser
      });
    } catch (error) {
      next(error);
    }
  }
);

/* =========================================================
   CONNECTIONS
========================================================= */

app.get(
  "/api/connections",
  authMiddleware,
  async (req, res, next) => {
    try {
      const connections =
        await getConnections(
          req.telegramUser.id
        );

      res.json({
        ok: true,
        connections:
          connections || []
      });
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  "/api/connections/:connectionId",
  authMiddleware,
  requireConnection,
  async (req, res) => {
    res.json({
      ok: true,
      connection:
        req.businessConnection
    });
  }
);

/* =========================================================
   MESSAGES
========================================================= */

app.get(
  "/api/connections/:connectionId/messages",
  authMiddleware,
  requireConnection,
  async (req, res, next) => {
    try {
      const messages =
        await getMessages(
          req.params.connectionId,
          req.query.limit,
          req.query.offset
        );

      res.json({
        ok: true,
        messages:
          messages || []
      });
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/connections/:connectionId/messages",
  authMiddleware,
  requireConnection,
  async (req, res, next) => {
    try {
      const {
        chatId,
        text,
        deleteAfter,
        messageThreadId,
        directMessagesTopicId
      } = req.body || {};

      if (
        chatId === undefined ||
        chatId === null ||
        !String(chatId).trim()
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "chatId is required"
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

      const rights =
        parseRights(
          req.businessConnection
            .rights_json
        );

      if (
        rights.can_reply !== true
      ) {
        return res.status(403).json({
          ok: false,
          error:
            "Business Connection has no can_reply permission"
        });
      }

      const sent =
        await sendBusinessMessage({
          connectionId:
            req.params.connectionId,

          chatId:
            normalizeChatId(
              chatId
            ),

          text:
            String(text).trim(),

          messageThreadId,

          directMessagesTopicId
        });

      await saveMessage({
        business_connection_id:
          req.params.connectionId,

        chat_id:
          sent.chat?.id,

        message_id:
          sent.message_id,

        sender_id:
          sent.sender?.id,

        sender_username:
          sent.sender?.username,

        sender_name:
          sent.sender
            ? [
                sent.sender.first_name,
                sent.sender.last_name
              ]
                .filter(Boolean)
                .join(" ")
            : null,

        direction:
          "outgoing",

        text:
          sent.text,

        caption:
          sent.caption,

        message_date:
          sent.date,

        edited:
          false,

        deleted:
          false,

        raw:
          sent
      });

      await addEvent({
        owner_telegram_id:
          req.telegramUser.id,

        business_connection_id:
          req.params.connectionId,

        type:
          "message_sent",

        chat_id:
          sent.chat?.id,

        message_id:
          sent.message_id,

        payload:
          sent
      });

      const seconds =
        Math.floor(
          Number(
            deleteAfter
          ) || 0
        );

      if (
        seconds > 0 &&
        seconds <=
          7 * 24 * 60 * 60
      ) {
        const executeAt =
          Math.floor(
            Date.now() / 1000
          ) + seconds;

        await createScheduledDeletion({
          ownerTelegramId:
            req.telegramUser.id,

          connectionId:
            req.params.connectionId,

          chatId:
            sent.chat.id,

          messageId:
            sent.message_id,

          executeAt
        });

        scheduleDeletion({
          id:
            Date.now(),

          owner_telegram_id:
            req.telegramUser.id,

          business_connection_id:
            req.params.connectionId,

          chat_id:
            String(
              sent.chat.id
            ),

          message_id:
            sent.message_id,

          execute_at:
            executeAt
        });
      }

      res.json({
        ok: true,
        message:
          sent
      });
    } catch (error) {
      next(error);
    }
  }
);

/* =========================================================
   DELETE MESSAGE
========================================================= */

app.delete(
  "/api/connections/:connectionId/messages/:chatId/:messageId",
  authMiddleware,
  requireConnection,
  async (req, res, next) => {
    try {
      const message =
        await getMessage(
          req.params.connectionId,
          req.params.chatId,
          req.params.messageId
        );

      if (!message) {
        return res.status(404).json({
          ok: false,
          error:
            "Message not found in STMA history"
        });
      }

      await deleteBusinessMessage({
        connectionId:
          req.params.connectionId,

        messageId:
          req.params.messageId
      });

      await addEvent({
        owner_telegram_id:
          req.telegramUser.id,

        business_connection_id:
          req.params.connectionId,

        type:
          "message_deleted",

        chat_id:
          req.params.chatId,

        message_id:
          req.params.messageId
      });

      res.json({
        ok: true
      });
    } catch (error) {
      next(error);
    }
  }
);

/* =========================================================
   COMMANDS
========================================================= */

app.post(
  "/api/connections/:connectionId/command",
  authMiddleware,
  requireConnection,
  async (req, res, next) => {
    try {
      const commandText =
        String(
          req.body?.command || ""
        ).trim();

      const chatId =
        normalizeChatId(
          req.body?.chatId
        );

      if (!commandText) {
        return res.status(400).json({
          ok: false,
          error:
            "command is required"
        });
      }

      const command =
        parseCommand(
          commandText
        );

      if (
        command.type ===
        "unknown"
      ) {
        await saveCommand({
          ownerTelegramId:
            req.telegramUser.id,

          connectionId:
            req.params.connectionId,

          commandText,

          commandType:
            "unknown",

          result:
            "Неизвестная команда",

          success:
            false
        });

        return res.status(400).json({
          ok: false,
          error:
            "Неизвестная команда",

          supported: [
            "замуть 123456789 на 30 минут",
            "размути 123456789",
            "следи за @username"
          ]
        });
      }

      if (
        command.type ===
        "watch"
      ) {
        await addWatch({
          ownerTelegramId:
            req.telegramUser.id,

          connectionId:
            req.params.connectionId,

          username:
            command.username
        });

        await addEvent({
          owner_telegram_id:
            req.telegramUser.id,

          business_connection_id:
            req.params.connectionId,

          type:
            "watch",

          username:
            command.username
        });

        const result =
          `Слежение за ${command.username} включено`;

        await saveCommand({
          ownerTelegramId:
            req.telegramUser.id,

          connectionId:
            req.params.connectionId,

          commandText,

          commandType:
            command.type,

          result,

          success:
            true
        });

        return res.json({
          ok: true,
          result
        });
      }

      if (
        command.type ===
        "mute"
      ) {
        if (
          chatId === undefined ||
          chatId === null ||
          !String(chatId).trim()
        ) {
          return res.status(400).json({
            ok: false,
            error:
              "Для mute нужен chatId"
          });
        }

        await muteUser({
          chatId,

          userId:
            command.userId,

          durationSeconds:
            command.durationSeconds
        });

        await addEvent({
          owner_telegram_id:
            req.telegramUser.id,

          business_connection_id:
            req.params.connectionId,

          type:
            "mute",

          chat_id:
            chatId,

          user_id:
            command.userId,

          payload:
            command
        });

        const minutes =
          Math.round(
            command.durationSeconds /
              60
          );

        const result =
          `Пользователь ${command.userId} замьючен на ${minutes} мин.`;

        await saveCommand({
          ownerTelegramId:
            req.telegramUser.id,

          connectionId:
            req.params.connectionId,

          commandText,

          commandType:
            command.type,

          result,

          success:
            true
        });

        return res.json({
          ok: true,
          result
        });
      }

      if (
        command.type ===
        "unmute"
      ) {
        if (
          chatId === undefined ||
          chatId === null ||
          !String(chatId).trim()
        ) {
          return res.status(400).json({
            ok: false,
            error:
              "Для unmute нужен chatId"
          });
        }

        await unmuteUser({
          chatId,

          userId:
            command.userId
        });

        await addEvent({
          owner_telegram_id:
            req.telegramUser.id,

          business_connection_id:
            req.params.connectionId,

          type:
            "unmute",

          chat_id:
            chatId,

          user_id:
            command.userId,

          payload:
            command
        });

        const result =
          `Пользователь ${command.userId} размьючен.`;

        await saveCommand({
          ownerTelegramId:
            req.telegramUser.id,

          connectionId:
            req.params.connectionId,

          commandText,

          commandType:
            command.type,

          result,

          success:
            true
        });

        return res.json({
          ok: true,
          result
        });
      }

      return res.status(400).json({
        ok: false,
        error:
          "Unsupported command"
      });
    } catch (error) {
      next(error);
    }
  }
);

/* =========================================================
   WATCHES
========================================================= */

app.get(
  "/api/connections/:connectionId/watches",
  authMiddleware,
  requireConnection,
  async (req, res, next) => {
    try {
      const watches =
        await getWatches(
          req.telegramUser.id,
          req.params.connectionId
        );

      res.json({
        ok: true,
        watches:
          watches || []
      });
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/connections/:connectionId/watches",
  authMiddleware,
  requireConnection,
  async (req, res, next) => {
    try {
      const username =
        String(
          req.body?.username || ""
        ).trim();

      if (!username) {
        return res.status(400).json({
          ok: false,
          error:
            "username is required"
        });
      }

      await addWatch({
        ownerTelegramId:
          req.telegramUser.id,

        connectionId:
          req.params.connectionId,

        username
      });

      await addEvent({
        owner_telegram_id:
          req.telegramUser.id,

        business_connection_id:
          req.params.connectionId,

        type:
          "watch",

        username
      });

      res.json({
        ok: true
      });
    } catch (error) {
      next(error);
    }
  }
);

app.delete(
  "/api/connections/:connectionId/watches/:username",
  authMiddleware,
  requireConnection,
  async (req, res, next) => {
    try {
      await removeWatch(
        req.telegramUser.id,

        req.params.connectionId,

        req.params.username
      );

      res.json({
        ok: true
      });
    } catch (error) {
      next(error);
    }
  }
);

/* =========================================================
   EVENTS
========================================================= */

app.get(
  "/api/connections/:connectionId/events",
  authMiddleware,
  requireConnection,
  async (req, res, next) => {
    try {
      const events =
        await getEvents(
          req.telegramUser.id,

          req.params.connectionId,

          req.query.limit
        );

      res.json({
        ok: true,
        events:
          events || []
      });
    } catch (error) {
      next(error);
    }
  }
);

/* =========================================================
   STATS
========================================================= */

app.get(
  "/api/connections/:connectionId/stats",
  authMiddleware,
  requireConnection,
  async (req, res, next) => {
    try {
      const stats =
        await getStats(
          req.telegramUser.id,

          req.params.connectionId
        );

      res.json({
        ok: true,
        stats:
          stats || {}
      });
    } catch (error) {
      next(error);
    }
  }
);

/* =========================================================
   TELEGRAM WEBHOOK
========================================================= */

app.post(
  "/telegram/webhook",
  async (req, res, next) => {
    try {
      const secret =
        process.env.WEBHOOK_SECRET;

      if (
        secret &&
        req.get(
          "X-Telegram-Bot-Api-Secret-Token"
        ) !== secret
      ) {
        return res.status(403).json({
          ok: false,
          error:
            "Invalid webhook secret"
        });
      }

      await handleUpdate(
        req.body
      );

      res.json({
        ok: true
      });
    } catch (error) {
      console.error(
        "[WEBHOOK ERROR]",
        error
      );

      next(error);
    }
  }
);

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "[STMA ERROR]",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    const status =
      error?.status &&
      Number.isInteger(
        error.status
      )
        ? error.status
        : 500;

    res.status(status).json({
      ok: false,

      error:
        error?.message ||
        "Internal server error",

      telegram:
        error?.telegram ||
        undefined
    });
  }
);

/* =========================================================
   START
========================================================= */

async function start() {
  console.log(
    "[STMA] Starting..."
  );

  console.log(
    "[STMA] Node:",
    process.version
  );

  console.log(
    "[STMA] Port:",
    PORT
  );

  await initDatabase();

  console.log(
    "[STMA] Database ready"
  );

  const me =
    await getMe();

  console.log(
    `[STMA] Telegram bot: @${me.username || "unknown"}`
  );

  await configureTelegram();

  await restoreDeletionTimers();

  app.listen(
    PORT,
    "0.0.0.0",
    () => {
      console.log(
        `[STMA] Listening on 0.0.0.0:${PORT}`
      );

      console.log(
        "[STMA] Mini App:",
        "enabled"
      );
    }
  );
}

start().catch(
  (error) => {
    console.error(
      "[STMA] FATAL STARTUP ERROR:",
      error
    );

    process.exit(1);
  }
);