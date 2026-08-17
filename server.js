const express = require("express");
const path = require("path");
const crypto = require("crypto");

const {
  initDatabase,
  getUser,
  upsertUser,
  getConnections,
  getConnection,
  getMessages,
  getEvents,
  getStats,
  addWatch,
  getWatches,
  removeWatch,
  saveCommand,
  addEvent,
  getMessage,
  saveSentMessage,
  markMessageDeleted,
  saveEditedMessage,
  getTrackedUsernames,
  findRecentChatByUsername
} = require("./src/database");

const {
  telegramRequest,
  sendBusinessMessage,
  deleteBusinessMessage,
  muteUser,
  unmuteUser,
  setWebhook,
  setMenuButton,
  answerStart
} = require("./src/business");

const app = express();

const PORT = Number(process.env.PORT || 10000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const WEBAPP_URL =
  process.env.WEBAPP_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  "";

const WEBHOOK_URL =
  process.env.WEBHOOK_URL ||
  (process.env.RENDER_EXTERNAL_URL
    ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "")}/telegram/webhook`
    : "");

const INIT_DATA_MAX_AGE = Number(
  process.env.INIT_DATA_MAX_AGE || 86400
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

function now() {
  return new Date().toISOString();
}

function parseInitData(initData) {
  if (!initData || typeof initData !== "string") {
    throw new Error("Missing Telegram initData");
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash) {
    throw new Error("Missing initData hash");
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

  const a = Buffer.from(calculatedHash, "hex");
  const b = Buffer.from(receivedHash, "hex");

  if (
    a.length !== b.length ||
    !crypto.timingSafeEqual(a, b)
  ) {
    throw new Error("Invalid Telegram initData signature");
  }

  const authDate = Number(params.get("auth_date"));

  if (!authDate || !Number.isFinite(authDate)) {
    throw new Error("Invalid auth_date");
  }

  const age = Math.floor(Date.now() / 1000) - authDate;

  if (age < -60 || age > INIT_DATA_MAX_AGE) {
    throw new Error("Expired Telegram initData");
  }

  let user = null;

  const userRaw = params.get("user");

  if (userRaw) {
    try {
      user = JSON.parse(userRaw);
    } catch {
      throw new Error("Invalid Telegram user");
    }
  }

  if (!user || !user.id) {
    throw new Error("Telegram user missing");
  }

  return {
    user,
    authDate
  };
}

async function authMiddleware(req, res, next) {
  try {
    const initData =
      req.headers["x-telegram-init-data"] ||
      req.body?.initData ||
      req.query?.initData;

    if (!BOT_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "BOT_TOKEN is not configured"
      });
    }

    const auth = parseInitData(initData);

    await upsertUser(auth.user);

    req.telegramUser = auth.user;

    next();
  } catch (error) {
    console.error("AUTH ERROR:", error.message);

    res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }
}

async function getOwnedConnection(req, connectionId) {
  if (!connectionId) {
    throw new Error("Missing connection ID");
  }

  const connection = await getConnection(connectionId);

  if (!connection) {
    throw new Error("Business Connection not found");
  }

  if (
    String(connection.user_id) !==
    String(req.telegramUser.id)
  ) {
    throw new Error("Access denied");
  }

  if (!connection.is_enabled) {
    throw new Error("Business Connection is disabled");
  }

  return connection;
}

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

function parseDuration(text) {
  const match = text.match(
    /(\d+(?:\.\d+)?)\s*(секунд?|сек|s|минут?|мин|m|час(?:а|ов)?|ч|h|дн(?:ей|я)?|д|d)\b/i
  );

  if (!match) return null;

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();

  let multiplier;

  if (["секунда", "секунды", "секунд", "сек", "s"].includes(unit)) {
    multiplier = 1;
  } else if (
    ["минута", "минуты", "минут", "мин", "m"].includes(unit)
  ) {
    multiplier = 60;
  } else if (
    ["час", "часа", "часов", "ч", "h"].includes(unit)
  ) {
    multiplier = 3600;
  } else if (
    ["день", "дня", "дней", "дн", "д", "d"].includes(unit)
  ) {
    multiplier = 86400;
  }

  if (!multiplier) return null;

  return Math.round(value * multiplier);
}

function localParseCommand(text) {
  const value = String(text || "").trim();

  let match = value.match(
    /^(?:замути|замутить)\s+@?([a-zA-Z0-9_]{3,32})\s+(?:на\s+)?(.+)$/i
  );

  if (match) {
    const duration = parseDuration(match[2]);

    if (duration) {
      return {
        type: "mute",
        username: normalizeUsername(match[1]),
        duration
      };
    }
  }

  match = value.match(
    /^(?:размути|размутить|сними\s+мут)\s+@?([a-zA-Z0-9_]{3,32})$/i
  );

  if (match) {
    return {
      type: "unmute",
      username: normalizeUsername(match[1])
    };
  }

  match = value.match(
    /^(?:следи\s+за|отслеживай)\s+@?([a-zA-Z0-9_]{3,32})$/i
  );

  if (match) {
    return {
      type: "watch",
      username: normalizeUsername(match[1])
    };
  }

  match = value.match(
    /^(?:перестань\s+следить\s+за|не\s+следи\s+за)\s+@?([a-zA-Z0-9_]{3,32})$/i
  );

  if (match) {
    return {
      type: "unwatch",
      username: normalizeUsername(match[1])
    };
  }

  return null;
}

async function parseAICommand(text, context) {
  const local = localParseCommand(text);

  if (local) return local;

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      type: "unknown",
      message:
        "Не удалось распознать команду. Попробуй написать подробнее."
    };
  }

  const model =
    process.env.OPENAI_MODEL || "gpt-5.6";

  const system = `
Ты AI-командный парсер Telegram Business Manager STMA.

Твоя задача — превратить запрос пользователя в JSON.

Разрешённые type:

mute
unmute
watch
unwatch
send_message
delete_message
show_messages
show_edits
show_deleted
show_events
show_stats
unknown

Никогда не выполняй действие самостоятельно.
Только возвращай JSON.

Для mute:
{
  "type":"mute",
  "username":"username",
  "duration":7200
}

Для unmute:
{
  "type":"unmute",
  "username":"username"
}

Для watch:
{
  "type":"watch",
  "username":"username"
}

Для unwatch:
{
  "type":"unwatch",
  "username":"username"
}

Для send_message:
{
  "type":"send_message",
  "username":"username",
  "text":"..."
}

Для delete_message:
{
  "type":"delete_message",
  "chatId":"...",
  "messageId":"..."
}

Для информационных запросов используй соответствующий type.

Если запрос непонятен:
{
  "type":"unknown",
  "message":"..."
}

Возвращай только JSON.
`;

  try {
    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          input: [
            {
              role: "system",
              content: system
            },
            {
              role: "user",
              content: JSON.stringify({
                text,
                context
              })
            }
          ]
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI ERROR:", errorText);

      return {
        type: "unknown",
        message: "AI временно недоступен."
      };
    }

    const data = await response.json();

    const outputText =
      data.output_text ||
      data.output
        ?.flatMap((item) => item.content || [])
        ?.map((item) => item.text || "")
        ?.join("") ||
      "";

    const cleaned = outputText
      .replace(/^```json/i, "")
      .replace(/^```/i, "")
      .replace(/```$/i, "")
      .trim();

    return JSON.parse(cleaned);
  } catch (error) {
    console.error("AI PARSE ERROR:", error);

    return {
      type: "unknown",
      message: "Не удалось обработать команду."
    };
  }
}

async function executeCommand(command, req, connection) {
  const connectionId = connection.id;

  switch (command.type) {
    case "mute": {
      if (!command.username || !command.duration) {
        throw new Error("Не указан пользователь или длительность");
      }

      const target = await findRecentChatByUsername(
        connectionId,
        command.username
      );

      if (!target) {
        throw new Error(
          `Не найден пользователь @${command.username}`
        );
      }

      await muteUser(
        connectionId,
        target.chat_id,
        target.user_id,
        command.duration
      );

      await addEvent({
        userId: req.telegramUser.id,
        connectionId,
        type: "mute",
        chatId: target.chat_id,
        userIdTarget: target.user_id,
        username: command.username
      });

      return {
        ok: true,
        type: "mute",
        message: `@${command.username} замучен.`
      };
    }

    case "unmute": {
      const target = await findRecentChatByUsername(
        connectionId,
        command.username
      );

      if (!target) {
        throw new Error(
          `Не найден пользователь @${command.username}`
        );
      }

      await unmuteUser(
        connectionId,
        target.chat_id,
        target.user_id
      );

      await addEvent({
        userId: req.telegramUser.id,
        connectionId,
        type: "unmute",
        chatId: target.chat_id,
        userIdTarget: target.user_id,
        username: command.username
      });

      return {
        ok: true,
        type: "unmute",
        message: `@${command.username} размучен.`
      };
    }

    case "watch": {
      await addWatch({
        connectionId,
        ownerUserId: req.telegramUser.id,
        username: command.username
      });

      await addEvent({
        userId: req.telegramUser.id,
        connectionId,
        type: "watch",
        username: command.username
      });

      return {
        ok: true,
        type: "watch",
        message: `Теперь отслеживается @${command.username}.`
      };
    }

    case "unwatch": {
      await removeWatch(
        connectionId,
        command.username
      );

      return {
        ok: true,
        type: "unwatch",
        message: `Отслеживание @${command.username} отключено.`
      };
    }

    case "send_message": {
      if (!command.username || !command.text) {
        throw new Error("Не указан пользователь или текст");
      }

      const target = await findRecentChatByUsername(
        connectionId,
        command.username
      );

      if (!target) {
        throw new Error(
          `Не найден чат пользователя @${command.username}`
        );
      }

      const result = await sendBusinessMessage(
        connectionId,
        target.chat_id,
        command.text
      );

      if (result?.message) {
        await saveSentMessage({
          ownerUserId: req.telegramUser.id,
          connectionId,
          message: result.message
        });
      }

      return {
        ok: true,
        type: "send_message",
        message: "Сообщение отправлено."
      };
    }

    case "delete_message": {
      if (!command.chatId || !command.messageId) {
        throw new Error(
          "Для удаления нужны chat ID и message ID."
        );
      }

      await deleteBusinessMessage(
        connectionId,
        command.chatId,
        command.messageId
      );

      await markMessageDeleted(
        connectionId,
        command.chatId,
        command.messageId
      );

      return {
        ok: true,
        type: "delete_message",
        message: "Сообщение удалено."
      };
    }

    case "show_messages":
      return {
        ok: true,
        type: "show_messages",
        data: await getMessages(connectionId, 100)
      };

    case "show_edits":
      return {
        ok: true,
        type: "show_edits",
        data: await getMessages(connectionId, 100, {
          edited: true
        })
      };

    case "show_deleted":
      return {
        ok: true,
        type: "show_deleted",
        data: await getMessages(connectionId, 100, {
          deleted: true
        })
      };

    case "show_events":
      return {
        ok: true,
        type: "show_events",
        data: await getEvents(
          connectionId,
          100
        )
      };

    case "show_stats":
      return {
        ok: true,
        type: "show_stats",
        data: await getStats(connectionId)
      };

    default:
      return {
        ok: false,
        type: "unknown",
        message:
          command.message ||
          "Я не понял команду."
      };
  }
}

app.get("/health", async (req, res) => {
  res.json({
    ok: true,
    service: "STMA"
  });
});

app.get("/api/me", authMiddleware, async (req, res) => {
  const user = await getUser(req.telegramUser.id);

  res.json({
    ok: true,
    user
  });
});

app.get(
  "/api/connections",
  authMiddleware,
  async (req, res) => {
    const connections = await getConnections(
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
  async (req, res) => {
    try {
      const connection = await getOwnedConnection(
        req,
        req.params.connectionId
      );

      res.json({
        ok: true,
        connection
      });
    } catch (error) {
      res.status(403).json({
        ok: false,
        error: error.message
      });
    }
  }
);

app.get(
  "/api/connections/:connectionId/messages",
  authMiddleware,
  async (req, res) => {
    try {
      const connection = await getOwnedConnection(
        req,
        req.params.connectionId
      );

      const messages = await getMessages(
        connection.id,
        200
      );

      res.json({
        ok: true,
        messages
      });
    } catch (error) {
      res.status(403).json({
        ok: false,
        error: error.message
      });
    }
  }
);

app.post(
  "/api/connections/:connectionId/messages",
  authMiddleware,
  async (req, res) => {
    try {
      const connection = await getOwnedConnection(
        req,
        req.params.connectionId
      );

      const {
        chatId,
        text,
        deleteAfter
      } = req.body;

      if (!chatId || !text) {
        return res.status(400).json({
          ok: false,
          error: "chatId and text are required"
        });
      }

      const result = await sendBusinessMessage(
        connection.id,
        chatId,
        text
      );

      if (result?.message) {
        await saveSentMessage({
          ownerUserId: req.telegramUser.id,
          connectionId: connection.id,
          message: result.message
        });
      }

      if (
        Number(deleteAfter) > 0 &&
        result?.message?.message_id
      ) {
        setTimeout(async () => {
          try {
            await deleteBusinessMessage(
              connection.id,
              chatId,
              result.message.message_id
            );

            await markMessageDeleted(
              connection.id,
              chatId,
              result.message.message_id
            );
          } catch (error) {
            console.error(
              "AUTO DELETE ERROR:",
              error.message
            );
          }
        }, Number(deleteAfter) * 1000);
      }

      res.json({
        ok: true,
        message: result?.message || null
      });
    } catch (error) {
      console.error("SEND ERROR:", error);

      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

app.delete(
  "/api/connections/:connectionId/messages/:chatId/:messageId",
  authMiddleware,
  async (req, res) => {
    try {
      const connection = await getOwnedConnection(
        req,
        req.params.connectionId
      );

      await deleteBusinessMessage(
        connection.id,
        req.params.chatId,
        req.params.messageId
      );

      await markMessageDeleted(
        connection.id,
        req.params.chatId,
        req.params.messageId
      );

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

app.post(
  "/api/connections/:connectionId/command",
  authMiddleware,
  async (req, res) => {
    try {
      const connection = await getOwnedConnection(
        req,
        req.params.connectionId
      );

      const text = String(
        req.body?.command || ""
      ).trim();

      if (!text) {
        return res.status(400).json({
          ok: false,
          error: "Command is empty"
        });
      }

      const command = await parseAICommand(
        text,
        {
          connectionId: connection.id
        }
      );

      await saveCommand({
        ownerUserId: req.telegramUser.id,
        connectionId: connection.id,
        input: text,
        result: command
      });

      const result = await executeCommand(
        command,
        req,
        connection
      );

      res.json(result);
    } catch (error) {
      console.error("COMMAND ERROR:", error);

      res.status(400).json({
        ok: false,
        error: error.message
      });
    }
  }
);

app.get(
  "/api/connections/:connectionId/watches",
  authMiddleware,
  async (req, res) => {
    try {
      const connection = await getOwnedConnection(
        req,
        req.params.connectionId
      );

      res.json({
        ok: true,
        watches: await getWatches(connection.id)
      });
    } catch (error) {
      res.status(403).json({
        ok: false,
        error: error.message
      });
    }
  }
);

app.post(
  "/api/connections/:connectionId/watches",
  authMiddleware,
  async (req, res) => {
    try {
      const connection = await getOwnedConnection(
        req,
        req.params.connectionId
      );

      const username = normalizeUsername(
        req.body?.username
      );

      if (!username) {
        return res.status(400).json({
          ok: false,
          error: "Username is required"
        });
      }

      await addWatch({
        connectionId: connection.id,
        ownerUserId: req.telegramUser.id,
        username
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
  "/api/connections/:connectionId/watches/:username",
  authMiddleware,
  async (req, res) => {
    try {
      const connection = await getOwnedConnection(
        req,
        req.params.connectionId
      );

      await removeWatch(
        connection.id,
        normalizeUsername(req.params.username)
      );

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

app.get(
  "/api/connections/:connectionId/events",
  authMiddleware,
  async (req, res) => {
    try {
      const connection = await getOwnedConnection(
        req,
        req.params.connectionId
      );

      res.json({
        ok: true,
        events: await getEvents(
          connection.id,
          200
        )
      });
    } catch (error) {
      res.status(403).json({
        ok: false,
        error: error.message
      });
    }
  }
);

app.get(
  "/api/connections/:connectionId/stats",
  authMiddleware,
  async (req, res) => {
    try {
      const connection = await getOwnedConnection(
        req,
        req.params.connectionId
      );

      res.json({
        ok: true,
        stats: await getStats(
          connection.id
        )
      });
    } catch (error) {
      res.status(403).json({
        ok: false,
        error: error.message
      });
    }
  }
);

app.post(
  "/telegram/webhook",
  async (req, res) => {
    try {
      const secret =
        process.env.WEBHOOK_SECRET;

      if (
        secret &&
        req.headers["x-telegram-bot-api-secret-token"] !==
          secret
      ) {
        return res.status(403).json({
          ok: false
        });
      }

      await processTelegramUpdate(req.body);

      res.json({
        ok: true
      });
    } catch (error) {
      console.error(
        "WEBHOOK ERROR:",
        error
      );

      res.json({
        ok: true
      });
    }
  }
);

async function processTelegramUpdate(update) {
  if (!update) return;

  if (update.business_connection) {
    const bc = update.business_connection;

    await upsertUser({
      id: bc.user?.id,
      username: bc.user?.username || null,
      first_name: bc.user?.first_name || null,
      last_name: bc.user?.last_name || null
    });

    await require("./src/database").upsertBusinessConnection({
      id: bc.id,
      userId: bc.user?.id,
      username: bc.user?.username || null,
      firstName: bc.user?.first_name || null,
      lastName: bc.user?.last_name || null,
      date: bc.date,
      rights: bc.rights || {},
      isEnabled: bc.is_enabled
    });

    await addEvent({
      userId: bc.user?.id,
      connectionId: bc.id,
      type: bc.is_enabled
        ? "business_connected"
        : "business_disconnected"
    });

    return;
  }

  if (update.business_message) {
    await handleBusinessMessage(
      update.business_message,
      "received"
    );

    return;
  }

  if (update.edited_business_message) {
    await handleBusinessMessage(
      update.edited_business_message,
      "edited"
    );

    return;
  }

  if (update.deleted_business_messages) {
    await handleDeletedBusinessMessages(
      update.deleted_business_messages
    );

    return;
  }

  if (update.message) {
    await handleBotMessage(update.message);
  }
}

async function handleBusinessMessage(
  message,
  mode
) {
  const connectionId =
    message.business_connection_id;

  if (!connectionId) return;

  const connection =
    await getConnection(connectionId);

  if (!connection) return;

  const from = message.from || {};

  const record = {
    businessConnectionId: connectionId,
    ownerUserId: connection.user_id,
    chatId: message.chat?.id,
    messageId: message.message_id,
    fromId: from.id || null,
    username: from.username || null,
    firstName: from.first_name || null,
    lastName: from.last_name || null,
    text: message.text || null,
    caption: message.caption || null,
    date: message.date
      ? new Date(message.date * 1000).toISOString()
      : now(),
    direction: "incoming"
  };

  if (mode === "edited") {
    await saveEditedMessage(record);

    await addEvent({
      userId: connection.user_id,
      connectionId,
      type: "message_edited",
      chatId: message.chat?.id,
      messageId: message.message_id,
      userIdTarget: from.id,
      username: from.username
    });
  } else {
    await require("./src/database").saveIncomingMessage(
      record
    );

    await addEvent({
      userId: connection.user_id,
      connectionId,
      type: "message_received",
      chatId: message.chat?.id,
      messageId: message.message_id,
      userIdTarget: from.id,
      username: from.username
    });
  }

  const watches =
    await getTrackedUsernames(connectionId);

  const username =
    normalizeUsername(from.username);

  if (
    username &&
    watches.includes(username)
  ) {
    await addEvent({
      userId: connection.user_id,
      connectionId,
      type: "watch_match",
      chatId: message.chat?.id,
      messageId: message.message_id,
      userIdTarget: from.id,
      username: from.username
    });
  }
}

async function handleDeletedBusinessMessages(data) {
  const connectionId =
    data.business_connection_id;

  const connection =
    await getConnection(connectionId);

  if (!connection) return;

  const messages =
    data.messages || [];

  for (const message of messages) {
    await markMessageDeleted(
      connectionId,
      data.chat?.id,
      message.message_id
    );

    await addEvent({
      userId: connection.user_id,
      connectionId,
      type: "message_deleted",
      chatId: data.chat?.id,
      messageId: message.message_id
    });
  }
}

async function handleBotMessage(message) {
  const text =
    String(message.text || "").trim();

  if (text === "/start") {
    try {
      await answerStart(
        message.chat.id,
        WEBAPP_URL
      );
    } catch (error) {
      console.error(
        "START ERROR:",
        error.message
      );
    }
  }
}

async function startup() {
  if (!BOT_TOKEN) {
    console.warn(
      "WARNING: BOT_TOKEN is not configured."
    );
  }

  await initDatabase();

  if (BOT_TOKEN) {
    if (WEBHOOK_URL) {
      try {
        await setWebhook(
          WEBHOOK_URL,
          process.env.WEBHOOK_SECRET
        );

        console.log(
          "Telegram webhook:",
          WEBHOOK_URL
        );
      } catch (error) {
        console.error(
          "Webhook setup failed:",
          error.message
        );
      }
    }

    if (WEBAPP_URL) {
      try {
        await setMenuButton(
          WEBAPP_URL
        );
      } catch (error) {
        console.error(
          "Menu button setup failed:",
          error.message
        );
      }
    }
  }

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

startup().catch((error) => {
  console.error(
    "STARTUP ERROR:",
    error
  );

  process.exit(1);
});