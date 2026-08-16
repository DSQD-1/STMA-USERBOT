const PREFIX = ".";

/*
==================================================
TEXT
==================================================
*/

function getText(message) {
  return (
    message?.text ||
    message?.caption ||
    ""
  );
}

/*
==================================================
COMMAND PARSER
==================================================
*/

function parseCommand(text) {
  if (
    !text ||
    !text.startsWith(PREFIX)
  ) {
    return null;
  }

  const parts =
    text.trim().split(/\s+/);

  const command =
    parts[0]
      .slice(PREFIX.length)
      .toLowerCase();

  return {
    command,
    args: parts.slice(1)
  };
}

/*
==================================================
SEND MESSAGE
==================================================
*/

async function sendMessage(
  telegram,
  connectionId,
  chatId,
  text,
  extra = {}
) {
  return telegram(
    "sendMessage",
    {
      business_connection_id:
        connectionId,

      chat_id:
        chatId,

      text,

      ...extra
    }
  );
}

/*
==================================================
DELETE BUSINESS MESSAGES
==================================================
*/

async function deleteBusinessMessages(
  telegram,
  connectionId,
  messageIds
) {
  if (
    !Array.isArray(messageIds) ||
    !messageIds.length
  ) {
    return null;
  }

  return telegram(
    "deleteBusinessMessages",
    {
      business_connection_id:
        connectionId,

      message_ids:
        messageIds
    }
  );
}

/*
==================================================
HTML ESCAPE
==================================================
*/

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/*
==================================================
HELP
==================================================
*/

async function help(
  telegram,
  connectionId,
  chatId
) {
  const text = `
🔥 STMA

Telegram Business automation system

ℹ️ ИНФОРМАЦИЯ

.help
.info
.uinfo
.ruinfo

📡 МОНИТОРИНГ

.watch
.watches
.sh

🛡 ЗАЩИТА

.mute
.unmute

🛠 УТИЛИТЫ

.t [задержка] [текст]
.spt

━━━━━━━━━━━━━━━━━━

Префикс: .
`.trim();

  await sendMessage(
    telegram,
    connectionId,
    chatId,
    text
  );
}

/*
==================================================
INFO
==================================================
*/

async function info(
  telegram,
  connectionId,
  chatId,
  services
) {
  const stats =
    await services.getUserStats(
      connectionId
    );

  const connection =
    await services.getBusinessConnection(
      connectionId
    );

  const text = `
🔥 STMA

🟢 Статус: Online

🔗 Business Connection:
${connectionId}

📡 Подключение:
${
  connection?.is_enabled
    ? "активно"
    : "выключено"
}

📨 Сообщений:
${stats.messages}

✏️ Изменений:
${stats.edits}

🗑 Удалений:
${stats.deleted}

📡 Событий:
${stats.events}

⚙️ Версия:
2.1.0
`.trim();

  await sendMessage(
    telegram,
    connectionId,
    chatId,
    text
  );
}

/*
==================================================
USER INFO
==================================================
*/

async function userInfo(
  telegram,
  connectionId,
  chatId,
  message
) {
  let user =
    message?.from;

  if (
    message?.reply_to_message?.from
  ) {
    user =
      message.reply_to_message.from;
  }

  if (!user) {
    await sendMessage(
      telegram,
      connectionId,
      chatId,
      "Ответь командой .uinfo на сообщение пользователя."
    );

    return;
  }

  const fullName = [
    user.first_name,
    user.last_name
  ]
    .filter(Boolean)
    .join(" ");

  const text = `
👤 USER INFO

🆔 ID:
${user.id ?? "—"}

👤 Имя:
${fullName || "—"}

🔹 Username:
${
  user.username
    ? "@" + user.username
    : "—"
}

🤖 Bot:
${user.is_bot ? "Да" : "Нет"}

🌐 Language:
${user.language_code || "—"}
`.trim();

  await sendMessage(
    telegram,
    connectionId,
    chatId,
    text
  );
}

/*
==================================================
RAW INFO
==================================================
*/

async function rawInfo(
  telegram,
  connectionId,
  chatId,
  message
) {
  const target =
    message?.reply_to_message ||
    message;

  let json =
    JSON.stringify(
      target,
      null,
      2
    );

  if (json.length > 3500) {
    json =
      json.slice(0, 3500) +
      "\n...";
  }

  await sendMessage(
    telegram,
    connectionId,
    chatId,
    `<pre>${escapeHtml(json)}</pre>`,
    {
      parse_mode: "HTML"
    }
  );
}

/*
==================================================
TYPEWRITER
==================================================
*/

async function typewriter(
  telegram,
  connectionId,
  chatId,
  args
) {
  if (!args.length) {
    await sendMessage(
      telegram,
      connectionId,
      chatId,
      "Использование:\n.t [задержка] [текст]\n\nПример:\n.t 0.1 Привет"
    );

    return;
  }

  let delay = 0.08;

  let text =
    args.join(" ");

  if (
    !Number.isNaN(
      Number(args[0])
    )
  ) {
    delay = Math.max(
      0.03,
      Math.min(
        1,
        Number(args[0])
      )
    );

    text =
      args
        .slice(1)
        .join(" ");
  }

  if (!text) {
    return;
  }

  const sent =
    await sendMessage(
      telegram,
      connectionId,
      chatId,
      "▌"
    );

  let current = "";

  for (const char of text) {
    current += char;

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          delay * 1000
        )
    );

    try {
      await telegram(
        "editMessageText",
        {
          business_connection_id:
            connectionId,

          chat_id:
            chatId,

          message_id:
            sent.message_id,

          text:
            current + "▌"
        }
      );
    } catch {
      break;
    }
  }

  try {
    await telegram(
      "editMessageText",
      {
        business_connection_id:
          connectionId,

        chat_id:
          chatId,

        message_id:
          sent.message_id,

        text
      }
    );
  } catch {}
}

/*
==================================================
GET TARGET USER
==================================================
*/

function getTargetUser(
  message,
  args
) {
  if (
    message?.reply_to_message?.from?.id
  ) {
    return {
      id:
        message.reply_to_message.from.id,

      messageId:
        message.reply_to_message
          .message_id,

      user:
        message.reply_to_message.from
    };
  }

  if (args[0]) {
    return {
      id: args[0],
      messageId: null,
      user: null
    };
  }

  return null;
}

/*
==================================================
MUTE
==================================================
*/

async function mute(
  telegram,
  connectionId,
  chatId,
  message,
  args,
  services
) {
  const target =
    getTargetUser(
      message,
      args
    );

  if (!target) {
    await sendMessage(
      telegram,
      connectionId,
      chatId,
      "🔇 Использование:\n\n.mute USER_ID\n\nИли ответь .mute на сообщение пользователя."
    );

    return;
  }

  const userId =
    String(target.id);

  /*
  -----------------------------------------------
  ADD TO IGNORE
  -----------------------------------------------
  */

  await services.addIgnore(
    connectionId,
    userId
  );

  /*
  -----------------------------------------------
  DELETE THE MESSAGE
  -----------------------------------------------
  */

  if (target.messageId) {
    try {
      await deleteBusinessMessages(
        telegram,
        connectionId,
        [
          Number(target.messageId)
        ]
      );

      console.log(
        `🔇 Message ${target.messageId} deleted after mute of ${userId}`
      );

    } catch (error) {
      console.error(
        `❌ Failed to delete muted user's message ${target.messageId}:`,
        error.message
      );

      await sendMessage(
        telegram,
        connectionId,
        chatId,
        `⚠️ Пользователь ${userId} добавлен в mute, но сообщение не удалось удалить.\n\nПричина: ${error.message}`
      );

      return;
    }
  }

  /*
  -----------------------------------------------
  SUCCESS
  -----------------------------------------------
  */

  await sendMessage(
    telegram,
    connectionId,
    chatId,
    `🔇 Пользователь ${userId} замьючен.\n\nНовые сообщения этого пользователя будут автоматически удаляться.`
  );
}

/*
==================================================
UNMUTE
==================================================
*/

async function unmute(
  telegram,
  connectionId,
  chatId,
  message,
  args,
  services
) {
  const target =
    getTargetUser(
      message,
      args
    );

  if (!target) {
    await sendMessage(
      telegram,
      connectionId,
      chatId,
      "🔊 Использование:\n\n.unmute USER_ID\n\nИли ответь .unmute на сообщение пользователя."
    );

    return;
  }

  const userId =
    String(target.id);

  await services.removeIgnore(
    connectionId,
    userId
  );

  await sendMessage(
    telegram,
    connectionId,
    chatId,
    `🔊 Пользователь ${userId} размьючен.`
  );
}

/*
==================================================
WATCH
==================================================
*/

async function watch(
  telegram,
  connectionId,
  chatId,
  args,
  services
) {
  const value =
    args[0]?.toLowerCase();

  if (
    value !== "on" &&
    value !== "off"
  ) {
    const settings =
      await services.getWatchSettings(
        connectionId
      );

    await sendMessage(
      telegram,
      connectionId,
      chatId,
      `
📡 MONITORING

Статус:
${settings.enabled ? "🟢 ON" : "🔴 OFF"}

Новые сообщения:
${settings.new_messages ? "🟢" : "🔴"}

Изменения:
${settings.edited_messages ? "🟢" : "🔴"}

Удаления:
${settings.deleted_messages ? "🟢" : "🔴"}

Использование:

.watch on
.watch off
      `.trim()
    );

    return;
  }

  const enabled =
    value === "on";

  await services.setWatchSettings(
    connectionId,
    {
      enabled
    }
  );

  await sendMessage(
    telegram,
    connectionId,
    chatId,
    `📡 Мониторинг: ${
      enabled
        ? "🟢 включён"
        : "🔴 выключен"
    }`
  );
}

/*
==================================================
WATCHES
==================================================
*/

async function watches(
  telegram,
  connectionId,
  chatId,
  services
) {
  const settings =
    await services.getWatchSettings(
      connectionId
    );

  const ignored =
    await services.getIgnoredUsers(
      connectionId
    );

  const text = `
📡 STMA MONITORING

Общий статус:
${settings.enabled ? "🟢 ON" : "🔴 OFF"}

📨 Новые:
${settings.new_messages ? "🟢" : "🔴"}

✏️ Изменения:
${settings.edited_messages ? "🟢" : "🔴"}

🗑 Удаления:
${settings.deleted_messages ? "🟢" : "🔴"}

🔇 Игнорируемых пользователей:
${ignored.length}
`.trim();

  await sendMessage(
    telegram,
    connectionId,
    chatId,
    text
  );
}

/*
==================================================
HISTORY
==================================================
*/

async function showHistory(
  telegram,
  connectionId,
  chatId,
  args,
  services
) {
  const limit =
    Number(args[0]) || 10;

  const messages =
    await services.getRecentMessages(
      connectionId,
      limit
    );

  if (!messages.length) {
    await sendMessage(
      telegram,
      connectionId,
      chatId,
      "📭 История сообщений пока пустая."
    );

    return;
  }

  const lines =
    messages.map(
      (item, index) => {
        const name =
          item.sender_username
            ? "@" +
              item.sender_username
            : item.sender_name ||
              item.sender_id ||
              "Unknown";

        const text =
          item.text ||
          "[медиа]";

        return (
          `${index + 1}. ` +
          `${name}: ${text}`
        );
      }
    );

  let text =
    "📜 ПОСЛЕДНИЕ СООБЩЕНИЯ\n\n" +
    lines.join("\n");

  if (text.length > 3800) {
    text =
      text.slice(0, 3800) +
      "\n...";
  }

  await sendMessage(
    telegram,
    connectionId,
    chatId,
    text
  );
}

/*
==================================================
EVENTS
==================================================
*/

async function showEvents(
  telegram,
  connectionId,
  chatId,
  services
) {
  const events =
    await services.getRecentEvents(
      connectionId,
      15
    );

  if (!events.length) {
    await sendMessage(
      telegram,
      connectionId,
      chatId,
      "📭 Событий пока нет."
    );

    return;
  }

  const lines =
    events.map(
      event =>
        `• ${event.type} | ${
          event.message_id ||
          "—"
        }`
    );

  await sendMessage(
    telegram,
    connectionId,
    chatId,
    (
      "📡 ЖУРНАЛ СОБЫТИЙ\n\n" +
      lines.join("\n")
    ).slice(0, 3900)
  );
}

/*
==================================================
SPT
==================================================
*/

async function spt(
  telegram,
  connectionId,
  chatId,
  services
) {
  const connection =
    await services.getBusinessConnection(
      connectionId
    );

  let rights = {};

  try {
    rights =
      connection?.rights
        ? JSON.parse(
            connection.rights
          )
        : {};
  } catch {
    rights = {};
  }

  const rightsText =
    Object.entries(rights)
      .map(
        ([key, value]) =>
          `${value ? "🟢" : "🔴"} ${key}`
      )
      .join("\n") ||
    "Нет данных";

  await sendMessage(
    telegram,
    connectionId,
    chatId,
    `
⚙️ STMA SETTINGS

Business Connection:
${connectionId}

Права:

${rightsText}
    `.trim()
  );
}

/*
==================================================
PROCESS COMMAND
==================================================
*/

async function processCommand(
  message,
  connectionId,
  services
) {
  const text =
    getText(message);

  const parsed =
    parseCommand(text);

  if (!parsed) {
    return false;
  }

  const chatId =
    message.chat?.id;

  if (!chatId) {
    return false;
  }

  switch (
    parsed.command
  ) {
    case "help":
      await help(
        services.telegram,
        connectionId,
        chatId
      );
      break;

    case "info":
      await info(
        services.telegram,
        connectionId,
        chatId,
        services
      );
      break;

    case "uinfo":
      await userInfo(
        services.telegram,
        connectionId,
        chatId,
        message
      );
      break;

    case "ruinfo":
      await rawInfo(
        services.telegram,
        connectionId,
        chatId,
        message
      );
      break;

    case "t":
      await typewriter(
        services.telegram,
        connectionId,
        chatId,
        parsed.args
      );
      break;

    case "mute":
      await mute(
        services.telegram,
        connectionId,
        chatId,
        message,
        parsed.args,
        services
      );
      break;

    case "unmute":
      await unmute(
        services.telegram,
        connectionId,
        chatId,
        message,
        parsed.args,
        services
      );
      break;

    case "watch":
      await watch(
        services.telegram,
        connectionId,
        chatId,
        parsed.args,
        services
      );
      break;

    case "watches":
      await watches(
        services.telegram,
        connectionId,
        chatId,
        services
      );
      break;

    case "sh":
      await showHistory(
        services.telegram,
        connectionId,
        chatId,
        parsed.args,
        services
      );
      break;

    case "spt":
      await spt(
        services.telegram,
        connectionId,
        chatId,
        services
      );
      break;

    default:
      return false;
  }

  return true;
}

/*
==================================================
HANDLE UPDATE
==================================================
*/

async function handleUpdate(
  update,
  services
) {

  /*
  ==============================================
  BUSINESS CONNECTION
  ==============================================
  */

  if (
    update.business_connection
  ) {
    const connection =
      update.business_connection;

    await services.saveBusinessConnection(
      connection
    );

    await services.saveEvent({
      connectionId:
        connection.id,

      type:
        connection.is_enabled
          ? "business_connected"
          : "business_disconnected",

      data: connection
    });

    console.log(
      "🔗 Business connection:",
      connection.id,
      connection.is_enabled
    );

    return;
  }

  /*
  ==============================================
  NEW BUSINESS MESSAGE
  ==============================================
  */

  if (
    update.business_message
  ) {
    const message =
      update.business_message;

    const connectionId =
      message.business_connection_id;

    const senderId =
      message.from?.id;

    /*
    --------------------------------------------
    SAVE MESSAGE FIRST
    --------------------------------------------
    */

    await services.saveMessage(
      message,
      connectionId
    );

    /*
    --------------------------------------------
    SAVE EVENT
    --------------------------------------------
    */

    await services.saveEvent({
      connectionId,

      type:
        "new_message",

      chatId:
        message.chat?.id,

      messageId:
        message.message_id,

      data:
        message
    });

    /*
    --------------------------------------------
    CHECK COMMAND
    --------------------------------------------
    */

    const text =
      getText(message);

    const parsed =
      parseCommand(text);

    /*
    --------------------------------------------
    IMPORTANT:
    COMMANDS FROM THE OWNER MUST WORK
    EVEN IF OWNER IS IN IGNORE.
    --------------------------------------------
    */

    const isCommand =
      Boolean(parsed);

    /*
    --------------------------------------------
    CHECK IGNORE
    --------------------------------------------
    */

    const ignored =
      senderId &&
      await services.isIgnored(
        connectionId,
        senderId
      );

    /*
    --------------------------------------------
    PROCESS COMMAND
    --------------------------------------------
    */

    if (isCommand) {
      await processCommand(
        message,
        connectionId,
        services
      );

      /*
      Команда .mute сама удаляет
      сообщение, на которое был
      сделан reply.
      */

      return;
    }

    /*
    --------------------------------------------
    AUTO DELETE MUTED USER
    --------------------------------------------
    */

    if (ignored) {
      console.log(
        `🔇 Muted user detected: ${senderId}`
      );

      try {
        await deleteBusinessMessages(
          services.telegram,
          connectionId,
          [
            Number(
              message.message_id
            )
          ]
        );

        console.log(
          `🗑 Automatically deleted message ${message.message_id} from muted user ${senderId}`
        );

      } catch (error) {
        console.error(
          `❌ Failed to automatically delete message ${message.message_id}:`,
          error.message
        );
      }

      return;
    }

    /*
    --------------------------------------------
    NORMAL MESSAGE
    --------------------------------------------
    */

    console.log(
      "📨 New business message:",
      message.message_id
    );

    return;
  }

  /*
  ==============================================
  EDITED BUSINESS MESSAGE
  ==============================================
  */

  if (
    update.edited_business_message
  ) {
    const message =
      update.edited_business_message;

    const connectionId =
      message.business_connection_id;

    await services.saveMessageEdit(
      message,
      connectionId
    );

    await services.saveEvent({
      connectionId,

      type:
        "edited_message",

      chatId:
        message.chat?.id,

      messageId:
        message.message_id,

      data:
        message
    });

    console.log(
      "✏️ Edited message:",
      message.message_id
    );

    return;
  }

  /*
  ==============================================
  DELETED BUSINESS MESSAGES
  ==============================================
  */

  if (
    update.deleted_business_messages
  ) {
    const deleted =
      update.deleted_business_messages;

    const connectionId =
      deleted.business_connection_id;

    await services.saveDeletedMessages(
      deleted,
      connectionId
    );

    await services.saveEvent({
      connectionId,

      type:
        "deleted_messages",

      chatId:
        deleted.chat?.id,

      data:
        deleted
    });

    console.log(
      "🗑 Deleted messages:",
      deleted.message_ids
    );

    return;
  }
}

/*
==================================================
EXPORT
==================================================
*/

module.exports = {
  handleUpdate,
  sendMessage,
  deleteBusinessMessages
};