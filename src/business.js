const PREFIX = ".";

function getText(message) {
  return (
    message?.text ||
    message?.caption ||
    ""
  );
}

function parseCommand(text) {
  if (!text || !text.startsWith(PREFIX)) {
    return null;
  }

  const parts = text.trim().split(/\s+/);

  const command = parts[0]
    .slice(PREFIX.length)
    .toLowerCase();

  return {
    command,
    args: parts.slice(1)
  };
}

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
      business_connection_id: connectionId,
      chat_id: chatId,
      text,
      ...extra
    }
  );
}

async function deleteBusinessMessages(
  telegram,
  connectionId,
  messageIds
) {
  return telegram(
    "deleteBusinessMessages",
    {
      business_connection_id: connectionId,
      message_ids: messageIds
    }
  );
}

async function help(
  telegram,
  connectionId,
  chatId
) {
  const text = `
🛠 STMA

Telegram Business automation system

ℹ️ Информация

.help — список команд
.info — информация о STMA
.uinfo — информация о пользователе
.ruinfo — техническая информация

🛠 Утилиты

.t 0.1 Привет
.spt
.sh

🛡 Защита

.mute
.unmute

🕵️ Мониторинг

.watch
.watches

━━━━━━━━━━━━━━

Префикс команд: .
`;

  await sendMessage(
    telegram,
    connectionId,
    chatId,
    text.trim()
  );
}

async function info(
  telegram,
  connectionId,
  chatId,
  getUserStats
) {
  const stats =
    await getUserStats(connectionId);

  const text = `
ℹ️ STMA

Статус: 🟢 Online
Business Connection: активна

📨 Сообщений:
${stats.messages}

📡 Событий:
${stats.events}

Версия: 1.0.0
`;

  await sendMessage(
    telegram,
    connectionId,
    chatId,
    text.trim()
  );
}

async function userInfo(
  telegram,
  connectionId,
  chatId,
  message
) {
  let user = message.from;

  if (
    message.reply_to_message &&
    message.reply_to_message.from
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

  const text = `
👤 USER INFO

ID: ${user.id ?? "—"}
Имя: ${user.first_name ?? "—"}
Фамилия: ${user.last_name ?? "—"}
Username: ${
    user.username
      ? "@" + user.username
      : "—"
  }
`;

  await sendMessage(
    telegram,
    connectionId,
    chatId,
    text.trim()
  );
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function rawInfo(
  telegram,
  connectionId,
  chatId,
  message
) {
  const target =
    message.reply_to_message ||
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
      "Использование: .t [задержка] [текст]"
    );

    return;
  }

  let delay = 0.08;
  let text = args.join(" ");

  if (!Number.isNaN(Number(args[0]))) {
    delay = Math.max(
      0.03,
      Math.min(
        1,
        Number(args[0])
      )
    );

    text =
      args.slice(1).join(" ");
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
          chat_id: chatId,
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
        chat_id: chatId,
        message_id:
          sent.message_id,
        text
      }
    );
  } catch {}
}

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
    return;
  }

  const chatId =
    message.chat?.id;

  if (!chatId) {
    return;
  }

  switch (parsed.command) {
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
        services.getUserStats
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

    default:
      break;
  }
}

async function handleUpdate(
  update,
  services
) {
  if (update.business_connection) {
    const connection =
      update.business_connection;

    await services
      .saveBusinessConnection(
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
      "Business connection:",
      connection.id,
      connection.is_enabled
    );

    return;
  }

  if (update.business_message) {
    const message =
      update.business_message;

    const connectionId =
      message.business_connection_id;

    await services.saveMessage(
      message,
      connectionId
    );

    await services.saveEvent({
      connectionId,
      type: "new_message",
      chatId:
        message.chat?.id,
      messageId:
        message.message_id,
      data: message
    });

    await processCommand(
      message,
      connectionId,
      services
    );

    return;
  }

  if (update.edited_business_message) {
    const message =
      update.edited_business_message;

    const connectionId =
      message.business_connection_id;

    await services.saveEvent({
      connectionId,
      type: "edited_message",
      chatId:
        message.chat?.id,
      messageId:
        message.message_id,
      data: message
    });

    return;
  }

  if (update.deleted_business_messages) {
    const deleted =
      update.deleted_business_messages;

    const connectionId =
      deleted.business_connection_id;

    await services.saveEvent({
      connectionId,
      type: "deleted_messages",
      data: deleted
    });

    return;
  }
}

module.exports = {
  handleUpdate,
  sendMessage,
  deleteBusinessMessages
};