"use strict";

const path = require("path");
const crypto = require("crypto");
const express = require("express");

const {
  initDatabase,
  upsertUser,
  getUser,
  upsertBusinessConnection,
  getConnections,
  getConnection,
  getConnectionForUser,
  run
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

const BOT_TOKEN = String(
  process.env.BOT_TOKEN || ""
).trim();

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

if (!BOT_TOKEN) {
  console.warn(
    "[STMA] WARNING: BOT_TOKEN is not configured"
  );
}

if (!WEBAPP_URL) {
  console.warn(
    "[STMA] WARNING: WEBAPP_URL / RENDER_EXTERNAL_URL is not configured"
  );
}

if (!WEBHOOK_URL) {
  console.warn(
    "[STMA] WARNING: WEBHOOK_URL / RENDER_EXTERNAL_URL is not configured"
  );
}

app.disable("x-powered-by");

app.use(
  express.json({
    limit: "2mb"
  })
);

app.use(
  express.urlencoded({
    extended: false,
    limit: "2mb"
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/*
==================================================
GENERAL HELPERS
==================================================
*/

function now() {
  return new Date().toISOString();
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

function getMessageText(message) {
  if (!message) {
    return "";
  }

  return (
    message.text ||
    message.caption ||
    ""
  );
}

function getMessageUsername(message) {
  return (
    message?.from?.username ||
    message?.sender_chat?.username ||
    ""
  );
}

function getMessageUserId(message) {
  return (
    message?.from?.id ||
    message?.sender_chat?.id ||
    null
  );
}

function isGroupChat(chat) {
  return (
    chat &&
    (
      chat.type === "group" ||
      chat.type === "supergroup"
    )
  );
}

function telegramErrorMessage(error) {
  return String(
    error?.message ||
      error ||
      "Telegram API error"
  );
}

/*
==================================================
TELEGRAM INIT DATA VALIDATION
==================================================
*/

function validateTelegramInitData(
  initData,
  maxAgeSeconds = 86400
) {
  if (
    !initData ||
    typeof initData !== "string"
  ) {
    return {
      ok: false,
      error: "Telegram initData is missing"
    };
  }

  if (!BOT_TOKEN) {
    return {
      ok: false,
      error: "BOT_TOKEN is not configured"
    };
  }

  const params = new URLSearchParams(
    initData
  );

  const receivedHash =
    params.get("hash");

  if (!receivedHash) {
    return {
      ok: false,
      error: "Telegram initData hash is missing"
    };
  }

  params.delete("hash");

  const dataCheckString =
    Array.from(params.entries())
      .sort(([a], [b]) =>
        a.localeCompare(b)
      )
      .map(
        ([key, value]) =>
          `${key}=${value}`
      )
      .join("\n");

  const secretKey = crypto
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
    return {
      ok: false,
      error: "Invalid Telegram initData signature"
    };
  }

  if (
    !crypto.timingSafeEqual(
      receivedBuffer,
      calculatedBuffer
    )
  ) {
    return {
      ok: false,
      error: "Invalid Telegram initData signature"
    };
  }

  const authDate =
    Number(params.get("auth_date"));

  if (
    !Number.isFinite(authDate)
  ) {
    return {
      ok: false,
      error: "Telegram auth_date is missing"
    };
  }

  const age =
    Math.floor(Date.now() / 1000) -
    authDate;

  if (
    age < -60 ||
    age > maxAgeSeconds
  ) {
    return {
      ok: false,
      error: "Telegram initData has expired"
    };
  }

  const userRaw =
    params.get("user");

  if (!userRaw) {
    return {
      ok: false,
      error: "Telegram user is missing"
    };
  }

  let user;

  try {
    user = JSON.parse(userRaw);
  } catch {
    return {
      ok: false,
      error: "Telegram user data is invalid"
    };
  }

  if (!user?.id) {
    return {
      ok: false,
      error: "Telegram user ID is missing"
    };
  }

  return {
    ok: true,
    user,
    authDate
  };
}

/*
==================================================
AUTH MIDDLEWARE
==================================================
*/

async function requireTelegramAuth(
  req,
  res,
  next
) {
  try {
    const initData =
      String(
        req.get("X-Telegram-Init-Data") ||
          req.body?.initData ||
          req.query?.initData ||
          ""
      ).trim();

    const validation =
      validateTelegramInitData(
        initData
      );

    if (!validation.ok) {
      return res.status(401).json({
        ok: false,
        error: validation.error
      });
    }

    const user =
      validation.user;

    await upsertUser(user);

    req.telegramUser = user;

    next();
  } catch (error) {
    console.error(
      "[AUTH ERROR]",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "Authentication failed"
    });
  }
}

/*
==================================================
CONNECTION OWNERSHIP
==================================================
*/

async function requireConnectionOwner(
  req,
  res,
  next
) {
  try {
    const connectionId =
      String(
        req.params.connectionId ||
          ""
      ).trim();

    if (!connectionId) {
      return res.status(400).json({
        ok: false,
        error: "Connection ID is required"
      });
    }

    const userId =
      String(
        req.telegramUser.id
      );

    const connection =
      await getConnectionForUser(
        connectionId,
        userId
      );

    if (!connection) {
      return res.status(404).json({
        ok: false,
        error:
          "Business Connection not found for this Telegram user"
      });
    }

    if (!connection.is_enabled) {
      return res.status(409).json({
        ok: false,
        error:
          "Business Connection is disabled"
      });
    }

    req.businessConnection =
      connection;

    next();
  } catch (error) {
    console.error(
      "[CONNECTION AUTH ERROR]",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        "Failed to verify Business Connection"
    });
  }
}

/*
==================================================
EVENTS
==================================================
*/

async function createEvent({
  type,
  connectionId = null,
  chatId = null,
  messageId = null,
  userId = null,
  username = null,
  data = {}
}) {
  try {
    await run(
      `
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        connection_id TEXT,
        chat_id TEXT,
        message_id TEXT,
        user_id TEXT,
        username TEXT,
        data_json TEXT,
        created_at TEXT NOT NULL
      )
      `
    );

    await run(
      `
      CREATE INDEX IF NOT EXISTS
      idx_events_connection_created
      ON events(connection_id, created_at)
      `
    );

    const id =
      `${Date.now()}-${crypto.randomUUID()}`;

    await run(
      `
      INSERT INTO events (
        id,
        type,
        connection_id,
        chat_id,
        message_id,
        user_id,
        username,
        data_json,
        created_at
      )
      VALUES (
        :id,
        :type,
        :connection_id,
        :chat_id,
        :message_id,
        :user_id,
        :username,
        :data_json,
        :created_at
      )
      `,
      {
        id,
        type,
        connection_id:
          connectionId != null
            ? String(connectionId)
            : null,
        chat_id:
          chatId != null
            ? String(chatId)
            : null,
        message_id:
          messageId != null
            ? String(messageId)
            : null,
        user_id:
          userId != null
            ? String(userId)
            : null,
        username:
          username || null,
        data_json:
          safeJson(data),
        created_at: now()
      }
    );
  } catch (error) {
    console.error(
      "[EVENT ERROR]",
      error
    );
  }
}

/*
==================================================
MESSAGES TABLE
==================================================
*/

async function initExtraTables() {
  await run(
    `
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      business_connection_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      from_user_id TEXT,
      username TEXT,
      first_name TEXT,
      text TEXT,
      caption TEXT,
      date INTEGER,
      direction TEXT NOT NULL,
      edited INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    `
  );

  await run(
    `
    CREATE UNIQUE INDEX IF NOT EXISTS
    idx_messages_connection_chat_message
    ON messages(
      business_connection_id,
      chat_id,
      message_id
    )
    `
  );

  await run(
    `
    CREATE INDEX IF NOT EXISTS
    idx_messages_connection_date
    ON messages(
      business_connection_id,
      date
    )
    `
  );

  await run(
    `
    CREATE TABLE IF NOT EXISTS watches (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      username TEXT NOT NULL,
      user_id TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
    `
  );

  await run(
    `
    CREATE UNIQUE INDEX IF NOT EXISTS
    idx_watches_connection_username
    ON watches(
      connection_id,
      username
    )
    `
  );

  await run(
    `
    CREATE TABLE IF NOT EXISTS command_stats (
      id TEXT PRIMARY KEY,
      connection_id TEXT,
      command_type TEXT,
      success INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
    `
  );

  await run(
    `
    CREATE TABLE IF NOT EXISTS errors (
      id TEXT PRIMARY KEY,
      connection_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL
    )
    `
  );
}

/*
==================================================
SAVE MESSAGE
==================================================
*/

async function saveMessage(
  connectionId,
  message,
  direction,
  options = {}
) {
  if (!message?.chat?.id) {
    return;
  }

  if (
    message.message_id ===
    undefined ||
    message.message_id === null
  ) {
    return;
  }

  const timestamp = now();

  const chatId =
    String(message.chat.id);

  const messageId =
    String(message.message_id);

  const id =
    `${connectionId}:${chatId}:${messageId}`;

  const fromUserId =
    getMessageUserId(message);

  const username =
    getMessageUsername(message);

  const text =
    message.text || null;

  const caption =
    message.caption || null;

  await run(
    `
    INSERT INTO messages (
      id,
      business_connection_id,
      chat_id,
      message_id,
      from_user_id,
      username,
      first_name,
      text,
      caption,
      date,
      direction,
      edited,
      deleted,
      created_at,
      updated_at
    )
    VALUES (
      :id,
      :business_connection_id,
      :chat_id,
      :message_id,
      :from_user_id,
      :username,
      :first_name,
      :text,
      :caption,
      :date,
      :direction,
      :edited,
      :deleted,
      :created_at,
      :updated_at
    )
    ON CONFLICT(id)
    DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      text = excluded.text,
      caption = excluded.caption,
      date = excluded.date,
      direction = excluded.direction,
      edited = excluded.edited,
      deleted = excluded.deleted,
      updated_at = excluded.updated_at
    `,
    {
      id,

      business_connection_id:
        String(connectionId),

      chat_id:
        chatId,

      message_id:
        messageId,

      from_user_id:
        fromUserId != null
          ? String(fromUserId)
          : null,

      username:
        username || null,

      first_name:
        message?.from?.first_name ||
        null,

      text,

      caption,

      date:
        Number(message.date) || null,

      direction,

      edited:
        options.edited ? 1 : 0,

      deleted:
        options.deleted ? 1 : 0,

      created_at:
        timestamp,

      updated_at:
        timestamp
    }
  );
}

/*
==================================================
WATCH MATCH
==================================================
*/

async function processWatchMatches(
  connectionId,
  message
) {
  const username =
    normalizeUsername(
      getMessageUsername(message)
    );

  if (!username) {
    return;
  }

  const result =
    await run(
      `
      SELECT *
      FROM watches
      WHERE connection_id = :connection_id
        AND username = :username
        AND active = 1
      `,
      {
        connection_id:
          String(connectionId),

        username
      }
    );

  for (
    const watch of result.rows
  ) {
    await createEvent({
      type: "watch_match",

      connectionId,

      chatId:
        message?.chat?.id,

      messageId:
        message?.message_id,

      userId:
        getMessageUserId(message),

      username,

      data: {
        watch,
        message
      }
    });
  }
}

/*
==================================================
BUSINESS CONNECTION UPDATE
==================================================
*/

async function handleBusinessConnection(
  update
) {
  const connection =
    update.business_connection;

  if (!connection?.id) {
    console.warn(
      "[Telegram] business_connection without ID"
    );

    return;
  }

  console.log(
    "[Telegram] business_connection received"
  );

  console.log(
    "[Telegram] Connection ID:",
    connection.id
  );

  const owner =
    connection.user;

  if (!owner?.id) {
    console.error(
      "[Telegram] Business connection owner is missing"
    );

    return;
  }

  console.log(
    "[Telegram] Owner ID:",
    owner.id
  );

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

  await createEvent({
    type:
      connection.is_enabled
        ? "business_connected"
        : "business_disconnected",

    connectionId:
      connection.id,

    userId:
      owner.id,

    username:
      owner.username,

    data:
      connection
  });

  console.log(
    "[STMA] Business Connection saved:",
    connection.id,
    "enabled:",
    connection.is_enabled
  );
}

/*
==================================================
BUSINESS MESSAGE
==================================================
*/

async function handleBusinessMessage(
  update,
  edited = false
) {
  const message =
    edited
      ? update.edited_business_message
      : update.business_message;

  if (!message) {
    return;
  }

  const connectionId =
    message.business_connection_id;

  if (!connectionId) {
    console.error(
      "[Telegram] Business message without business_connection_id"
    );

    return;
  }

  console.log(
    `[Telegram] ${
      edited
        ? "edited_business_message"
        : "business_message"
    } received`,
    connectionId,
    message.message_id
  );

  /*
  Если connection отсутствует в базе,
  пытаемся получить актуальные данные
  напрямую из Telegram.
  */

  let connection =
    await getConnection(
      connectionId
    );

  if (!connection) {
    try {
      const telegramConnection =
        await getBusinessConnection(
          connectionId
        );

      if (
        telegramConnection?.user?.id
      ) {
        await upsertUser(
          telegramConnection.user
        );

        await upsertBusinessConnection({
          id:
            telegramConnection.id,

          userId:
            telegramConnection.user.id,

          userChatId:
            telegramConnection.user.id,

          username:
            telegramConnection.user.username,

          firstName:
            telegramConnection.user.first_name,

          lastName:
            telegramConnection.user.last_name,

          date:
            telegramConnection.date,

          rights:
            telegramConnection.rights ||
            {},

          isEnabled:
            Boolean(
              telegramConnection.is_enabled
            )
        });

        connection =
          await getConnection(
            connectionId
          );
      }
    } catch (error) {
      console.error(
        "[Telegram] Failed to restore Business Connection:",
        telegramErrorMessage(error)
      );
    }
  }

  if (!connection) {
    console.error(
      "[Telegram] Business Connection still not found:",
      connectionId
    );

    return;
  }

  await saveMessage(
    connectionId,
    message,
    "received",
    {
      edited
    }
  );

  await createEvent({
    type:
      edited
        ? "message_edited"
        : "message_received",

    connectionId,

    chatId:
      message?.chat?.id,

    messageId:
      message?.message_id,

    userId:
      getMessageUserId(message),

    username:
      getMessageUsername(message),

    data:
      message
  });

  await processWatchMatches(
    connectionId,
    message
  );
}

/*
==================================================
DELETED BUSINESS MESSAGES
==================================================
*/

async function handleDeletedBusinessMessages(
  update
) {
  const deleted =
    update.deleted_business_messages;

  if (!deleted) {
    return;
  }

  const connectionId =
    deleted.business_connection_id;

  if (!connectionId) {
    console.error(
      "[Telegram] Deleted business messages without connection ID"
    );

    return;
  }

  const chatId =
    deleted.chat?.id;

  const messageIds =
    Array.isArray(
      deleted.message_ids
    )
      ? deleted.message_ids
      : [];

  for (
    const messageId of messageIds
  ) {
    await run(
      `
      UPDATE messages
      SET
        deleted = 1,
        updated_at = :updated_at
      WHERE business_connection_id =
        :connection_id
        AND chat_id = :chat_id
        AND message_id = :message_id
      `,
      {
        updated_at:
          now(),

        connection_id:
          String(connectionId),

        chat_id:
          String(chatId),

        message_id:
          String(messageId)
      }
    );

    await createEvent({
      type:
        "message_deleted",

      connectionId,

      chatId,

      messageId,

      data:
        deleted
    });
  }
}

/*
==================================================
GENERIC MESSAGE / START
==================================================
*/

async function handleNormalMessage(
  update
) {
  const message =
    update.message;

  if (!message) {
    return;
  }

  const text =
    String(
      message.text || ""
    ).trim();

  if (
    text === "/start" ||
    text.startsWith("/start ")
  ) {
    try {
      await answerStart(
        message.chat.id,
        WEBAPP_URL
      );
    } catch (error) {
      console.error(
        "[Telegram] /start error:",
        telegramErrorMessage(error)
      );
    }
  }
}

/*
==================================================
WEBHOOK
==================================================
*/

app.post(
  "/telegram/webhook",
  async (req, res) => {
    try {
      if (
        WEBHOOK_SECRET
      ) {
        const receivedSecret =
          String(
            req.get(
              "X-Telegram-Bot-Api-Secret-Token"
            ) || ""
          );

        if (
          receivedSecret !==
          WEBHOOK_SECRET
        ) {
          console.warn(
            "[Webhook] Invalid secret token"
          );

          return res.status(403).json({
            ok: false,
            error: "Forbidden"
          });
        }
      }

      const update =
        req.body || {};

      console.log(
        "[Webhook] Update received:",
        update.update_id
      );

      if (
        update.business_connection
      ) {
        await handleBusinessConnection(
          update
        );
      }

      if (
        update.business_message
      ) {
        await handleBusinessMessage(
          update,
          false
        );
      }

      if (
        update.edited_business_message
      ) {
        await handleBusinessMessage(
          update,
          true
        );
      }

      if (
        update.deleted_business_messages
      ) {
        await handleDeletedBusinessMessages(
          update
        );
      }

      if (
        update.message
      ) {
        await handleNormalMessage(
          update
        );
      }

      return res.json({
        ok: true
      });
    } catch (error) {
      console.error(
        "[Webhook ERROR]",
        error
      );

      /*
      Telegram должен получить HTTP 200,
      чтобы один плохой update не создавал
      бесконечные повторные доставки.
      */

      return res.json({
        ok: false
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
      service: "STMA"
    });
  }
);

/*
==================================================
WEBHOOK INFO
==================================================
*/

app.get(
  "/telegram/webhook-info",
  async (req, res) => {
    try {
      const info =
        await getWebhookInfo();

      return res.json({
        ok: true,
        webhook: info
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error:
          telegramErrorMessage(error)
      });
    }
  }
);

/*
==================================================
ME
==================================================
*/

app.get(
  "/api/me",
  requireTelegramAuth,
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

/*
==================================================
CONNECTIONS
==================================================
*/

app.get(
  "/api/connections",
  requireTelegramAuth,
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
  requireTelegramAuth,
  requireConnectionOwner,
  async (req, res) => {
    res.json({
      ok: true,
      connection:
        req.businessConnection
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
  requireTelegramAuth,
  requireConnectionOwner,
  async (req, res) => {
    try {
      const chatId =
        req.query.chat_id
          ? String(req.query.chat_id)
          : null;

      const limit =
        Math.min(
          Math.max(
            Number(req.query.limit) || 100,
            1
          ),
          500
        );

      const params = {
        connection_id:
          String(
            req.params.connectionId
          ),
        limit
      };

      let sql = `
        SELECT *
        FROM messages
        WHERE business_connection_id =
          :connection_id
      `;

      if (chatId) {
        sql += `
          AND chat_id = :chat_id
        `;

        params.chat_id =
          chatId;
      }

      sql += `
        ORDER BY
          COALESCE(date, 0) DESC,
          updated_at DESC
        LIMIT :limit
      `;

      const result =
        await run(
          sql,
          params
        );

      res.json({
        ok: true,
        messages:
          result.rows
      });
    } catch (error) {
      console.error(
        "[Messages GET ERROR]",
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
  requireTelegramAuth,
  requireConnectionOwner,
  async (req, res) => {
    const connection =
      req.businessConnection;

    const chatId =
      req.body?.chatId;

    const text =
      String(
        req.body?.text || ""
      ).trim();

    const deleteAfter =
      Math.max(
        Number(
          req.body?.deleteAfter || 0
        ),
        0
      );

    if (
      chatId === undefined ||
      chatId === null ||
      String(chatId).trim() === ""
    ) {
      return res.status(400).json({
        ok: false,
        error: "Chat ID is required"
      });
    }

    if (!text) {
      return res.status(400).json({
        ok: false,
        error: "Message text is required"
      });
    }

    try {
      const message =
        await sendBusinessMessage(
          connection.id,
          chatId,
          text
        );

      await saveMessage(
        connection.id,
        message,
        "sent"
      );

      await createEvent({
        type:
          "message_sent",

        connectionId:
          connection.id,

        chatId:
          message.chat?.id,

        messageId:
          message.message_id,

        userId:
          req.telegramUser.id,

        data:
          message
      });

      if (
        deleteAfter > 0
      ) {
        const timer =
          setTimeout(
            async () => {
              try {
                await deleteBusinessMessage(
                  connection.id,
                  message.chat.id,
                  message.message_id
                );

                await run(
                  `
                  UPDATE messages
                  SET
                    deleted = 1,
                    updated_at = :updated_at
                  WHERE business_connection_id =
                    :connection_id
                    AND chat_id = :chat_id
                    AND message_id = :message_id
                  `,
                  {
                    updated_at:
                      now(),

                    connection_id:
                      String(
                        connection.id
                      ),

                    chat_id:
                      String(
                        message.chat.id
                      ),

                    message_id:
                      String(
                        message.message_id
                      )
                  }
                );

                await createEvent({
                  type:
                    "message_deleted",

                  connectionId:
                    connection.id,

                  chatId:
                    message.chat.id,

                  messageId:
                    message.message_id,

                  data: {
                    reason:
                      "timer"
                  }
                });
              } catch (error) {
                console.error(
                  "[Delete Timer ERROR]",
                  telegramErrorMessage(
                    error
                  )
                );

                await run(
                  `
                  INSERT INTO errors (
                    id,
                    connection_id,
                    error,
                    created_at
                  )
                  VALUES (
                    :id,
                    :connection_id,
                    :error,
                    :created_at
                  )
                  `,
                  {
                    id:
                      crypto.randomUUID(),

                    connection_id:
                      String(
                        connection.id
                      ),

                    error:
                      telegramErrorMessage(
                        error
                      ),

                    created_at:
                      now()
                  }
                );
              }
            },
            deleteAfter * 1000
          );

        if (
          typeof timer.unref ===
          "function"
        ) {
          timer.unref();
        }
      }

      res.json({
        ok: true,
        message
      });
    } catch (error) {
      console.error(
        "[Send Message ERROR]",
        error
      );

      await run(
        `
        INSERT INTO errors (
          id,
          connection_id,
          error,
          created_at
        )
        VALUES (
          :id,
          :connection_id,
          :error,
          :created_at
        )
        `,
        {
          id:
            crypto.randomUUID(),

          connection_id:
            String(
              connection.id
            ),

          error:
            telegramErrorMessage(
              error
            ),

          created_at:
            now()
        }
      ).catch(() => {});

      res.status(502).json({
        ok: false,
        error:
          telegramErrorMessage(
            error
          )
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
  requireTelegramAuth,
  requireConnectionOwner,
  async (req, res) => {
    const connection =
      req.businessConnection;

    try {
      const result =
        await deleteBusinessMessage(
          connection.id,
          req.params.chatId,
          req.params.messageId
        );

      await run(
        `
        UPDATE messages
        SET
          deleted = 1,
          updated_at = :updated_at
        WHERE business_connection_id =
          :connection_id
          AND chat_id = :chat_id
          AND message_id = :message_id
        `,
        {
          updated_at:
            now(),

          connection_id:
            String(
              connection.id
            ),

          chat_id:
            String(
              req.params.chatId
            ),

          message_id:
            String(
              req.params.messageId
            )
        }
      );

      await createEvent({
        type:
          "message_deleted",

        connectionId:
          connection.id,

        chatId:
          req.params.chatId,

        messageId:
          req.params.messageId,

        userId:
          req.telegramUser.id,

        data: {
          source:
            "manual"
        }
      });

      res.json({
        ok: true,
        result
      });
    } catch (error) {
      console.error(
        "[Delete Message ERROR]",
        error
      );

      res.status(502).json({
        ok: false,
        error:
          telegramErrorMessage(
            error
          )
      });
    }
  }
);

/*
==================================================
COMMAND PARSER
==================================================
*/

function parseCommand(text) {
  const value =
    String(text || "")
      .trim()
      .replace(/\s+/g, " ");

  let match =
    value.match(
      /^замуть\s+(\d+)\s+(?:на\s+)?(\d+(?:[.,]\d+)?)\s*(сек|секунд[а-я]*|мин|минут[а-я]*|ч|час(?:а|ов)?|д|дн(?:я|ей)?|s|m|h|d)$/i
    );

  if (match) {
    const userId =
      Number(match[1]);

    const amount =
      Number(
        String(
          match[2]
        ).replace(",", ".")
      );

    const unit =
      String(
        match[3]
      ).toLowerCase();

    let multiplier;

    if (
      unit === "сек" ||
      unit.startsWith("сек") ||
      unit === "s"
    ) {
      multiplier = 1;
    } else if (
      unit === "мин" ||
      unit.startsWith("мин") ||
      unit === "m"
    ) {
      multiplier = 60;
    } else if (
      unit === "ч" ||
      unit.startsWith("час") ||
      unit === "h"
    ) {
      multiplier = 3600;
    } else {
      multiplier = 86400;
    }

    return {
      type:
        "mute",

      userId,

      duration:
        Math.round(
          amount * multiplier
        )
    };
  }

  match =
    value.match(
      /^размути\s+(\d+)$/i
    );

  if (match) {
    return {
      type:
        "unmute",

      userId:
        Number(match[1])
    };
  }

  match =
    value.match(
      /^следи\s+за\s+@?([a-zA-Z0-9_]{5,32})$/i
    );

  if (match) {
    return {
      type:
        "watch",

      username:
        match[1].toLowerCase()
    };
  }

  return {
    type:
      "unknown"
  };
}

/*
==================================================
COMMAND
==================================================
*/

app.post(
  "/api/connections/:connectionId/command",
  requireTelegramAuth,
  requireConnectionOwner,
  async (req, res) => {
    const connection =
      req.businessConnection;

    const command =
      String(
        req.body?.command || ""
      ).trim();

    if (!command) {
      return res.status(400).json({
        ok: false,
        error:
          "Command is required"
      });
    }

    const parsed =
      parseCommand(command);

    const commandId =
      crypto.randomUUID();

    try {
      if (
        parsed.type ===
        "unknown"
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Команда не распознана",
          parsed
        });
      }

      if (
        parsed.type ===
        "watch"
      ) {
        const username =
          normalizeUsername(
            parsed.username
          );

        await run(
          `
          INSERT INTO watches (
            id,
            connection_id,
            username,
            user_id,
            active,
            created_at
          )
          VALUES (
            :id,
            :connection_id,
            :username,
            NULL,
            1,
            :created_at
          )
          ON CONFLICT(
            connection_id,
            username
          )
          DO UPDATE SET
            active = 1
          `,
          {
            id:
              commandId,

            connection_id:
              String(
                connection.id
              ),

            username,

            created_at:
              now()
          }
        );

        await createEvent({
          type:
            "watch",

          connectionId:
            connection.id,

          userId:
            req.telegramUser.id,

          username,

          data:
            parsed
        });

        await run(
          `
          INSERT INTO command_stats (
            id,
            connection_id,
            command_type,
            success,
            created_at
          )
          VALUES (
            :id,
            :connection_id,
            :command_type,
            1,
            :created_at
          )
          `,
          {
            id:
              commandId,

            connection_id:
              String(
                connection.id
              ),

            command_type:
              "watch",

            created_at:
              now()
          }
        );

        return res.json({
          ok: true,
          parsed,
          result: {
            username,
            active: true
          }
        });
      }

      if (
        parsed.type ===
        "mute"
      ) {
        const chatId =
          req.body?.chatId;

        if (
          chatId === undefined ||
          chatId === null ||
          String(chatId).trim() === ""
        ) {
          return res.status(400).json({
            ok: false,
            error:
              "Chat ID is required for mute"
          });
        }

        const result =
          await muteUser(
            connection.id,
            chatId,
            parsed.userId,
            parsed.duration
          );

        await createEvent({
          type:
            "mute",

          connectionId:
            connection.id,

          chatId,

          userId:
            parsed.userId,

          data: {
            duration:
              parsed.duration,

            telegram:
              result
          }
        });

        await run(
          `
          INSERT INTO command_stats (
            id,
            connection_id,
            command_type,
            success,
            created_at
          )
          VALUES (
            :id,
            :connection_id,
            :command_type,
            1,
            :created_at
          )
          `,
          {
            id:
              commandId,

            connection_id:
              String(
                connection.id
              ),

            command_type:
              "mute",

            created_at:
              now()
          }
        );

        return res.json({
          ok: true,
          parsed,
          result
        });
      }

      if (
        parsed.type ===
        "unmute"
      ) {
        const chatId =
          req.body?.chatId;

        if (
          chatId === undefined ||
          chatId === null ||
          String(chatId).trim() === ""
        ) {
          return res.status(400).json({
            ok: false,
            error:
              "Chat ID is required for unmute"
          });
        }

        const result =
          await unmuteUser(
            connection.id,
            chatId,
            parsed.userId
          );

        await createEvent({
          type:
            "unmute",

          connectionId:
            connection.id,

          chatId,

          userId:
            parsed.userId,

          data:
            result
        });

        await run(
          `
          INSERT INTO command_stats (
            id,
            connection_id,
            command_type,
            success,
            created_at
          )
          VALUES (
            :id,
            :connection_id,
            :command_type,
            1,
            :created_at
          )
          `,
          {
            id:
              commandId,

            connection_id:
              String(
                connection.id
              ),

            command_type:
              "unmute",

            created_at:
              now()
          }
        );

        return res.json({
          ok: true,
          parsed,
          result
        });
      }

      return res.status(400).json({
        ok: false,
        error:
          "Unsupported command"
      });
    } catch (error) {
      console.error(
        "[Command ERROR]",
        error
      );

      await run(
        `
        INSERT INTO command_stats (
          id,
          connection_id,
          command_type,
          success,
          created_at
        )
        VALUES (
          :id,
          :connection_id,
          :command_type,
          0,
          :created_at
        )
        `,
        {
          id:
            commandId,

          connection_id:
            String(
              connection.id
            ),

          command_type:
            parsed.type,

          created_at:
            now()
        }
      ).catch(() => {});

      await run(
        `
        INSERT INTO errors (
          id,
          connection_id,
          error,
          created_at
        )
        VALUES (
          :id,
          :connection_id,
          :error,
          :created_at
        )
        `,
        {
          id:
            crypto.randomUUID(),

          connection_id:
            String(
              connection.id
            ),

          error:
            telegramErrorMessage(
              error
            ),

          created_at:
            now()
        }
      ).catch(() => {});

      res.status(502).json({
        ok: false,
        error:
          telegramErrorMessage(
            error
          ),
        parsed
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
  requireTelegramAuth,
  requireConnectionOwner,
  async (req, res) => {
    const result =
      await run(
        `
        SELECT *
        FROM watches
        WHERE connection_id =
          :connection_id
          AND active = 1
        ORDER BY created_at DESC
        `,
        {
          connection_id:
            String(
              req.params.connectionId
            )
        }
      );

    res.json({
      ok: true,
      watches:
        result.rows
    });
  }
);

app.post(
  "/api/connections/:connectionId/watches",
  requireTelegramAuth,
  requireConnectionOwner,
  async (req, res) => {
    const username =
      normalizeUsername(
        req.body?.username
      );

    if (!username) {
      return res.status(400).json({
        ok: false,
        error:
          "Username is required"
      });
    }

    const id =
      crypto.randomUUID();

    await run(
      `
      INSERT INTO watches (
        id,
        connection_id,
        username,
        user_id,
        active,
        created_at
      )
      VALUES (
        :id,
        :connection_id,
        :username,
        NULL,
        1,
        :created_at
      )
      ON CONFLICT(
        connection_id,
        username
      )
      DO UPDATE SET
        active = 1
      `,
      {
        id,

        connection_id:
          String(
            req.params.connectionId
          ),

        username,

        created_at:
          now()
      }
    );

    await createEvent({
      type:
        "watch",

      connectionId:
        req.params.connectionId,

      userId:
        req.telegramUser.id,

      username
    });

    res.json({
      ok: true,
      username
    });
  }
);

app.delete(
  "/api/connections/:connectionId/watches/:username",
  requireTelegramAuth,
  requireConnectionOwner,
  async (req, res) => {
    const username =
      normalizeUsername(
        req.params.username
      );

    await run(
      `
      UPDATE watches
      SET active = 0
      WHERE connection_id =
        :connection_id
        AND username =
        :username
      `,
      {
        connection_id:
          String(
            req.params.connectionId
          ),

        username
      }
    );

    res.json({
      ok: true
    });
  }
);

/*
==================================================
EVENTS
==================================================
*/

app.get(
  "/api/connections/:connectionId/events",
  requireTelegramAuth,
  requireConnectionOwner,
  async (req, res) => {
    const limit =
      Math.min(
        Math.max(
          Number(
            req.query.limit || 100
          ),
          1
        ),
        500
      );

    const result =
      await run(
        `
        SELECT *
        FROM events
        WHERE connection_id =
          :connection_id
        ORDER BY created_at DESC
        LIMIT :limit
        `,
        {
          connection_id:
            String(
              req.params.connectionId
            ),

          limit
        }
      );

    res.json({
      ok: true,
      events:
        result.rows.map(
          (event) => ({
            ...event,
            data:
              parseJson(
                event.data_json,
                {}
              )
          })
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
  "/api/connections/:connectionId/stats",
  requireTelegramAuth,
  requireConnectionOwner,
  async (req, res) => {
    const connectionId =
      String(
        req.params.connectionId
      );

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
          WHERE business_connection_id =
            :connection_id
            AND direction = 'received'
          `,
          {
            connection_id:
              connectionId
          }
        ),

        run(
          `
          SELECT COUNT(*) AS count
          FROM messages
          WHERE business_connection_id =
            :connection_id
            AND direction = 'sent'
          `,
          {
            connection_id:
              connectionId
          }
        ),

        run(
          `
          SELECT COUNT(*) AS count
          FROM messages
          WHERE business_connection_id =
            :connection_id
            AND deleted = 1
          `,
          {
            connection_id:
              connectionId
          }
        ),

        run(
          `
          SELECT COUNT(*) AS count
          FROM events
          WHERE connection_id =
            :connection_id
          `,
          {
            connection_id:
              connectionId
          }
        ),

        run(
          `
          SELECT COUNT(*) AS count
          FROM watches
          WHERE connection_id =
            :connection_id
            AND active = 1
          `,
          {
            connection_id:
              connectionId
          }
        ),

        run(
          `
          SELECT COUNT(*) AS count
          FROM command_stats
          WHERE connection_id =
            :connection_id
            AND success = 1
          `,
          {
            connection_id:
              connectionId
          }
        ),

        run(
          `
          SELECT COUNT(*) AS count
          FROM errors
          WHERE connection_id =
            :connection_id
          `,
          {
            connection_id:
              connectionId
          }
        )
      ]);

    res.json({
      ok: true,
      stats: {
        received_messages:
          Number(
            received.rows[0]?.count || 0
          ),

        sent_messages:
          Number(
            sent.rows[0]?.count || 0
          ),

        deleted_messages:
          Number(
            deleted.rows[0]?.count || 0
          ),

        events:
          Number(
            events.rows[0]?.count || 0
          ),

        active_watches:
          Number(
            watches.rows[0]?.count || 0
          ),

        commands:
          Number(
            commands.rows[0]?.count || 0
          ),

        errors:
          Number(
            errors.rows[0]?.count || 0
          ),

        business_connections:
          1
      }
    });
  }
);

/*
==================================================
WEB APP FALLBACK
==================================================

Express 5:
НЕ использовать app.get("*").

Используем корректный wildcard:
"/{*splat}".
==================================================
*/

app.get(
  "/{*splat}",
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
ERROR HANDLER
==================================================
*/

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "[Express ERROR]",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    res.status(500).json({
      ok: false,
      error:
        "Internal server error"
    });
  }
);

/*
==================================================
STARTUP
==================================================
*/

async function configureTelegram() {
  if (!BOT_TOKEN) {
    console.warn(
      "[STMA] BOT_TOKEN missing. Telegram features disabled."
    );

    return;
  }

  if (WEBHOOK_URL) {
    try {
      await setWebhook(
        WEBHOOK_URL,
        WEBHOOK_SECRET || undefined
      );

      console.log(
        "[STMA] Webhook configured:",
        WEBHOOK_URL
      );
    } catch (error) {
      console.error(
        "[STMA] Failed to configure webhook:",
        telegramErrorMessage(error)
      );
    }
  }

  if (WEBAPP_URL) {
    try {
      await setMenuButton(
        WEBAPP_URL
      );

      console.log(
        "[STMA] Telegram menu button configured:",
        WEBAPP_URL
      );
    } catch (error) {
      console.error(
        "[STMA] Failed to configure menu button:",
        telegramErrorMessage(error)
      );
    }
  }

  try {
    const info =
      await getWebhookInfo();

    console.log(
      "[STMA] Telegram webhook info:",
      JSON.stringify(
        info
      )
    );
  } catch (error) {
    console.error(
      "[STMA] Failed to get webhook info:",
      telegramErrorMessage(error)
    );
  }
}

async function start() {
  try {
    await initDatabase();

    await initExtraTables();

    app.listen(
      PORT,
      "0.0.0.0",
      async () => {
        console.log(
          "========================================"
        );

        console.log(
          "STMA started"
        );

        console.log(
          "PORT:",
          PORT
        );

        console.log(
          "WEBAPP_URL:",
          WEBAPP_URL || "not configured"
        );

        console.log(
          "WEBHOOK_URL:",
          WEBHOOK_URL || "not configured"
        );

        console.log(
          "========================================"
        );

        await configureTelegram();
      }
    );
  } catch (error) {
    console.error(
      "[STMA FATAL STARTUP ERROR]",
      error
    );

    process.exit(1);
  }
}

process.on(
  "unhandledRejection",
  (error) => {
    console.error(
      "[STMA] Unhandled rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "[STMA] Uncaught exception:",
      error
    );
  }
);

start();