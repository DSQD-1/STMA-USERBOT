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

/*
 * Очень важно:
 * убираем случайные пробелы и кавычки
 * из переменной Render.
 */
const BOT_TOKEN = String(
  process.env.BOT_TOKEN || ""
)
  .trim()
  .replace(/^["']|["']$/g, "");

if (!BOT_TOKEN) {
  throw new Error(
    "BOT_TOKEN is required"
  );
}

console.log(
  "[CONFIG] BOT_TOKEN loaded:",
  `${BOT_TOKEN.slice(0, 8)}...${BOT_TOKEN.slice(-5)}`
);

app.use(
  express.json({
    limit: "2mb"
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);

app.use(
  express.static("public", {
    extensions: ["html"]
  })
);

/* =========================================================
   TELEGRAM MINI APP AUTH
   ========================================================= */

function timingSafeEqualText(a, b) {
  try {
    const aBuffer = Buffer.from(
      String(a),
      "utf8"
    );

    const bBuffer = Buffer.from(
      String(b),
      "utf8"
    );

    if (
      aBuffer.length !==
      bBuffer.length
    ) {
      return false;
    }

    return crypto.timingSafeEqual(
      aBuffer,
      bBuffer
    );
  } catch {
    return false;
  }
}

function validateInitData(initData) {
  if (
    !initData ||
    typeof initData !== "string"
  ) {
    return {
      valid: false,
      user: null,
      error:
        "Telegram initData отсутствует"
    };
  }

  try {
    const params =
      new URLSearchParams(initData);

    const receivedHash =
      params.get("hash");

    if (!receivedHash) {
      return {
        valid: false,
        user: null,
        error:
          "Telegram hash отсутствует"
      };
    }

    const authDate =
      Number(
        params.get("auth_date")
      );

    if (!Number.isFinite(authDate)) {
      return {
        valid: false,
        user: null,
        error:
          "Telegram auth_date отсутствует"
      };
    }

    /*
     * Telegram Mini Apps:
     *
     * secret_key =
     * HMAC-SHA256(
     *   "WebAppData",
     *   BOT_TOKEN
     * )
     */

    const secretKey =
      crypto
        .createHmac(
          "sha256",
          "WebAppData"
        )
        .update(BOT_TOKEN)
        .digest();

    const checkParams =
      new URLSearchParams(
        params.toString()
      );

    checkParams.delete("hash");

    /*
     * signature используется Telegram
     * для дополнительной проверки,
     * но не входит в data-check-string
     * при стандартной проверке hash.
     */
    checkParams.delete(
      "signature"
    );

    const dataCheckString =
      [...checkParams.entries()]
        .sort(([a], [b]) =>
          a.localeCompare(b)
        )
        .map(
          ([key, value]) =>
            `${key}=${value}`
        )
        .join("\n");

    const calculatedHash =
      crypto
        .createHmac(
          "sha256",
          secretKey
        )
        .update(dataCheckString)
        .digest("hex");

    const received =
      String(receivedHash)
        .trim()
        .toLowerCase();

    const calculated =
      String(calculatedHash)
        .trim()
        .toLowerCase();

    if (
      !timingSafeEqualText(
        received,
        calculated
      )
    ) {
      console.error(
        "[AUTH] Telegram hash mismatch"
      );

      console.error(
        "[AUTH] auth_date:",
        authDate
      );

      console.error(
        "[AUTH] initData length:",
        initData.length
      );

      return {
        valid: false,
        user: null,
        error:
          "Telegram hash не совпадает с BOT_TOKEN"
      };
    }

    /*
     * Проверяем срок действия initData.
     *
     * Разрешаем максимум 24 часа.
     */
    const now =
      Math.floor(
        Date.now() / 1000
      );

    const age =
      now - authDate;

    if (
      age < -60 ||
      age > 24 * 60 * 60
    ) {
      return {
        valid: false,
        user: null,
        error:
          "Telegram initData устарел"
      };
    }

    const rawUser =
      params.get("user");

    if (!rawUser) {
      return {
        valid: false,
        user: null,
        error:
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
        error:
          "Telegram user имеет неправильный JSON"
      };
    }

    if (
      !user ||
      !user.id
    ) {
      return {
        valid: false,
        user: null,
        error:
          "Telegram user.id отсутствует"
      };
    }

    return {
      valid: true,
      user,
      error: null
    };
  } catch (error) {
    console.error(
      "[AUTH] Validation error:",
      error
    );

    return {
      valid: false,
      user: null,
      error:
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
    const initData =
      req.get(
        "X-Telegram-Init-Data"
      ) ||
      req.headers[
        "x-telegram-init-data"
      ] ||
      req.body?.initData ||
      "";

    console.log(
      "[AUTH]",
      req.method,
      req.path,
      "initData:",
      Boolean(initData),
      "length:",
      String(initData).length
    );

    const result =
      validateInitData(
        initData
      );

    if (!result.valid) {
      console.error(
        "[AUTH FAILED]",
        result.error
      );

      return res.status(401).json({
        ok: false,
        error:
          `Invalid Telegram Mini App authorization: ${result.error}`
      });
    }

    await upsertUser(
      result.user
    );

    req.telegramUser =
      result.user;

    next();
  } catch (error) {
    console.error(
      "[AUTH ERROR]",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        "Authentication error"
    });
  }
}

/* =========================================================
   BUSINESS CONNECTION AUTHORIZATION
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

function normalizeChatId(value) {
  if (
    typeof value === "number"
  ) {
    return value;
  }

  const text =
    String(value || "").trim();

  if (
    /^-?\d+$/.test(text)
  ) {
    const number =
      Number(text);

    if (
      Number.isSafeInteger(
        number
      )
    ) {
      return number;
    }
  }

  return text;
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
      version: "2.0.0",
      time:
        new Date().toISOString()
    });
  }
);

/* =========================================================
   USER
   ========================================================= */

app.get(
  "/api/me",
  authMiddleware,
  async (req, res) => {
    const user =
      await getUser(
        req.telegramUser.id
      );

    res.json({
      ok: true,
      user
    });
  }
);

/* =========================================================
   CONNECTIONS
   ========================================================= */

app.get(
  "/api/connections",
  authMiddleware,
  async (req, res) => {
    const connections =
      await getConnections(
        req.telegramUser.id
      );

    res.json({
      ok: true,
      connections
    });
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
  async (req, res) => {
    const messages =
      await getMessages(
        req.params.connectionId,
        req.query.limit,
        req.query.offset
      );

    res.json({
      ok: true,
      messages
    });
  }
);

app.post(
  "/api/connections/:connectionId/messages",
  authMiddleware,
  requireConnection,
  async (
    req,
    res,
    next
  ) => {
    try {
      const {
        chatId,
        text,
        deleteAfter,
        messageThreadId,
        directMessagesTopicId
      } = req.body;

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

      let rights = {};

      try {
        rights =
          JSON.parse(
            req.businessConnection
              .rights_json || "{}"
          );
      } catch {
        rights = {};
      }

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
          sent.chat.id,

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
          sent.chat.id,

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

        const scheduled = {
          ownerTelegramId:
            req.telegramUser.id,

          connectionId:
            req.params.connectionId,

          chatId:
            sent.chat.id,

          messageId:
            sent.message_id,

          executeAt
        };

        await createScheduledDeletion(
          scheduled
        );

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

app.delete(
  "/api/connections/:connectionId/messages/:chatId/:messageId",
  authMiddleware,
  requireConnection,
  async (
    req,
    res,
    next
  ) => {
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
  async (
    req,
    res,
    next
  ) => {
    try {
      const commandText =
        String(
          req.body.command ||
            ""
        ).trim();

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

        await saveCommand({
          ownerTelegramId:
            req.telegramUser.id,

          connectionId:
            req.params.connectionId,

          commandText,

          commandType:
            command.type,

          result:
            `Слежение за ${command.username} включено`,

          success:
            true
        });

        return res.json({
          ok: true,

          result:
            `Слежение за ${command.username} включено`
        });
      }

      if (
        command.type ===
        "mute"
      ) {
        const chatId =
          normalizeChatId(
            req.body.chatId
          );

        if (
          chatId ===
            undefined ||
          chatId === null ||
          !String(
            chatId
          ).trim()
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
        const chatId =
          normalizeChatId(
            req.body.chatId
          );

        if (
          chatId ===
            undefined ||
          chatId === null ||
          !String(
            chatId
          ).trim()
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
  async (
    req,
    res
  ) => {
    const watches =
      await getWatches(
        req.telegramUser.id,
        req.params.connectionId
      );

    res.json({
      ok: true,
      watches
    });
  }
);

app.post(
  "/api/connections/:connectionId/watches",
  authMiddleware,
  requireConnection,
  async (
    req,
    res
  ) => {
    const username =
      String(
        req.body.username ||
          ""
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
  }
);

app.delete(
  "/api/connections/:connectionId/watches/:username",
  authMiddleware,
  requireConnection,
  async (
    req,
    res
  ) => {
    await removeWatch(
      req.telegramUser.id,
      req.params.connectionId,
      req.params.username
    );

    res.json({
      ok: true
    });
  }
);

/* =========================================================
   EVENTS
   ========================================================= */

app.get(
  "/api/connections/:connectionId/events",
  authMiddleware,
  requireConnection,
  async (
    req,
    res
  ) => {
    const events =
      await getEvents(
        req.telegramUser.id,
        req.params.connectionId,
        req.query.limit
      );

    res.json({
      ok: true,
      events
    });
  }
);

/* =========================================================
   STATS
   ========================================================= */

app.get(
  "/api/connections/:connectionId/stats",
  authMiddleware,
  requireConnection,
  async (
    req,
    res
  ) => {
    const stats =
      await getStats(
        req.telegramUser.id,
        req.params.connectionId
      );

    res.json({
      ok: true,
      stats
    });
  }
);

/* =========================================================
   TELEGRAM WEBHOOK
   ========================================================= */

app.post(
  "/telegram/webhook",
  async (
    req,
    res,
    next
  ) => {
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
          ok: false
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
        "Webhook error:",
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
      "STMA error:",
      error
    );

    const status =
      error.status &&
      Number.isInteger(
        error.status
      )
        ? error.status
        : 500;

    res.status(status).json({
      ok: false,

      error:
        error.message ||
        "Internal server error",

      telegram:
        error.telegram ||
        undefined
    });
  }
);

/* =========================================================
   START
   ========================================================= */

async function start() {
  console.log(
    "[DB] Starting database initialization..."
  );

  await initDatabase();

  console.log(
    "[DB] Database initialized successfully."
  );

  const me =
    await getMe();

  console.log(
    `Telegram bot: @${me.username || "unknown"}`
  );

  await configureTelegram();

  console.log(
    "Telegram webhook configured"
  );

  await restoreDeletionTimers();

  app.listen(
    PORT,
    "0.0.0.0",
    () => {
      console.log(
        `STMA listening on 0.0.0.0:${PORT}`
      );
    }
  );
}

start().catch(
  (error) => {
    console.error(
      "FATAL STARTUP ERROR:",
      error
    );

    process.exit(1);
  }
);