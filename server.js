const express = require("express");
const path = require("path");
const crypto = require("crypto");

const {
  initDatabase,
  getUser,
  upsertUser,
  getConnections,
  getConnection,
  upsertBusinessConnection,
  saveIncomingMessage,
  saveSentMessage,
  getMessages,
  getMessage,
  markMessageDeleted,
  saveEditedMessage,
  addWatch,
  getWatches,
  removeWatch,
  getTrackedUsernames,
  findRecentChatByUsername,
  addEvent,
  getEvents,
  saveCommand,
  getStats
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

const BOT_TOKEN =
  String(process.env.BOT_TOKEN || "").trim();

const WEBAPP_URL = (
  process.env.WEBAPP_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  ""
).replace(/\/$/, "");

const WEBHOOK_URL = (
  process.env.WEBHOOK_URL ||
  (
    process.env.RENDER_EXTERNAL_URL
      ? `${process.env.RENDER_EXTERNAL_URL}/telegram/webhook`
      : ""
  )
).replace(/\/$/, "");

const WEBHOOK_SECRET =
  String(process.env.WEBHOOK_SECRET || "").trim();

const INIT_DATA_MAX_AGE =
  Number(process.env.INIT_DATA_MAX_AGE || 86400);

const OPENAI_API_KEY =
  String(process.env.OPENAI_API_KEY || "").trim();

const OPENAI_MODEL =
  String(
    process.env.OPENAI_MODEL || "gpt-5-mini"
  ).trim();

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

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

function now() {
  return new Date().toISOString();
}

/*
==================================================
TELEGRAM INIT DATA
==================================================
*/

function validateTelegramInitData(initData) {
  if (
    !initData ||
    typeof initData !== "string"
  ) {
    throw new Error(
      "Telegram initData отсутствует"
    );
  }

  if (!BOT_TOKEN) {
    throw new Error(
      "BOT_TOKEN не настроен"
    );
  }

  const params =
    new URLSearchParams(initData);

  const receivedHash =
    params.get("hash");

  if (
    !receivedHash ||
    !/^[a-f0-9]{64}$/i.test(receivedHash)
  ) {
    throw new Error(
      "Некорректная подпись Telegram"
    );
  }

  params.delete("hash");

  const dataCheckString =
    [...params.entries()]
      .sort(
        ([a], [b]) =>
          a.localeCompare(b)
      )
      .map(
        ([key, value]) =>
          `${key}=${value}`
      )
      .join("\n");

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

  const calculated =
    Buffer.from(
      calculatedHash,
      "hex"
    );

  const received =
    Buffer.from(
      receivedHash,
      "hex"
    );

  if (
    calculated.length !==
      received.length ||
    !crypto.timingSafeEqual(
      calculated,
      received
    )
  ) {
    throw new Error(
      "Недействительная подпись Telegram"
    );
  }

  const authDate =
    Number(
      params.get("auth_date")
    );

  if (
    !Number.isFinite(authDate) ||
    authDate <= 0
  ) {
    throw new Error(
      "Некорректный auth_date"
    );
  }

  const age =
    Math.floor(
      Date.now() / 1000
    ) - authDate;

  if (
    age < -60 ||
    age > INIT_DATA_MAX_AGE
  ) {
    throw new Error(
      "Telegram initData устарел"
    );
  }

  const rawUser =
    params.get("user");

  if (!rawUser) {
    throw new Error(
      "Telegram user отсутствует"
    );
  }

  let user;

  try {
    user =
      JSON.parse(rawUser);
  } catch {
    throw new Error(
      "Некорректный Telegram user"
    );
  }

  if (
    !user ||
    !user.id
  ) {
    throw new Error(
      "Telegram user ID отсутствует"
    );
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

async function authMiddleware(
  req,
  res,
  next
) {
  try {
    const initData =
      req.headers[
        "x-telegram-init-data"
      ];

    if (!initData) {
      return res.status(401).json({
        ok: false,
        error:
          "Telegram initData required"
      });
    }

    const auth =
      validateTelegramInitData(
        initData
      );

    await upsertUser(
      auth.user
    );

    req.telegramUser =
      auth.user;

    req.telegramAuthDate =
      auth.authDate;

    next();
  } catch (error) {
    console.error(
      "AUTH ERROR:",
      error.message
    );

    return res.status(401).json({
      ok: false,
      error:
        "Telegram authentication failed"
    });
  }
}

/*
==================================================
CONNECTION OWNERSHIP
==================================================
*/

async function getOwnedConnection(
  req,
  connectionId
) {
  if (!connectionId) {
    throw new Error(
      "Business Connection ID отсутствует"
    );
  }

  const connection =
    await getConnection(
      connectionId
    );

  if (!connection) {
    throw new Error(
      "Business Connection не найден"
    );
  }

  if (
    String(connection.user_id) !==
    String(req.telegramUser.id)
  ) {
    throw new Error(
      "Доступ запрещён"
    );
  }

  return connection;
}

/*
==================================================
BUSINESS CONNECTION RECOVERY
==================================================

Если Telegram прислал сообщение,
но connection отсутствует в Turso,
получаем его непосредственно
через Telegram Bot API.
*/

async function ensureBusinessConnection(
  connectionId
) {
  if (!connectionId) {
    return null;
  }

  let connection =
    await getConnection(
      connectionId
    );

  if (
    connection &&
    connection.is_enabled
  ) {
    return connection;
  }

  try {
    const telegramConnection =
      await telegramRequest(
        "getBusinessConnection",
        {
          business_connection_id:
            String(connectionId)
        }
      );

    if (
      !telegramConnection ||
      !telegramConnection.id ||
      !telegramConnection.user?.id
    ) {
      return null;
    }

    await upsertUser({
      id:
        telegramConnection.user.id,

      username:
        telegramConnection.user.username ||
        null,

      first_name:
        telegramConnection.user.first_name ||
        null,

      last_name:
        telegramConnection.user.last_name ||
        null
    });

    await upsertBusinessConnection({
      id:
        telegramConnection.id,

      userId:
        telegramConnection.user.id,

      username:
        telegramConnection.user.username ||
        null,

      firstName:
        telegramConnection.user.first_name ||
        null,

      lastName:
        telegramConnection.user.last_name ||
        null,

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

    return connection;
  } catch (error) {
    console.error(
      "BUSINESS CONNECTION RECOVERY ERROR:",
      error.message
    );

    return connection || null;
  }
}

/*
==================================================
HELPERS
==================================================
*/

function normalizeUsername(
  username
) {
  return String(
    username || ""
  )
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

function messageLink(
  chatId,
  messageId
) {
  const id =
    String(chatId || "");

  if (
    id.startsWith("-100")
  ) {
    return (
      `https://t.me/c/` +
      `${id.slice(4)}/` +
      `${messageId}`
    );
  }

  return null;
}

function formatDurationSeconds(
  seconds
) {
  const value =
    Number(seconds);

  if (!Number.isFinite(value)) {
    return null;
  }

  if (
    value % 86400 === 0
  ) {
    return {
      value:
        value / 86400,
      unit: "days"
    };
  }

  if (
    value % 3600 === 0
  ) {
    return {
      value:
        value / 3600,
      unit: "hours"
    };
  }

  if (
    value % 60 === 0
  ) {
    return {
      value:
        value / 60,
      unit: "minutes"
    };
  }

  return {
    value,
    unit: "seconds"
  };
}

/*
==================================================
LOCAL COMMAND PARSER
==================================================
*/

function parseDuration(
  text
) {
  const match =
    String(text || "").match(
      /(\d+(?:[.,]\d+)?)\s*(секунд?|сек|s|минут?|мин|m|час(?:а|ов)?|ч|h|дн(?:ей|я)?|д|d)\b/i
    );

  if (!match) {
    return null;
  }

  const value =
    Number(
      String(match[1]).replace(
        ",",
        "."
      )
    );

  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return null;
  }

  const unit =
    match[2].toLowerCase();

  if (
    [
      "секунда",
      "секунды",
      "секунд",
      "сек",
      "s"
    ].includes(unit)
  ) {
    return Math.round(
      value
    );
  }

  if (
    [
      "минута",
      "минуты",
      "минут",
      "мин",
      "m"
    ].includes(unit)
  ) {
    return Math.round(
      value * 60
    );
  }

  if (
    [
      "час",
      "часа",
      "часов",
      "ч",
      "h"
    ].includes(unit)
  ) {
    return Math.round(
      value * 3600
    );
  }

  if (
    [
      "день",
      "дня",
      "дней",
      "дн",
      "д",
      "d"
    ].includes(unit)
  ) {
    return Math.round(
      value * 86400
    );
  }

  return null;
}

function parseTarget(
  value
) {
  const target =
    String(value || "")
      .trim();

  if (!target) {
    return null;
  }

  if (
    /^\d{5,20}$/.test(
      target
    )
  ) {
    return {
      userId:
        target,
      username:
        null
    };
  }

  const username =
    normalizeUsername(
      target
    );

  if (
    /^[a-zA-Z0-9_]{3,32}$/.test(
      username
    )
  ) {
    return {
      userId:
        null,
      username
    };
  }

  return null;
}

function localParseCommand(
  text
) {
  const value =
    String(text || "")
      .trim();

  let match =
    value.match(
      /^(?:замути|замутить)\s+(@?[a-zA-Z0-9_]{3,32}|\d{5,20})\s+(?:на\s+)?(.+)$/i
    );

  if (match) {
    const duration =
      parseDuration(
        match[2]
      );

    const target =
      parseTarget(
        match[1]
      );

    if (
      duration &&
      target
    ) {
      return {
        type: "mute",
        ...target,
        duration
      };
    }
  }

  match =
    value.match(
      /^(?:размути|размутить|сними\s+мут)\s+(@?[a-zA-Z0-9_]{3,32}|\d{5,20})$/i
    );

  if (match) {
    const target =
      parseTarget(
        match[1]
      );

    if (target) {
      return {
        type: "unmute",
        ...target
      };
    }
  }

  match =
    value.match(
      /^(?:следи\s+за|отслеживай)\s+@?([a-zA-Z0-9_]{3,32})$/i
    );

  if (match) {
    return {
      type: "watch",
      username:
        normalizeUsername(
          match[1]
        )
    };
  }

  match =
    value.match(
      /^(?:перестань\s+следить\s+за|не\s+следи\s+за|удали\s+слежку)\s+@?([a-zA-Z0-9_]{3,32})$/i
    );

  if (match) {
    return {
      type: "unwatch",
      username:
        normalizeUsername(
          match[1]
        )
    };
  }

  if (
    /^(?:покажи|открой).*(?:измен|редакт)/i.test(
      value
    )
  ) {
    return {
      type: "show_edits"
    };
  }

  if (
    /^(?:покажи|открой).*(?:удален|удалён)/i.test(
      value
    )
  ) {
    return {
      type: "show_deleted"
    };
  }

  if (
    /^(?:покажи|открой).*(?:сообщен|истори)/i.test(
      value
    )
  ) {
    return {
      type: "show_messages"
    };
  }

  if (
    /^(?:покажи|открой).*(?:событи)/i.test(
      value
    )
  ) {
    return {
      type: "show_events"
    };
  }

  if (
    /^(?:покажи|открой).*(?:статист|стат)/i.test(
      value
    )
  ) {
    return {
      type: "show_stats"
    };
  }

  return null;
}

/*
==================================================
OPENAI COMMAND PARSER
==================================================
*/

async function parseAICommand(
  text,
  context
) {
  const local =
    localParseCommand(
      text
    );

  if (local) {
    return local;
  }

  if (!OPENAI_API_KEY) {
    return {
      type: "unknown",
      message:
        "Я не понял команду. Попробуй написать, например: «замуть @username на 30 минут»."
    };
  }

  const system = `
Ты являешься командным AI парсером STMA.

STMA — Telegram Business Manager.

Твоя задача:
превратить сообщение пользователя
в ОДИН JSON-объект.

Никогда не выполняй действия.
Ты только определяешь команду.

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

Для mute:

{
  "type": "mute",
  "username": "username",
  "userId": null,
  "duration": 1800
}

Если пользователь указан числовым Telegram ID:

{
  "type": "mute",
  "username": null,
  "userId": "123456789",
  "duration": 1800
}

Единицы:

секунды = 1
минуты = 60
часы = 3600
дни = 86400

Примеры:

"замуть @ivan на 30 минут"

{
  "type":"mute",
  "username":"ivan",
  "userId":null,
  "duration":1800
}

"замуть 123456789 на 2 часа"

{
  "type":"mute",
  "username":null,
  "userId":"123456789",
  "duration":7200
}

"размути @ivan"

{
  "type":"unmute",
  "username":"ivan",
  "userId":null
}

"следи за @ivan"

{
  "type":"watch",
  "username":"ivan"
}

"перестань следить за @ivan"

{
  "type":"unwatch",
  "username":"ivan"
}

"покажи измененные сообщения"

{
  "type":"show_edits"
}

"покажи удаленные сообщения"

{
  "type":"show_deleted"
}

"покажи сообщения"

{
  "type":"show_messages"
}

"покажи события"

{
  "type":"show_events"
}

"покажи статистику"

{
  "type":"show_stats"
}

Если запрос нельзя уверенно определить:

{
  "type":"unknown",
  "message":"..."
}

Возвращай ТОЛЬКО JSON.
`;

  try {
    const response =
      await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${OPENAI_API_KEY}`
          },

          body:
            JSON.stringify({
              model:
                OPENAI_MODEL,

              input: [
                {
                  role: "system",

                  content:
                    system
                },

                {
                  role: "user",

                  content:
                    JSON.stringify({
                      text,
                      context
                    })
                }
              ]
            })
        }
      );

    if (!response.ok) {
      const body =
        await response.text();

      console.error(
        "OPENAI ERROR:",
        body
      );

      return {
        type: "unknown",
        message:
          "ИИ временно недоступен."
      };
    }

    const data =
      await response.json();

    let output =
      data.output_text || "";

    if (!output) {
      output =
        (
          data.output || []
        )
          .flatMap(
            item =>
              item.content || []
          )
          .map(
            item =>
              item.text || ""
          )
          .join("");
    }

    output =
      String(output)
        .replace(
          /^```json\s*/i,
          ""
        )
        .replace(
          /^```\s*/i,
          ""
        )
        .replace(
          /\s*```$/i,
          ""
        )
        .trim();

    const parsed =
      JSON.parse(output);

    return parsed;
  } catch (error) {
    console.error(
      "AI PARSER ERROR:",
      error.message
    );

    return {
      type: "unknown",
      message:
        "Не удалось обработать команду."
    };
  }
}

/*
==================================================
TARGET RESOLUTION
==================================================
*/

async function resolveTarget(
  connectionId,
  command
) {
  if (
    command.userId
  ) {
    const rows =
      await getMessages(
        connectionId,
        500
      );

    const target =
      rows.find(
        row =>
          String(row.from_id) ===
          String(command.userId)
      );

    if (!target) {
      return null;
    }

    return {
      chat_id:
        target.chat_id,

      user_id:
        target.from_id,

      username:
        target.username
          ? normalizeUsername(
              target.username
            )
          : null
    };
  }

  if (
    command.username
  ) {
    return findRecentChatByUsername(
      connectionId,
      normalizeUsername(
        command.username
      )
    );
  }

  return null;
}

/*
==================================================
COMMAND EXECUTION
==================================================
*/

async function executeCommand(
  command,
  req,
  connection
) {
  const connectionId =
    connection.id;

  const ownerUserId =
    req.telegramUser.id;

  switch (
    command.type
  ) {
    case "mute": {
      if (
        !command.duration
      ) {
        throw new Error(
          "Не указана длительность мута."
        );
      }

      const target =
        await resolveTarget(
          connectionId,
          command
        );

      if (!target) {
        throw new Error(
          "Пользователь не найден в сохранённой истории STMA."
        );
      }

      /*
      Мут через Bot API
      возможен для групп/супергрупп,
      но не для обычной личной переписки.
      */

      if (
        Number(target.chat_id) >= 0
      ) {
        throw new Error(
          "Нельзя замутить пользователя в личном чате. Мут доступен для групп/супергрупп, где бот имеет нужные права."
        );
      }

      await muteUser(
        connectionId,
        target.chat_id,
        target.user_id,
        command.duration
      );

      await addEvent({
        userId:
          ownerUserId,

        connectionId,

        type:
          "mute",

        chatId:
          target.chat_id,

        userIdTarget:
          target.user_id,

        username:
          target.username,

        payload: {
          duration:
            command.duration,

          durationFormatted:
            formatDurationSeconds(
              command.duration
            )
        }
      });

      return {
        ok: true,

        type:
          "mute",

        message:
          target.username
            ? `@${target.username} замучен.`
            : `Пользователь ${target.user_id} замучен.`,

        duration:
          command.duration
      };
    }

    case "unmute": {
      const target =
        await resolveTarget(
          connectionId,
          command
        );

      if (!target) {
        throw new Error(
          "Пользователь не найден."
        );
      }

      if (
        Number(target.chat_id) >= 0
      ) {
        throw new Error(
          "Размутить пользователя можно только в группе/супергруппе."
        );
      }

      await unmuteUser(
        connectionId,
        target.chat_id,
        target.user_id
      );

      await addEvent({
        userId:
          ownerUserId,

        connectionId,

        type:
          "unmute",

        chatId:
          target.chat_id,

        userIdTarget:
          target.user_id,

        username:
          target.username
      });

      return {
        ok: true,

        type:
          "unmute",

        message:
          target.username
            ? `@${target.username} размучен.`
            : `Пользователь ${target.user_id} размучен.`
      };
    }

    case "watch": {
      const username =
        normalizeUsername(
          command.username
        );

      if (!username) {
        throw new Error(
          "Не указан username."
        );
      }

      await addWatch({
        connectionId,

        ownerUserId,

        username
      });

      await addEvent({
        userId:
          ownerUserId,

        connectionId,

        type:
          "watch",

        username
      });

      return {
        ok: true,

        type:
          "watch",

        message:
          `Теперь отслеживается @${username}.`
      };
    }

    case "unwatch": {
      const username =
        normalizeUsername(
          command.username
        );

      await removeWatch(
        connectionId,
        username
      );

      await addEvent({
        userId:
          ownerUserId,

        connectionId,

        type:
          "watch",

        username,

        payload: {
          action:
            "remove"
        }
      });

      return {
        ok: true,

        type:
          "unwatch",

        message:
          `Отслеживание @${username} отключено.`
      };
    }

    case "send_message": {
      if (
        !command.text
      ) {
        throw new Error(
          "Не указан текст."
        );
      }

      const target =
        await resolveTarget(
          connectionId,
          command
        );

      if (!target) {
        throw new Error(
          "Чат пользователя не найден в истории."
        );
      }

      const result =
        await sendBusinessMessage(
          connectionId,
          target.chat_id,
          command.text
        );

      if (
        result
      ) {
        await saveSentMessage({
          ownerUserId,

          connectionId,

          message:
            result
        });

        await addEvent({
          userId:
            ownerUserId,

          connectionId,

          type:
            "message_sent",

          chatId:
            target.chat_id,

          messageId:
            result.message_id
        });
      }

      return {
        ok: true,

        type:
          "send_message",

        message:
          "Сообщение отправлено."
      };
    }

    case "delete_message": {
      if (
        !command.chatId ||
        !command.messageId
      ) {
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

      await addEvent({
        userId:
          ownerUserId,

        connectionId,

        type:
          "message_deleted",

        chatId:
          command.chatId,

        messageId:
          command.messageId
      });

      return {
        ok: true,

        type:
          "delete_message",

        message:
          "Сообщение удалено."
      };
    }

    case "show_messages": {
      return {
        ok: true,

        type:
          "show_messages",

        data:
          await getMessages(
            connectionId,
            200
          )
      };
    }

    case "show_edits": {
      return {
        ok: true,

        type:
          "show_edits",

        data:
          await getMessages(
            connectionId,
            200,
            {
              edited: true
            }
          )
      };
    }

    case "show_deleted": {
      return {
        ok: true,

        type:
          "show_deleted",

        data:
          await getMessages(
            connectionId,
            200,
            {
              deleted: true
            }
          )
      };
    }

    case "show_events": {
      return {
        ok: true,

        type:
          "show_events",

        data:
          await getEvents(
            connectionId,
            200
          )
      };
    }

    case "show_stats": {
      return {
        ok: true,

        type:
          "show_stats",

        data:
          await getStats(
            connectionId
          )
      };
    }

    default:
      return {
        ok: false,

        type:
          "unknown",

        message:
          command.message ||
          "Я не понял команду."
      };
  }
}

/*
==================================================
ENRICH MESSAGES
==================================================
*/

function enrichMessages(
  messages
) {
  return (
    messages || []
  ).map(
    message => ({
      ...message,

      message_link:
        messageLink(
          message.chat_id,
          message.message_id
        )
    })
  );
}

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
ME
==================================================
*/

app.get(
  "/api/me",
  authMiddleware,
  async (req, res) => {
    try {
      const user =
        await getUser(
          req.telegramUser.id
        );

      res.json({
        ok: true,
        user
      });
    } catch (error) {
      console.error(
        "ME ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Не удалось получить пользователя"
      });
    }
  }
);

/*
==================================================
CONNECTIONS
==================================================
*/

app.get(
  "/api/connections",
  authMiddleware,
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
        "CONNECTIONS ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          "Не удалось получить Business Connections"
      });
    }
  }
);

app.get(
  "/api/connections/:connectionId",
  authMiddleware,
  async (req, res) => {
    try {
      const connection =
        await getOwnedConnection(
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
        error:
          error.message
      });
    }
  }
);

/*
==================================================
MESSAGES
==================================================
*/

app.get(
  "/api/connections/:connectionId/messages",
  authMiddleware,
  async (req, res) => {
    try {
      const connection =
        await getOwnedConnection(
          req,
          req.params.connectionId
        );

      const messages =
        await getMessages(
          connection.id,
          Math.min(
            Number(
              req.query.limit
            ) || 200,
            500
          )
        );

      res.json({
        ok: true,

        messages:
          enrichMessages(
            messages
          )
      });
    } catch (error) {
      res.status(403).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

app.get(
  "/api/connections/:connectionId/edits",
  authMiddleware,
  async (req, res) => {
    try {
      const connection =
        await getOwnedConnection(
          req,
          req.params.connectionId
        );

      const messages =
        await getMessages(
          connection.id,
          500,
          {
            edited: true
          }
        );

      res.json({
        ok: true,

        messages:
          enrichMessages(
            messages
          )
      });
    } catch (error) {
      res.status(403).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

app.get(
  "/api/connections/:connectionId/deleted",
  authMiddleware,
  async (req, res) => {
    try {
      const connection =
        await getOwnedConnection(
          req,
          req.params.connectionId
        );

      const messages =
        await getMessages(
          connection.id,
          500,
          {
            deleted: true
          }
        );

      res.json({
        ok: true,

        messages:
          enrichMessages(
            messages
          )
      });
    } catch (error) {
      res.status(403).json({
        ok: false,
        error:
          error.message
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
  authMiddleware,
  async (req, res) => {
    try {
      const connection =
        await getOwnedConnection(
          req,
          req.params.connectionId
        );

      const chatId =
        String(
          req.body?.chatId ||
          ""
        ).trim();

      const text =
        String(
          req.body?.text ||
          ""
        ).trim();

      const deleteAfter =
        Number(
          req.body?.deleteAfter || 0
        );

      if (!chatId) {
        return res.status(400).json({
          ok: false,
          error:
            "Chat ID обязателен"
        });
      }

      if (!text) {
        return res.status(400).json({
          ok: false,
          error:
            "Текст обязателен"
        });
      }

      if (
        deleteAfter < 0 ||
        deleteAfter > 86400
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Таймер должен быть от 0 до 86400 секунд"
        });
      }

      const result =
        await sendBusinessMessage(
          connection.id,
          chatId,
          text
        );

      if (
        result
      ) {
        await saveSentMessage({
          ownerUserId:
            req.telegramUser.id,

          connectionId:
            connection.id,

          message:
            result
        });

        await addEvent({
          userId:
            req.telegramUser.id,

          connectionId:
            connection.id,

          type:
            "message_sent",

          chatId:
            result.chat?.id ||
            chatId,

          messageId:
            result.message_id
        });
      }

      if (
        deleteAfter > 0 &&
        result?.message_id
      ) {
        setTimeout(
          async () => {
            try {
              await deleteBusinessMessage(
                connection.id,
                chatId,
                result.message_id
              );

              await markMessageDeleted(
                connection.id,
                chatId,
                result.message_id
              );

              await addEvent({
                userId:
                  req.telegramUser.id,

                connectionId:
                  connection.id,

                type:
                  "message_deleted",

                chatId,

                messageId:
                  result.message_id,

                payload: {
                  reason:
                    "timer"
                }
              });
            } catch (error) {
              console.error(
                "AUTO DELETE ERROR:",
                error.message
              );
            }
          },
          deleteAfter * 1000
        );
      }

      res.json({
        ok: true,

        message:
          result || null,

        deleteAfter
      });
    } catch (error) {
      console.error(
        "SEND MESSAGE ERROR:",
        error
      );

      res.status(400).json({
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
  authMiddleware,
  async (req, res) => {
    try {
      const connection =
        await getOwnedConnection(
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

      await addEvent({
        userId:
          req.telegramUser.id,

        connectionId:
          connection.id,

        type:
          "message_deleted",

        chatId:
          req.params.chatId,

        messageId:
          req.params.messageId
      });

      res.json({
        ok: true
      });
    } catch (error) {
      console.error(
        "DELETE MESSAGE ERROR:",
        error
      );

      res.status(400).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/*
==================================================
AI COMMAND
==================================================
*/

app.post(
  "/api/connections/:connectionId/command",
  authMiddleware,
  async (req, res) => {
    try {
      const connection =
        await getOwnedConnection(
          req,
          req.params.connectionId
        );

      const text =
        String(
          req.body?.command ||
          ""
        ).trim();

      if (!text) {
        return res.status(400).json({
          ok: false,
          error:
            "Команда пустая"
        });
      }

      const command =
        await parseAICommand(
          text,
          {
            connectionId:
              connection.id,

            telegramUserId:
              req.telegramUser.id
          }
        );

      await saveCommand({
        ownerUserId:
          req.telegramUser.id,

        connectionId:
          connection.id,

        input:
          text,

        result:
          command
      });

      const result =
        await executeCommand(
          command,
          req,
          connection
        );

      res.json(
        result
      );
    } catch (error) {
      console.error(
        "COMMAND ERROR:",
        error
      );

      res.status(400).json({
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
  authMiddleware,
  async (req, res) => {
    try {
      const connection =
        await getOwnedConnection(
          req,
          req.params.connectionId
        );

      res.json({
        ok: true,

        watches:
          await getWatches(
            connection.id
          )
      });
    } catch (error) {
      res.status(403).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

app.post(
  "/api/connections/:connectionId/watches",
  authMiddleware,
  async (req, res) => {
    try {
      const connection =
        await getOwnedConnection(
          req,
          req.params.connectionId
        );

      const username =
        normalizeUsername(
          req.body?.username
        );

      if (!username) {
        return res.status(400).json({
          ok: false,
          error:
            "Username обязателен"
        });
      }

      await addWatch({
        connectionId:
          connection.id,

        ownerUserId:
          req.telegramUser.id,

        username
      });

      await addEvent({
        userId:
          req.telegramUser.id,

        connectionId:
          connection.id,

        type:
          "watch",

        username
      });

      res.json({
        ok: true
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
  "/api/connections/:connectionId/watches/:username",
  authMiddleware,
  async (req, res) => {
    try {
      const connection =
        await getOwnedConnection(
          req,
          req.params.connectionId
        );

      const username =
        normalizeUsername(
          req.params.username
        );

      await removeWatch(
        connection.id,
        username
      );

      await addEvent({
        userId:
          req.telegramUser.id,

        connectionId:
          connection.id,

        type:
          "watch",

        username,

        payload: {
          action:
            "remove"
        }
      });

      res.json({
        ok: true
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

/*
==================================================
EVENTS
==================================================
*/

app.get(
  "/api/connections/:connectionId/events",
  authMiddleware,
  async (req, res) => {
    try {
      const connection =
        await getOwnedConnection(
          req,
          req.params.connectionId
        );

      res.json({
        ok: true,

        events:
          await getEvents(
            connection.id,
            500
          )
      });
    } catch (error) {
      res.status(403).json({
        ok: false,
        error:
          error.message
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
  authMiddleware,
  async (req, res) => {
    try {
      const connection =
        await getOwnedConnection(
          req,
          req.params.connectionId
        );

      const stats =
        await getStats(
          connection.id
        );

      res.json({
        ok: true,
        stats
      });
    } catch (error) {
      res.status(403).json({
        ok: false,
        error:
          error.message
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
    if (
      WEBHOOK_SECRET &&
      req.headers[
        "x-telegram-bot-api-secret-token"
      ] !== WEBHOOK_SECRET
    ) {
      return res.status(403).json({
        ok: false
      });
    }

    /*
    Telegram должен получить 2xx быстро.
    Обработку выполняем отдельно.
    */

    res.status(200).json({
      ok: true
    });

    processTelegramUpdate(
      req.body
    ).catch(
      error => {
        console.error(
          "TELEGRAM UPDATE ERROR:",
          error
        );
      }
    );
  }
);

/*
==================================================
TELEGRAM UPDATE PROCESSOR
==================================================
*/

async function processTelegramUpdate(
  update
) {
  if (!update) {
    return;
  }

  /*
  BUSINESS CONNECTION
  */

  if (
    update.business_connection
  ) {
    const bc =
      update.business_connection;

    if (
      !bc.id ||
      !bc.user?.id
    ) {
      return;
    }

    await upsertUser({
      id:
        bc.user.id,

      username:
        bc.user.username ||
        null,

      first_name:
        bc.user.first_name ||
        null,

      last_name:
        bc.user.last_name ||
        null
    });

    await upsertBusinessConnection({
      id:
        bc.id,

      userId:
        bc.user.id,

      username:
        bc.user.username ||
        null,

      firstName:
        bc.user.first_name ||
        null,

      lastName:
        bc.user.last_name ||
        null,

      date:
        bc.date,

      rights:
        bc.rights ||
        {},

      isEnabled:
        Boolean(
          bc.is_enabled
        )
    });

    await addEvent({
      userId:
        bc.user.id,

      connectionId:
        bc.id,

      type:
        bc.is_enabled
          ? "business_connected"
          : "business_disconnected",

      payload: {
        rights:
          bc.rights ||
          {},
        is_enabled:
          Boolean(
            bc.is_enabled
          )
      }
    });

    console.log(
      "BUSINESS CONNECTION:",
      bc.id,
      "USER:",
      bc.user.id,
      "ENABLED:",
      bc.is_enabled
    );

    return;
  }

  /*
  BUSINESS MESSAGE
  */

  if (
    update.business_message
  ) {
    await handleBusinessMessage(
      update.business_message,
      false
    );

    return;
  }

  /*
  EDITED BUSINESS MESSAGE
  */

  if (
    update.edited_business_message
  ) {
    await handleBusinessMessage(
      update.edited_business_message,
      true
    );

    return;
  }

  /*
  DELETED BUSINESS MESSAGES
  */

  if (
    update.deleted_business_messages
  ) {
    await handleDeletedBusinessMessages(
      update.deleted_business_messages
    );

    return;
  }

  /*
  /start
  */

  if (
    update.message
  ) {
    await handleBotMessage(
      update.message
    );
  }
}

/*
==================================================
BUSINESS MESSAGE
==================================================
*/

async function handleBusinessMessage(
  message,
  edited
) {
  const connectionId =
    message.business_connection_id;

  if (!connectionId) {
    return;
  }

  const connection =
    await ensureBusinessConnection(
      connectionId
    );

  if (!connection) {
    console.error(
      "BUSINESS CONNECTION UNKNOWN:",
      connectionId
    );

    return;
  }

  if (
    !connection.is_enabled
  ) {
    return;
  }

  const from =
    message.from ||
    {};

  const chatId =
    message.chat?.id;

  const messageId =
    message.message_id;

  const record = {
    businessConnectionId:
      connectionId,

    ownerUserId:
      connection.user_id,

    chatId,

    messageId,

    fromId:
      from.id ||
      null,

    username:
      from.username ||
      null,

    firstName:
      from.first_name ||
      null,

    lastName:
      from.last_name ||
      null,

    text:
      message.text ||
      null,

    caption:
      message.caption ||
      null,

    date:
      message.date
        ? new Date(
            message.date * 1000
          ).toISOString()
        : now(),

    direction:
      "incoming"
  };

  if (edited) {
    const existing =
      await getMessage(
        connectionId,
        chatId,
        messageId
      );

    /*
    Если исходное сообщение
    почему-то не сохранилось,
    создаём его перед фиксацией
    изменения.
    */

    if (!existing) {
      await saveIncomingMessage(
        record
      );
    }

    await saveEditedMessage(
      record
    );

    await addEvent({
      userId:
        connection.user_id,

      connectionId,

      type:
        "message_edited",

      chatId,

      messageId,

      userIdTarget:
        from.id,

      username:
        from.username,

      payload: {
        link:
          messageLink(
            chatId,
            messageId
          )
      }
    });
  } else {
    await saveIncomingMessage(
      record
    );

    await addEvent({
      userId:
        connection.user_id,

      connectionId,

      type:
        "message_received",

      chatId,

      messageId,

      userIdTarget:
        from.id,

      username:
        from.username
    });
  }

  /*
  WATCH MATCH
  */

  const watches =
    await getTrackedUsernames(
      connectionId
    );

  const username =
    normalizeUsername(
      from.username
    );

  if (
    username &&
    watches.includes(
      username
    )
  ) {
    await addEvent({
      userId:
        connection.user_id,

      connectionId,

      type:
        "watch_match",

      chatId,

      messageId,

      userIdTarget:
        from.id,

      username,

      payload: {
        text:
          message.text ||
          message.caption ||
          "",

        link:
          messageLink(
            chatId,
            messageId
          )
      }
    });
  }
}

/*
==================================================
DELETED BUSINESS MESSAGES
==================================================
*/

async function handleDeletedBusinessMessages(
  data
) {
  const connectionId =
    data.business_connection_id;

  if (!connectionId) {
    return;
  }

  const connection =
    await ensureBusinessConnection(
      connectionId
    );

  if (!connection) {
    console.error(
      "DELETED MESSAGE CONNECTION UNKNOWN:",
      connectionId
    );

    return;
  }

  const chatId =
    data.chat?.id;

  const messageIds =
    Array.isArray(
      data.message_ids
    )
      ? data.message_ids
      : [];

  for (
    const messageId of messageIds
  ) {
    try {
      const existing =
        await getMessage(
          connectionId,
          chatId,
          messageId
        );

      await markMessageDeleted(
        connectionId,
        chatId,
        messageId
      );

      await addEvent({
        userId:
          connection.user_id,

        connectionId,

        type:
          "message_deleted",

        chatId,

        messageId,

        username:
          existing?.username ||
          null,

        payload: {
          text:
            existing?.text ||
            existing?.caption ||
            null,

          deletedAt:
            now(),

          link:
            messageLink(
              chatId,
              messageId
            )
        }
      });
    } catch (error) {
      console.error(
        "DELETE UPDATE ERROR:",
        error.message
      );
    }
  }
}

/*
==================================================
BOT /start
==================================================
*/

async function handleBotMessage(
  message
) {
  const text =
    String(
      message.text ||
      ""
    ).trim();

  if (
    text === "/start" ||
    text.startsWith(
      "/start "
    )
  ) {
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

/*
==================================================
STARTUP
==================================================
*/

async function startup() {
  console.log(
    "Starting STMA..."
  );

  if (!BOT_TOKEN) {
    console.warn(
      "WARNING: BOT_TOKEN is not configured."
    );
  }

  if (!WEBAPP_URL) {
    console.warn(
      "WARNING: WEBAPP_URL / RENDER_EXTERNAL_URL is not configured."
    );
  }

  if (!WEBHOOK_URL) {
    console.warn(
      "WARNING: WEBHOOK_URL / RENDER_EXTERNAL_URL is not configured."
    );
  }

  if (!OPENAI_API_KEY) {
    console.warn(
      "WARNING: OPENAI_API_KEY is not configured. Local command parser will still work."
    );
  }

  await initDatabase();

  if (BOT_TOKEN) {
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
          "WEBHOOK SETUP ERROR:",
          error.message
        );
      }
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
          "MENU BUTTON ERROR:",
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

startup().catch(
  error => {
    console.error(
      "FATAL STARTUP ERROR:",
      error
    );

    process.exit(1);
  }
);