"use strict";

const express = require("express");
const crypto = require("crypto");
const path = require("path");

const {
  initDatabase,
  run,
  upsertUser,
  getUser,
  upsertBusinessConnection,
  getConnections,
  getConnectionForUser
} = require("./src/database");

const {
  telegramRequest,
  getBusinessConnection,
  sendBusinessMessage,
  deleteBusinessMessage,
  muteUser,
  unmuteUser,
  setWebhook,
  getWebhookInfo,
  setMenuButton,
  answerStart
} = require("./src/business");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = String(process.env.BOT_TOKEN || "").trim();

const WEBAPP_URL = String(
  process.env.WEBAPP_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  ""
).trim().replace(/\/+$/, "");

const WEBHOOK_URL = String(
  process.env.WEBHOOK_URL ||
  (process.env.RENDER_EXTERNAL_URL
    ? `${String(process.env.RENDER_EXTERNAL_URL).replace(/\/+$/, "")}/telegram/webhook`
    : "")
).trim();

const WEBHOOK_SECRET = String(
  process.env.WEBHOOK_SECRET || ""
).trim();

const INIT_DATA_MAX_AGE =
  Number(process.env.INIT_DATA_MAX_AGE || 86400);

const jsonParser = express.json({
  limit: "1mb"
});

app.use(jsonParser);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

function nowIso() {
  return new Date().toISOString();
}

function safeString(value, max = 10000) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).slice(0, max);
}

function toNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/*
==================================================
TELEGRAM INIT DATA VALIDATION
==================================================
*/

function validateTelegramInitData(initData) {
  if (!BOT_TOKEN) {
    throw new Error("BOT_TOKEN is not configured");
  }

  if (!initData || typeof initData !== "string") {
    throw new Error("Telegram initData is required");
  }

  const params = new URLSearchParams(initData);

  const receivedHash = params.get("hash");

  if (!receivedHash) {
    throw new Error("Telegram initData hash is missing");
  }

  params.delete("hash");

  const entries = [];

  for (const [key, value] of params.entries()) {
    entries.push(`${key}=${value}`);
  }

  entries.sort();

  const dataCheckString =
    entries.join("\n");

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

  const receivedBuffer =
    Buffer.from(receivedHash, "hex");

  const calculatedBuffer =
    Buffer.from(calculatedHash, "hex");

  if (
    receivedBuffer.length !==
    calculatedBuffer.length
  ) {
    throw new Error("Invalid Telegram initData signature");
  }

  if (
    !crypto.timingSafeEqual(
      receivedBuffer,
      calculatedBuffer
    )
  ) {
    throw new Error("Invalid Telegram initData signature");
  }

  const authDate =
    Number(params.get("auth_date"));

  if (
    !Number.isFinite(authDate) ||
    authDate <= 0
  ) {
    throw new Error("Invalid Telegram auth_date");
  }

  const age =
    Math.floor(Date.now() / 1000) -
    authDate;

  if (
    age < -60 ||
    age > INIT_DATA_MAX_AGE
  ) {
    throw new Error("Telegram initData has expired");
  }

  const userRaw =
    params.get("user");

  if (!userRaw) {
    throw new Error("Telegram user is missing");
  }

  let user;

  try {
    user = JSON.parse(userRaw);
  } catch {
    throw new Error("Invalid Telegram user data");
  }

  if (!user?.id) {
    throw new Error("Telegram user ID is missing");
  }

  return {
    user,
    authDate
  };
}

/*
==================================================
AUTH MIDDLEWARE
==================================================
*/

async function authenticateMiniApp(
  req,
  res,
  next
) {
  try {
    const initData =
      req.get("X-Telegram-Init-Data") ||
      req.body?.initData ||
      req.query?.initData;

    const auth =
      validateTelegramInitData(initData);

    await upsertUser(auth.user);

    req.telegramUser = auth.user;
    req.telegramAuthDate = auth.authDate;

    next();
  } catch (error) {
    console.error(
      "Mini App authentication error:",
      error.message
    );

    res.status(401).json({
      ok: false,
      error: "Unauthorized",
      message: error.message
    });
  }
}

/*
==================================================
CONNECTION OWNERSHIP
==================================================
*/

async function requireConnection(
  req,
  res,
  next
) {
  try {
    const connectionId =
      safeString(
        req.params.connectionId,
        200
      );

    if (!connectionId) {
      return res.status(400).json({
        ok: false,
        error: "connectionId is required"
      });
    }

    const connection =
      await getConnectionForUser(
        connectionId,
        req.telegramUser.id
      );

    if (!connection) {
      return res.status(404).json({
        ok: false,
        error: "Business Connection not found"
      });
    }

    if (!connection.is_enabled) {
      return res.status(409).json({
        ok: false,
        error: "Business Connection is disabled"
      });
    }

    req.connection = connection;

    next();
  } catch (error) {
    console.error(
      "Connection ownership error:",
      error
    );

    res.status(500).json({
      ok: false,
      error: "Failed to check Business Connection"
    });
  }
}

/*
==================================================
DATABASE TABLES
==================================================
*/

async function initExtraTables() {
  await run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_connection_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      chat_username TEXT,
      message_id INTEGER NOT NULL,
      from_user_id TEXT,
      from_username TEXT,
      from_first_name TEXT,
      from_last_name TEXT,
      text TEXT,
      caption TEXT,
      date INTEGER,
      direction TEXT NOT NULL,
      edited INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(business_connection_id, chat_id, message_id)
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS
    idx_messages_owner
    ON messages(owner_user_id)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS
    idx_messages_connection
    ON messages(business_connection_id)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS
    idx_messages_chat
    ON messages(business_connection_id, chat_id)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS watches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      user_id TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(connection_id, username)
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS
    idx_watches_connection
    ON watches(connection_id, active)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      connection_id TEXT,
      owner_user_id TEXT,
      chat_id TEXT,
      message_id INTEGER,
      user_id TEXT,
      username TEXT,
      created_at TEXT NOT NULL,
      payload_json TEXT
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS
    idx_events_connection
    ON events(connection_id, created_at)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS command_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      chat_id TEXT,
      command TEXT NOT NULL,
      type TEXT,
      result TEXT,
      success INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS
    idx_commands_connection
    ON command_history(connection_id, created_at)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS scheduled_deletions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      delete_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS
    idx_scheduled_deletions
    ON scheduled_deletions(status, delete_at)
  `);

  console.log(
    "STMA extra Turso tables initialized"
  );
}

/*
==================================================
EVENTS
==================================================
*/

async function createEvent({
  type,
  connectionId = null,
  ownerUserId = null,
  chatId = null,
  messageId = null,
  userId = null,
  username = null,
  payload = {}
}) {
  try {
    await run(
      `
      INSERT INTO events (
        type,
        connection_id,
        owner_user_id,
        chat_id,
        message_id,
        user_id,
        username,
        created_at,
        payload_json
      )
      VALUES (
        :type,
        :connection_id,
        :owner_user_id,
        :chat_id,
        :message_id,
        :user_id,
        :username,
        :created_at,
        :payload_json
      )
      `,
      {
        type,
        connection_id: connectionId,
        owner_user_id:
          ownerUserId
            ? String(ownerUserId)
            : null,
        chat_id:
          chatId !== null
            ? String(chatId)
            : null,
        message_id:
          messageId !== null
            ? Number(messageId)
            : null,
        user_id:
          userId !== null
            ? String(userId)
            : null,
        username:
          username || null,
        created_at: nowIso(),
        payload_json:
          JSON.stringify(payload || {})
      }
    );
  } catch (error) {
    console.error(
      "Failed to create event:",
      error.message
    );
  }
}

/*
==================================================
COMMAND PARSER
==================================================
*/

function parseDurationUnit(unit) {
  const normalized =
    String(unit || "")
      .toLowerCase()
      .replace("ё", "е");

  const units = {
    сек: 1,
    секунда: 1,
    секунду: 1,
    секунды: 1,
    секунд: 1,
    s: 1,

    мин: 60,
    минута: 60,
    минуту: 60,
    минуты: 60,
    минут: 60,
    m: 60,

    ч: 3600,
    час: 3600,
    часа: 3600,
    часов: 3600,
    h: 3600,

    д: 86400,
    день: 86400,
    дня: 86400,
    дней: 86400,
    d: 86400
  };

  return units[normalized] || null;
}

function parseCommand(input) {
  const text =
    String(input || "")
      .trim();

  if (!text) {
    return {
      type: "unknown",
      raw: text
    };
  }

  let match =
    text.match(
      /^замут(?:ь|ить)?\s+@?([a-zA-Z0-9_]+)\s+на\s+(\d+(?:\.\d+)?)\s*([^\s]+)$/iu
    );

  if (match) {
    const username =
      match[1].replace(/^@/, "");

    const amount =
      Number(match[2]);

    const multiplier =
      parseDurationUnit(match[3]);

    if (
      Number.isFinite(amount) &&
      amount > 0 &&
      multiplier
    ) {
      return {
        type: "mute",
        username,
        duration:
          Math.floor(amount * multiplier),
        raw: text
      };
    }
  }

  match =
    text.match(
      /^замут(?:ь|ить)?\s+(\d+)\s+на\s+(\d+(?:\.\d+)?)\s*([^\s]+)$/iu
    );

  if (match) {
    const userId =
      match[1];

    const amount =
      Number(match[2]);

    const multiplier =
      parseDurationUnit(match[3]);

    if (
      Number.isFinite(amount) &&
      amount > 0 &&
      multiplier
    ) {
      return {
        type: "mute",
        userId,
        duration:
          Math.floor(amount * multiplier),
        raw: text
      };
    }
  }

  match =
    text.match(
      /^размут(?:ь|ить)?\s+@?([a-zA-Z0-9_]+)$/iu
    );

  if (match) {
    return {
      type: "unmute",
      username:
        match[1].replace(/^@/, ""),
      raw: text
    };
  }

  match =
    text.match(
      /^размут(?:ь|ить)?\s+(\d+)$/iu
    );

  if (match) {
    return {
      type: "unmute",
      userId: match[1],
      raw: text
    };
  }

  match =
    text.match(
      /^следи\s+за\s+@?([a-zA-Z0-9_]+)$/iu
    );

  if (match) {
    return {
      type: "watch",
      username:
        match[1].replace(/^@/, ""),
      raw: text
    };
  }

  match =
    text.match(
      /^перестань\s+следить\s+за\s+@?([a-zA-Z0-9_]+)$/iu
    );

  if (match) {
    return {
      type: "unwatch",
      username:
        match[1].replace(/^@/, ""),
      raw: text
    };
  }

  return {
    type: "unknown",
    raw: text
  };
}

/*
==================================================
MESSAGE HELPERS
==================================================
*/

function extractMessageText(message) {
  return (
    message?.text ||
    message?.caption ||
    ""
  );
}

function getMessageUser(message) {
  const user =
    message?.from ||
    message?.sender_chat ||
    null;

  return {
    id:
      user?.id != null
        ? String(user.id)
        : null,

    username:
      user?.username ||
      null,

    first_name:
      user?.first_name ||
      null,

    last_name:
      user?.last_name ||
      null
  };
}

function getMessageLink(message) {
  const chat =
    message?.chat;

  const messageId =
    message?.message_id;

  if (
    !chat ||
    !messageId
  ) {
    return null;
  }

  if (chat.username) {
    return `https://t.me/${chat.username}/${messageId}`;
  }

  const chatId =
    String(chat.id || "");

  if (
    chatId.startsWith("-100")
  ) {
    const internalId =
      chatId.slice(4);

    return `https://t.me/c/${internalId}/${messageId}`;
  }

  return null;
}

async function saveMessage({
  connectionId,
  ownerUserId,
  message,
  direction,
  edited = false
}) {
  const user =
    getMessageUser(message);

  const text =
    message?.text || null;

  const caption =
    message?.caption || null;

  const timestamp =
    nowIso();

  await run(
    `
    INSERT INTO messages (
      business_connection_id,
      owner_user_id,
      chat_id,
      chat_username,
      message_id,
      from_user_id,
      from_username,
      from_first_name,
      from_last_name,
      text,
      caption,
      date,
      direction,
      edited,
      deleted,
      deleted_at,
      created_at,
      updated_at
    )
    VALUES (
      :connection_id,
      :owner_user_id,
      :chat_id,
      :chat_username,
      :message_id,
      :from_user_id,
      :from_username,
      :from_first_name,
      :from_last_name,
      :text,
      :caption,
      :date,
      :direction,
      :edited,
      0,
      NULL,
      :created_at,
      :updated_at
    )

    ON CONFLICT(
      business_connection_id,
      chat_id,
      message_id
    )

    DO UPDATE SET
      chat_username =
        excluded.chat_username,

      from_user_id =
        excluded.from_user_id,

      from_username =
        excluded.from_username,

      from_first_name =
        excluded.from_first_name,

      from_last_name =
        excluded.from_last_name,

      text =
        excluded.text,

      caption =
        excluded.caption,

      date =
        excluded.date,

      direction =
        excluded.direction,

      edited =
        excluded.edited,

      updated_at =
        excluded.updated_at
    `,
    {
      connection_id:
        String(connectionId),

      owner_user_id:
        String(ownerUserId),

      chat_id:
        String(message.chat?.id),

      chat_username:
        message.chat?.username ||
        null,

      message_id:
        Number(message.message_id),

      from_user_id:
        user.id,

      from_username:
        user.username,

      from_first_name:
        user.first_name,

      from_last_name:
        user.last_name,

      text,

      caption,

      date:
        Number(message.date) ||
        null,

      direction,

      edited:
        edited ? 1 : 0,

      created_at:
        timestamp,

      updated_at:
        timestamp
    }
  );
}

async function markMessageDeleted({
  connectionId,
  ownerUserId,
  chatId,
  messageId
}) {
  await run(
    `
    UPDATE messages
    SET
      deleted = 1,
      deleted_at = :deleted_at,
      updated_at = :updated_at
    WHERE
      business_connection_id = :connection_id
      AND chat_id = :chat_id
      AND message_id = :message_id
    `,
    {
      connection_id:
        String(connectionId),

      chat_id:
        String(chatId),

      message_id:
        Number(messageId),

      deleted_at:
        nowIso(),

      updated_at:
        nowIso()
    }
  );
}

/*
==================================================
WATCH MATCH
==================================================
*/

async function processWatchMatches({
  connectionId,
  ownerUserId,
  message
}) {
  const user =
    getMessageUser(message);

  if (!user.username) {
    return;
  }

  const result =
    await run(
      `
      SELECT *
      FROM watches
      WHERE
        connection_id = :connection_id
        AND owner_user_id = :owner_user_id
        AND active = 1
        AND lower(username) = lower(:username)
      `,
      {
        connection_id:
          String(connectionId),

        owner_user_id:
          String(ownerUserId),

        username:
          user.username
      }
    );

  for (const watch of result.rows) {
    await run(
      `
      UPDATE watches
      SET
        user_id = :user_id,
        updated_at = :updated_at
      WHERE id = :id
      `,
      {
        user_id:
          user.id,

        updated_at:
          nowIso(),

        id:
          Number(watch.id)
      }
    );

    await createEvent({
      type: "watch_match",
      connectionId,
      ownerUserId,
      chatId: message.chat?.id,
      messageId: message.message_id,
      userId: user.id,
      username: user.username,
      payload: {
        watch_id:
          Number(watch.id),
        text:
          extractMessageText(message),
        link:
          getMessageLink(message)
      }
    });
  }
}

/*
==================================================
RESOLVE USER
==================================================
*/

async function resolveUserId(
  connectionId,
  ownerUserId,
  username,
  explicitUserId
) {
  if (explicitUserId) {
    return String(explicitUserId);
  }

  if (!username) {
    return null;
  }

  const result =
    await run(
      `
      SELECT user_id
      FROM watches
      WHERE
        connection_id = :connection_id
        AND owner_user_id = :owner_user_id
        AND active = 1
        AND lower(username) = lower(:username)
        AND user_id IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 1
      `,
      {
        connection_id:
          String(connectionId),

        owner_user_id:
          String(ownerUserId),

        username:
          username.replace(/^@/, "")
      }
    );

  return result.rows[0]?.user_id
    ? String(result.rows[0].user_id)
    : null;
}

/*
==================================================
COMMAND EXECUTION
==================================================
*/

async function executeCommand({
  connection,
  ownerUserId,
  chatId,
  commandText
}) {
  const parsed =
    parseCommand(commandText);

  if (parsed.type === "unknown") {
    return {
      ok: false,
      type: "unknown",
      message:
        "Не понял команду. Примеры: «замуть 123456789 на 30 минут», «размути 123456789», «следи за @username»."
    };
  }

  if (parsed.type === "watch") {
    const username =
      parsed.username
        .replace(/^@/, "")
        .toLowerCase();

    await run(
      `
      INSERT INTO watches (
        connection_id,
        owner_user_id,
        username,
        user_id,
        active,
        created_at,
        updated_at
      )
      VALUES (
        :connection_id,
        :owner_user_id,
        :username,
        NULL,
        1,
        :created_at,
        :updated_at
      )
      ON CONFLICT(connection_id, username)
      DO UPDATE SET
        active = 1,
        updated_at = excluded.updated_at
      `,
      {
        connection_id:
          String(connection.id),

        owner_user_id:
          String(ownerUserId),

        username,

        created_at:
          nowIso(),

        updated_at:
          nowIso()
      }
    );

    await createEvent({
      type: "watch",
      connectionId:
        connection.id,
      ownerUserId,
      payload: {
        username
      }
    });

    return {
      ok: true,
      type: "watch",
      message:
        `Теперь слежу за @${username}`
    };
  }

  if (parsed.type === "unwatch") {
    const username =
      parsed.username
        .replace(/^@/, "")
        .toLowerCase();

    await run(
      `
      UPDATE watches
      SET
        active = 0,
        updated_at = :updated_at
      WHERE
        connection_id = :connection_id
        AND owner_user_id = :owner_user_id
        AND lower(username) = lower(:username)
      `,
      {
        connection_id:
          String(connection.id),

        owner_user_id:
          String(ownerUserId),

        username,

        updated_at:
          nowIso()
      }
    );

    return {
      ok: true,
      type: "unwatch",
      message:
        `Слежение за @${username} отключено`
    };
  }

  if (
    parsed.type === "mute" ||
    parsed.type === "unmute"
  ) {
    const targetUserId =
      await resolveUserId(
        connection.id,
        ownerUserId,
        parsed.username,
        parsed.userId
      );

    if (!targetUserId) {
      return {
        ok: false,
        type: parsed.type,
        message:
          "Не удалось определить Telegram user ID. Для @username сначала используй «следи за @username» и дождись сообщения этого пользователя."
      };
    }

    if (chatId === null || chatId === undefined || chatId === "") {
      return {
        ok: false,
        type: parsed.type,
        message:
          "Для мута укажи Chat ID."
      };
    }

    try {
      if (parsed.type === "mute") {
        await muteUser(
          connection.id,
          chatId,
          targetUserId,
          parsed.duration
        );

        await createEvent({
          type: "mute",
          connectionId:
            connection.id,
          ownerUserId,
          chatId,
          userId:
            targetUserId,
          payload: {
            duration:
              parsed.duration
          }
        });

        return {
          ok: true,
          type: "mute",
          userId:
            targetUserId,
          duration:
            parsed.duration,
          message:
            `Пользователь ${targetUserId} замьючен на ${parsed.duration} секунд.`
        };
      }

      await unmuteUser(
        connection.id,
        chatId,
        targetUserId
      );

      await createEvent({
        type: "unmute",
        connectionId:
          connection.id,
        ownerUserId,
        chatId,
        userId:
          targetUserId
      });

      return {
        ok: true,
        type: "unmute",
        userId:
          targetUserId,
        message:
          `Пользователь ${targetUserId} размьючен.`
      };
    } catch (error) {
      await createEvent({
        type: "error",
        connectionId:
          connection.id,
        ownerUserId,
        chatId,
        userId:
          targetUserId,
        payload: {
          command:
            commandText,
          error:
            error.message
        }
      });

      return {
        ok: false,
        type: parsed.type,
        message:
          error.message
      };
    }
  }

  return {
    ok: false,
    type: "unknown",
    message: "Команда не поддерживается."
  };
}

/*
==================================================
SCHEDULED DELETIONS
==================================================
*/

async function scheduleDeletion({
  connectionId,
  ownerUserId,
  chatId,
  messageId,
  seconds
}) {
  const delay =
    Number(seconds);

  if (
    !Number.isFinite(delay) ||
    delay <= 0
  ) {
    return;
  }

  const deleteAt =
    Math.floor(Date.now() / 1000) +
    Math.floor(delay);

  await run(
    `
    INSERT INTO scheduled_deletions (
      connection_id,
      owner_user_id,
      chat_id,
      message_id,
      delete_at,
      status,
      created_at
    )
    VALUES (
      :connection_id,
      :owner_user_id,
      :chat_id,
      :message_id,
      :delete_at,
      'pending',
      :created_at
    )
    `,
    {
      connection_id:
        String(connectionId),

      owner_user_id:
        String(ownerUserId),

      chat_id:
        String(chatId),

      message_id:
        Number(messageId),

      delete_at:
        deleteAt,

      created_at:
        nowIso()
    }
  );
}

async function processScheduledDeletions() {
  try {
    const result =
      await run(
        `
        SELECT *
        FROM scheduled_deletions
        WHERE
          status = 'pending'
          AND delete_at <= :now
        ORDER BY delete_at ASC
        LIMIT 50
        `,
        {
          now:
            Math.floor(Date.now() / 1000)
        }
      );

    for (const item of result.rows) {
      try {
        await deleteBusinessMessage(
          item.connection_id,
          item.chat_id,
          item.message_id
        );

        await run(
          `
          UPDATE scheduled_deletions
          SET
            status = 'completed',
            completed_at = :completed_at
          WHERE id = :id
          `,
          {
            completed_at:
              nowIso(),

            id:
              Number(item.id)
          }
        );

        await run(
          `
          UPDATE messages
          SET
            deleted = 1,
            deleted_at = :deleted_at,
            updated_at = :updated_at
          WHERE
            business_connection_id = :connection_id
            AND chat_id = :chat_id
            AND message_id = :message_id
          `,
          {
            deleted_at:
              nowIso(),

            updated_at:
              nowIso(),

            connection_id:
              item.connection_id,

            chat_id:
              String(item.chat_id),

            message_id:
              Number(item.message_id)
          }
        );

        await createEvent({
          type: "message_deleted",
          connectionId:
            item.connection_id,
          ownerUserId:
            item.owner_user_id,
          chatId:
            item.chat_id,
          messageId:
            item.message_id
        });
      } catch (error) {
        console.error(
          "Scheduled deletion error:",
          error.message
        );

        await run(
          `
          UPDATE scheduled_deletions
          SET
            status = 'failed',
            completed_at = :completed_at,
            error = :error
          WHERE id = :id
          `,
          {
            completed_at:
              nowIso(),

            error:
              error.message,

            id:
              Number(item.id)
          }
        );
      }
    }
  } catch (error) {
    console.error(
      "Deletion worker error:",
      error.message
    );
  }
}

/*
==================================================
TELEGRAM UPDATE PROCESSING
==================================================
*/

async function ensureConnectionFromTelegram(
  connectionId
) {
  let connection =
    await getConnectionForUser(
      connectionId,
      (
        await getBusinessConnection(
          connectionId
        )
      ).user.id
    );

  if (connection) {
    return connection;
  }

  const telegramConnection =
    await getBusinessConnection(
      connectionId
    );

  const user =
    telegramConnection.user;

  await upsertUser(user);

  await upsertBusinessConnection({
    id:
      telegramConnection.id,

    userId:
      user.id,

    userChatId:
      user.id,

    username:
      user.username,

    firstName:
      user.first_name,

    lastName:
      user.last_name,

    date:
      telegramConnection.date,

    rights:
      telegramConnection.rights || {},

    isEnabled:
      Boolean(
        telegramConnection.is_enabled
      )
  });

  return telegramConnection;
}

async function processBusinessConnection(update) {
  const connection =
    update.business_connection;

  if (!connection?.id || !connection?.user?.id) {
    return;
  }

  const user =
    connection.user;

  await upsertUser(user);

  await upsertBusinessConnection({
    id:
      connection.id,

    userId:
      user.id,

    userChatId:
      user.id,

    username:
      user.username,

    firstName:
      user.first_name,

    lastName:
      user.last_name,

    date:
      connection.date,

    rights:
      connection.rights || {},

    isEnabled:
      Boolean(connection.is_enabled)
  });

  await createEvent({
    type:
      connection.is_enabled
        ? "business_connected"
        : "business_disconnected",

    connectionId:
      connection.id,

    ownerUserId:
      user.id,

    userId:
      user.id,

    username:
      user.username,

    payload:
      connection
  });

  console.log(
    "Business Connection:",
    connection.id,
    "user:",
    user.id,
    "enabled:",
    connection.is_enabled
  );
}

async function processBusinessMessage(
  message,
  edited = false
) {
  const connectionId =
    message.business_connection_id;

  if (!connectionId) {
    return;
  }

  let connection =
    await getBusinessConnection(
      connectionId
    );

  const owner =
    connection?.user;

  if (!owner?.id) {
    console.error(
      "Business owner is missing:",
      connectionId
    );

    return;
  }

  await upsertUser(owner);

  await upsertBusinessConnection({
    id:
      connection.id,

    userId:
      owner.id,

    userChatId:
      owner.id,

    username:
      owner.username,

    firstName:
      owner.first_name,

    lastName:
      owner.last_name,

    date:
      connection.date,

    rights:
      connection.rights || {},

    isEnabled:
      Boolean(connection.is_enabled)
  });

  await saveMessage({
    connectionId,
    ownerUserId:
      owner.id,
    message,
    direction:
      "received",
    edited
  });

  await createEvent({
    type:
      edited
        ? "message_edited"
        : "message_received",

    connectionId,

    ownerUserId:
      owner.id,

    chatId:
      message.chat?.id,

    messageId:
      message.message_id,

    userId:
      getMessageUser(message).id,

    username:
      getMessageUser(message).username,

    payload: {
      text:
        extractMessageText(message),

      link:
        getMessageLink(message)
    }
  });

  await processWatchMatches({
    connectionId,
    ownerUserId:
      owner.id,
    message
  });
}

async function processDeletedBusinessMessages(
  deleted
) {
  const connectionId =
    deleted.business_connection_id;

  if (!connectionId) {
    return;
  }

  let connection;

  try {
    connection =
      await getBusinessConnection(
        connectionId
      );
  } catch (error) {
    console.error(
      "Cannot get Business Connection for deletion:",
      error.message
    );

    return;
  }

  const ownerId =
    connection?.user?.id;

  if (!ownerId) {
    return;
  }

  const chatId =
    deleted.chat?.id;

  const messageIds =
    Array.isArray(deleted.message_ids)
      ? deleted.message_ids
      : [];

  for (const messageId of messageIds) {
    await markMessageDeleted({
      connectionId,
      ownerUserId:
        ownerId,
      chatId,
      messageId
    });

    await createEvent({
      type:
        "message_deleted",

      connectionId,

      ownerUserId:
        ownerId,

      chatId,

      messageId,

      payload: {
        deleted:
          true
      }
    });
  }
}

async function processUpdate(update) {
  if (update.business_connection) {
    await processBusinessConnection(
      update
    );
  }

  if (update.business_message) {
    await processBusinessMessage(
      update.business_message,
      false
    );
  }

  if (update.edited_business_message) {
    await processBusinessMessage(
      update.edited_business_message,
      true
    );
  }

  if (update.deleted_business_messages) {
    await processDeletedBusinessMessages(
      update.deleted_business_messages
    );
  }

  if (
    update.message &&
    update.message.text
  ) {
    const text =
      update.message.text;

    if (
      text === "/start" ||
      text.startsWith("/start ")
    ) {
      try {
        await answerStart(
          update.message.chat.id,
          WEBAPP_URL
        );
      } catch (error) {
        console.error(
          "/start error:",
          error.message
        );
      }
    }
  }
}

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
      service: "STMA"
    });
  }
);

/*
==================================================
API / ME
==================================================
*/

app.get(
  "/api/me",
  authenticateMiniApp,
  async (req, res) => {
    try {
      const user =
        await getUser(
          req.telegramUser.id
        );

      res.json({
        ok: true,
        user: user || req.telegramUser
      });
    } catch (error) {
      console.error(
        "/api/me:",
        error
      );

      res.status(500).json({
        ok: false,
        error: "Failed to load user"
      });
    }
  }
);

/*
==================================================
API / CONNECTIONS
==================================================
*/

app.get(
  "/api/connections",
  authenticateMiniApp,
  async (req, res) => {
    try {
      const connections =
        await getConnections(
          req.telegramUser.id
        );

      res.json({
        ok: true,
        connections
      });
    } catch (error) {
      console.error(
        "/api/connections:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to load Business Connections"
      });
    }
  }
);

app.get(
  "/api/connections/:connectionId",
  authenticateMiniApp,
  requireConnection,
  async (req, res) => {
    res.json({
      ok: true,
      connection:
        req.connection
    });
  }
);

/*
==================================================
MESSAGES LIST
==================================================
*/

app.get(
  "/api/connections/:connectionId/messages",
  authenticateMiniApp,
  requireConnection,
  async (req, res) => {
    try {
      const chatId =
        req.query.chatId
          ? String(req.query.chatId)
          : null;

      const limit =
        Math.min(
          Math.max(
            Number(req.query.limit) || 100,
            1
          ),
          300
        );

      const offset =
        Math.max(
          Number(req.query.offset) || 0,
          0
        );

      const result =
        await run(
          `
          SELECT *
          FROM messages
          WHERE
            business_connection_id =
              :connection_id
            AND owner_user_id =
              :owner_user_id

            AND (
              :chat_id IS NULL
              OR chat_id = :chat_id
            )

          ORDER BY
            COALESCE(date, 0) DESC,
            id DESC

          LIMIT :limit
          OFFSET :offset
          `,
          {
            connection_id:
              req.connection.id,

            owner_user_id:
              String(req.telegramUser.id),

            chat_id:
              chatId,

            limit,

            offset
          }
        );

      const messages =
        result.rows.map(
          row => ({
            id:
              Number(row.id),

            business_connection_id:
              row.business_connection_id,

            chat_id:
              String(row.chat_id),

            chat_username:
              row.chat_username || null,

            message_id:
              Number(row.message_id),

            from_user_id:
              row.from_user_id
                ? String(row.from_user_id)
                : null,

            from_username:
              row.from_username || null,

            from_first_name:
              row.from_first_name || null,

            text:
              row.text || "",

            caption:
              row.caption || "",

            date:
              row.date || null,

            direction:
              row.direction,

            edited:
              Boolean(row.edited),

            deleted:
              Boolean(row.deleted),

            deleted_at:
              row.deleted_at || null,

            link:
              row.chat_username
                ? `https://t.me/${row.chat_username}/${row.message_id}`
                : String(row.chat_id).startsWith("-100")
                  ? `https://t.me/c/${String(row.chat_id).slice(4)}/${row.message_id}`
                  : null,

            created_at:
              row.created_at
          })
        );

      res.json({
        ok: true,
        messages
      });
    } catch (error) {
      console.error(
        "messages list:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to load messages"
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
  "/api/connections/:connectionId/messages",
  authenticateMiniApp,
  requireConnection,
  async (req, res) => {
    const chatId =
      req.body?.chatId;

    const text =
      safeString(
        req.body?.text,
        4096
      );

    const deleteAfter =
      Number(
        req.body?.deleteAfter || 0
      );

    if (
      chatId === undefined ||
      chatId === null ||
      chatId === ""
    ) {
      return res.status(400).json({
        ok: false,
        error: "Chat ID is required"
      });
    }

    if (!text.trim()) {
      return res.status(400).json({
        ok: false,
        error: "Message text is required"
      });
    }

    try {
      const sent =
        await sendBusinessMessage(
          req.connection.id,
          chatId,
          text
        );

      await saveMessage({
        connectionId:
          req.connection.id,

        ownerUserId:
          req.telegramUser.id,

        message: sent,

        direction:
          "sent",

        edited:
          false
      });

      await createEvent({
        type:
          "message_sent",

        connectionId:
          req.connection.id,

        ownerUserId:
          req.telegramUser.id,

        chatId:
          sent.chat?.id,

        messageId:
          sent.message_id,

        payload: {
          text
        }
      });

      if (
        Number.isFinite(deleteAfter) &&
        deleteAfter > 0
      ) {
        await scheduleDeletion({
          connectionId:
            req.connection.id,

          ownerUserId:
            req.telegramUser.id,

          chatId:
            sent.chat?.id ?? chatId,

          messageId:
            sent.message_id,

          seconds:
            Math.min(
              Math.floor(deleteAfter),
              30 * 24 * 60 * 60
            )
        });
      }

      res.json({
        ok: true,
        message: sent
      });
    } catch (error) {
      console.error(
        "send message:",
        error
      );

      await createEvent({
        type:
          "error",

        connectionId:
          req.connection.id,

        ownerUserId:
          req.telegramUser.id,

        chatId,

        payload: {
          operation:
            "send_message",

          error:
            error.message
        }
      });

      res.status(502).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/*
==================================================
DELETE MESSAGE
==================================================
*/

app.delete(
  "/api/connections/:connectionId/messages/:chatId/:messageId",
  authenticateMiniApp,
  requireConnection,
  async (req, res) => {
    const chatId =
      req.params.chatId;

    const messageId =
      Number(req.params.messageId);

    if (
      !Number.isFinite(messageId)
    ) {
      return res.status(400).json({
        ok: false,
        error: "Invalid message ID"
      });
    }

    try {
      await deleteBusinessMessage(
        req.connection.id,
        chatId,
        messageId
      );

      await run(
        `
        UPDATE messages
        SET
          deleted = 1,
          deleted_at = :deleted_at,
          updated_at = :updated_at
        WHERE
          business_connection_id =
            :connection_id
          AND chat_id = :chat_id
          AND message_id = :message_id
        `,
        {
          deleted_at:
            nowIso(),

          updated_at:
            nowIso(),

          connection_id:
            req.connection.id,

          chat_id:
            String(chatId),

          message_id:
            messageId
        }
      );

      await createEvent({
        type:
          "message_deleted",

        connectionId:
          req.connection.id,

        ownerUserId:
          req.telegramUser.id,

        chatId,

        messageId
      });

      res.json({
        ok: true
      });
    } catch (error) {
      console.error(
        "delete message:",
        error
      );

      res.status(502).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/*
==================================================
COMMAND
==================================================
*/

app.post(
  "/api/connections/:connectionId/command",
  authenticateMiniApp,
  requireConnection,
  async (req, res) => {
    const command =
      safeString(
        req.body?.command,
        1000
      ).trim();

    const chatId =
      req.body?.chatId ?? null;

    if (!command) {
      return res.status(400).json({
        ok: false,
        error:
          "Command is required"
      });
    }

    try {
      const result =
        await executeCommand({
          connection:
            req.connection,

          ownerUserId:
            req.telegramUser.id,

          chatId,

          commandText:
            command
        });

      await run(
        `
        INSERT INTO command_history (
          connection_id,
          owner_user_id,
          chat_id,
          command,
          type,
          result,
          success,
          created_at
        )
        VALUES (
          :connection_id,
          :owner_user_id,
          :chat_id,
          :command,
          :type,
          :result,
          :success,
          :created_at
        )
        `,
        {
          connection_id:
            req.connection.id,

          owner_user_id:
            String(req.telegramUser.id),

          chat_id:
            chatId !== null
              ? String(chatId)
              : null,

          command,

          type:
            result.type || null,

          result:
            result.message || "",

          success:
            result.ok ? 1 : 0,

          created_at:
            nowIso()
        }
      );

      res.json({
        ok: result.ok,
        result
      });
    } catch (error) {
      console.error(
        "command:",
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
  "/api/connections/:connectionId/watches",
  authenticateMiniApp,
  requireConnection,
  async (req, res) => {
    try {
      const result =
        await run(
          `
          SELECT *
          FROM watches
          WHERE
            connection_id =
              :connection_id
            AND owner_user_id =
              :owner_user_id
            AND active = 1
          ORDER BY created_at DESC
          `,
          {
            connection_id:
              req.connection.id,

            owner_user_id:
              String(req.telegramUser.id)
          }
        );

      res.json({
        ok: true,

        watches:
          result.rows.map(
            row => ({
              id:
                Number(row.id),

              username:
                row.username,

              user_id:
                row.user_id
                  ? String(row.user_id)
                  : null,

              active:
                Boolean(row.active),

              created_at:
                row.created_at
            })
          )
      });
    } catch (error) {
      console.error(
        "watches:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to load watches"
      });
    }
  }
);

app.post(
  "/api/connections/:connectionId/watches",
  authenticateMiniApp,
  requireConnection,
  async (req, res) => {
    const username =
      safeString(
        req.body?.username,
        100
      )
        .replace(/^@/, "")
        .trim()
        .toLowerCase();

    if (!/^[a-zA-Z0-9_]{5,32}$/.test(username)) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid Telegram username"
      });
    }

    try {
      await run(
        `
        INSERT INTO watches (
          connection_id,
          owner_user_id,
          username,
          active,
          created_at,
          updated_at
        )
        VALUES (
          :connection_id,
          :owner_user_id,
          :username,
          1,
          :created_at,
          :updated_at
        )
        ON CONFLICT(connection_id, username)
        DO UPDATE SET
          active = 1,
          updated_at = excluded.updated_at
        `,
        {
          connection_id:
            req.connection.id,

          owner_user_id:
            String(req.telegramUser.id),

          username,

          created_at:
            nowIso(),

          updated_at:
            nowIso()
        }
      );

      await createEvent({
        type:
          "watch",

        connectionId:
          req.connection.id,

        ownerUserId:
          req.telegramUser.id,

        username
      });

      res.json({
        ok: true,
        username
      });
    } catch (error) {
      console.error(
        "add watch:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to add watch"
      });
    }
  }
);

app.delete(
  "/api/connections/:connectionId/watches/:username",
  authenticateMiniApp,
  requireConnection,
  async (req, res) => {
    const username =
      safeString(
        req.params.username,
        100
      )
        .replace(/^@/, "")
        .toLowerCase();

    try {
      await run(
        `
        UPDATE watches
        SET
          active = 0,
          updated_at = :updated_at
        WHERE
          connection_id =
            :connection_id
          AND owner_user_id =
            :owner_user_id
          AND lower(username) =
            lower(:username)
        `,
        {
          updated_at:
            nowIso(),

          connection_id:
            req.connection.id,

          owner_user_id:
            String(req.telegramUser.id),

          username
        }
      );

      res.json({
        ok: true
      });
    } catch (error) {
      console.error(
        "delete watch:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to delete watch"
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
  "/api/connections/:connectionId/events",
  authenticateMiniApp,
  requireConnection,
  async (req, res) => {
    try {
      const limit =
        Math.min(
          Math.max(
            Number(req.query.limit) || 100,
            1
          ),
          300
        );

      const result =
        await run(
          `
          SELECT *
          FROM events
          WHERE
            connection_id =
              :connection_id
            AND owner_user_id =
              :owner_user_id
          ORDER BY id DESC
          LIMIT :limit
          `,
          {
            connection_id:
              req.connection.id,

            owner_user_id:
              String(req.telegramUser.id),

            limit
          }
        );

      res.json({
        ok: true,

        events:
          result.rows.map(
            row => ({
              id:
                Number(row.id),

              type:
                row.type,

              connection_id:
                row.connection_id,

              chat_id:
                row.chat_id,

              message_id:
                row.message_id,

              user_id:
                row.user_id,

              username:
                row.username,

              created_at:
                row.created_at,

              payload:
                parseJson(
                  row.payload_json,
                  {}
                )
            })
          )
      });
    } catch (error) {
      console.error(
        "events:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to load events"
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
  "/api/connections/:connectionId/stats",
  authenticateMiniApp,
  requireConnection,
  async (req, res) => {
    try {
      const ownerId =
        String(req.telegramUser.id);

      const connectionId =
        req.connection.id;

      const [
        received,
        sent,
        deleted,
        events,
        watches,
        commands,
        errors
      ] =
        await Promise.all([
          run(
            `
            SELECT COUNT(*) AS count
            FROM messages
            WHERE
              business_connection_id =
                :connection_id
              AND owner_user_id =
                :owner_id
              AND direction = 'received'
            `,
            {
              connection_id:
                connectionId,

              owner_id:
                ownerId
            }
          ),

          run(
            `
            SELECT COUNT(*) AS count
            FROM messages
            WHERE
              business_connection_id =
                :connection_id
              AND owner_user_id =
                :owner_id
              AND direction = 'sent'
            `,
            {
              connection_id:
                connectionId,

              owner_id:
                ownerId
            }
          ),

          run(
            `
            SELECT COUNT(*) AS count
            FROM messages
            WHERE
              business_connection_id =
                :connection_id
              AND owner_user_id =
                :owner_id
              AND deleted = 1
            `,
            {
              connection_id:
                connectionId,

              owner_id:
                ownerId
            }
          ),

          run(
            `
            SELECT COUNT(*) AS count
            FROM events
            WHERE
              connection_id =
                :connection_id
              AND owner_user_id =
                :owner_id
            `,
            {
              connection_id:
                connectionId,

              owner_id:
                ownerId
            }
          ),

          run(
            `
            SELECT COUNT(*) AS count
            FROM watches
            WHERE
              connection_id =
                :connection_id
              AND owner_user_id =
                :owner_id
              AND active = 1
            `,
            {
              connection_id:
                connectionId,

              owner_id:
                ownerId
            }
          ),

          run(
            `
            SELECT COUNT(*) AS count
            FROM command_history
            WHERE
              connection_id =
                :connection_id
              AND owner_user_id =
                :owner_id
            `,
            {
              connection_id:
                connectionId,

              owner_id:
                ownerId
            }
          ),

          run(
            `
            SELECT COUNT(*) AS count
            FROM events
            WHERE
              connection_id =
                :connection_id
              AND owner_user_id =
                :owner_id
              AND type = 'error'
            `,
            {
              connection_id:
                connectionId,

              owner_id:
                ownerId
            }
          )
        ]);

      res.json({
        ok: true,

        stats: {
          received:
            Number(received.rows[0]?.count || 0),

          sent:
            Number(sent.rows[0]?.count || 0),

          deleted:
            Number(deleted.rows[0]?.count || 0),

          events:
            Number(events.rows[0]?.count || 0),

          watches:
            Number(watches.rows[0]?.count || 0),

          commands:
            Number(commands.rows[0]?.count || 0),

          errors:
            Number(errors.rows[0]?.count || 0)
        }
      });
    } catch (error) {
      console.error(
        "stats:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Failed to load statistics"
      });
    }
  }
);

/*
==================================================
WEBHOOK
==================================================
*/

app.post(
  "/telegram/webhook",
  async (req, res) => {
    try {
      if (WEBHOOK_SECRET) {
        const receivedSecret =
          req.get(
            "X-Telegram-Bot-Api-Secret-Token"
          );

        if (
          receivedSecret !==
          WEBHOOK_SECRET
        ) {
          return res.status(403).json({
            ok: false
          });
        }
      }

      const update =
        req.body;

      res.status(200).json({
        ok: true
      });

      try {
        await processUpdate(update);
      } catch (error) {
        console.error(
          "Telegram update processing error:",
          error
        );
      }
    } catch (error) {
      console.error(
        "Webhook error:",
        error
      );

      res.status(200).json({
        ok: true
      });
    }
  }
);

/*
==================================================
SPA FALLBACK
==================================================
*/

app.get(
  "*",
  (req, res, next) => {
    if (
      req.path.startsWith("/api/") ||
      req.path === "/health" ||
      req.path.startsWith("/telegram/")
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

async function configureTelegram() {
  if (!BOT_TOKEN) {
    console.error(
      "BOT_TOKEN is missing. Telegram features are disabled."
    );

    return;
  }

  if (WEBHOOK_URL) {
    try {
      await setWebhook(
        WEBHOOK_URL,
        WEBHOOK_SECRET
      );

      console.log(
        "Telegram webhook configured:",
        WEBHOOK_URL
      );
    } catch (error) {
      console.error(
        "Failed to set Telegram webhook:",
        error.message
      );
    }
  } else {
    console.warn(
      "WEBHOOK_URL is not configured."
    );
  }

  if (WEBAPP_URL) {
    try {
      await setMenuButton(
        WEBAPP_URL
      );

      console.log(
        "Telegram STMA menu button configured."
      );
    } catch (error) {
      console.error(
        "Failed to configure menu button:",
        error.message
      );
    }
  } else {
    console.warn(
      "WEBAPP_URL is not configured."
    );
  }

  try {
    const info =
      await getWebhookInfo();

    console.log(
      "Telegram webhook info:",
      {
        url: info.url,
        pending: info.pending_update_count,
        last_error:
          info.last_error_message || null
      }
    );
  } catch (error) {
    console.error(
      "Failed to get webhook info:",
      error.message
    );
  }
}

async function start() {
  if (!BOT_TOKEN) {
    throw new Error(
      "BOT_TOKEN is required"
    );
  }

  await initDatabase();
  await initExtraTables();

  app.listen(
    PORT,
    "0.0.0.0",
    async () => {
      console.log(
        `STMA listening on 0.0.0.0:${PORT}`
      );

      await configureTelegram();
    }
  );

  setInterval(
    processScheduledDeletions,
    2000
  );
}

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "Unhandled rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "Uncaught exception:",
      error
    );
  }
);

start().catch(error => {
  console.error(
    "STMA startup failed:",
    error
  );

  process.exit(1);
});