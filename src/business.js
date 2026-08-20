import {
  upsertUser,
  upsertBusinessConnection,
  disableBusinessConnection,
  saveMessage,
  markMessagesDeleted,
  addEvent,
  findWatch,
  addWatch,
  getPendingDeletions,
  completeDeletion
} from "./database.js";

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is not set");
}

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

export async function telegram(method, body = {}) {
  const response = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Telegram returned invalid JSON (${response.status})`
    );
  }

  if (!response.ok || !data.ok) {
    const description =
      data?.description || `HTTP ${response.status}`;

    const error = new Error(description);
    error.telegram = data;
    error.status = response.status;

    throw error;
  }

  return data.result;
}

export async function getMe() {
  return telegram("getMe");
}

function getUserName(user) {
  if (!user) return null;

  return [user.first_name, user.last_name]
    .filter(Boolean)
    .join(" ")
    .trim() || user.username || null;
}

function getMessageText(message) {
  return message?.text || null;
}

function getMessageCaption(message) {
  return message?.caption || null;
}

export async function sendBusinessMessage({
  connectionId,
  chatId,
  text,
  messageThreadId,
  directMessagesTopicId,
  replyParameters
}) {
  const body = {
    business_connection_id: String(connectionId),
    chat_id: chatId,
    text: String(text)
  };

  if (messageThreadId != null) {
    body.message_thread_id = Number(messageThreadId);
  }

  if (directMessagesTopicId != null) {
    body.direct_messages_topic_id =
      Number(directMessagesTopicId);
  }

  if (replyParameters) {
    body.reply_parameters = replyParameters;
  }

  return telegram("sendMessage", body);
}

export async function deleteBusinessMessage({
  connectionId,
  messageId
}) {
  return telegram("deleteBusinessMessages", {
    business_connection_id: String(connectionId),
    message_ids: [Number(messageId)]
  });
}

export async function muteUser({
  chatId,
  userId,
  durationSeconds
}) {
  const untilDate =
    Math.floor(Date.now() / 1000) +
    Number(durationSeconds);

  return telegram("restrictChatMember", {
    chat_id: chatId,
    user_id: Number(userId),
    until_date: untilDate,
    permissions: {
      can_send_messages: false,
      can_send_audios: false,
      can_send_documents: false,
      can_send_photos: false,
      can_send_videos: false,
      can_send_video_notes: false,
      can_send_voice_notes: false,
      can_send_polls: false,
      can_send_other_messages: false,
      can_add_web_page_previews: false,
      can_change_info: false,
      can_invite_users: false,
      can_pin_messages: false,
      can_manage_topics: false
    },
    use_independent_chat_permissions: true
  });
}

export async function unmuteUser({
  chatId,
  userId
}) {
  return telegram("restrictChatMember", {
    chat_id: chatId,
    user_id: Number(userId),
    permissions: {
      can_send_messages: true,
      can_send_audios: true,
      can_send_documents: true,
      can_send_photos: true,
      can_send_videos: true,
      can_send_video_notes: true,
      can_send_voice_notes: true,
      can_send_polls: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true
    },
    use_independent_chat_permissions: true
  });
}

export function parseCommand(input) {
  const text = String(input || "").trim();

  let match = text.match(
    /^замути\s+(\d{5,20})\s+на\s+(\d+)\s*(секунд|сек|минут|мин|часов|час|ч|дней|день|д|s|m|h|d)$/iu
  );

  if (match) {
    const userId = Number(match[1]);
    const amount = Number(match[2]);
    const unit = match[3].toLowerCase();

    const multipliers = {
      секунд: 1,
      сек: 1,
      s: 1,

      минут: 60,
      мин: 60,
      m: 60,

      часов: 3600,
      час: 3600,
      ч: 3600,
      h: 3600,

      дней: 86400,
      день: 86400,
      д: 86400,
      d: 86400
    };

    return {
      type: "mute",
      userId,
      durationSeconds:
        amount * (multipliers[unit] || 60)
    };
  }

  match = text.match(
    /^размути\s+(\d{5,20})$/iu
  );

  if (match) {
    return {
      type: "unmute",
      userId: Number(match[1])
    };
  }

  match = text.match(
    /^следи\s+@?([a-zA-Z0-9_]{3,32})$/iu
  );

  if (match) {
    return {
      type: "watch",
      username: `@${match[1]}`
    };
  }

  return {
    type: "unknown"
  };
}

async function handleBusinessMessage(message) {
  const connectionId =
    message.business_connection_id;

  if (!connectionId || !message.chat) return;

  const sender = message.from;

  const connectionResult =
    await telegram("getBusinessConnection", {
      business_connection_id: connectionId
    });

  const connectionOwner =
    connectionResult.user;

  if (!connectionOwner?.id) return;

  await upsertUser(connectionOwner);
  await upsertBusinessConnection(connectionResult);

  await saveMessage({
    business_connection_id: connectionId,
    chat_id: message.chat.id,
    message_id: message.message_id,
    sender_id: sender?.id,
    sender_username: sender?.username,
    sender_name: getUserName(sender),
    direction:
      sender?.is_bot ? "outgoing" : "incoming",
    text: getMessageText(message),
    caption: getMessageCaption(message),
    message_date: message.date,
    edited: false,
    deleted: false,
    raw: message
  });

  await addEvent({
    owner_telegram_id: connectionOwner.id,
    business_connection_id: connectionId,
    type: "message_received",
    chat_id: message.chat.id,
    message_id: message.message_id,
    user_id: sender?.id,
    username: sender?.username,
    payload: message
  });

  if (sender?.username) {
    const watch = await findWatch(
      connectionId,
      sender.username
    );

    if (watch) {
      await addEvent({
        owner_telegram_id: connectionOwner.id,
        business_connection_id: connectionId,
        type: "watch_match",
        chat_id: message.chat.id,
        message_id: message.message_id,
        user_id: sender.id,
        username: sender.username,
        payload: {
          watch: watch.username,
          message
        }
      });
    }
  }
}

async function handleEditedBusinessMessage(message) {
  const connectionId =
    message.business_connection_id;

  if (!connectionId || !message.chat) return;

  const connectionResult =
    await telegram("getBusinessConnection", {
      business_connection_id: connectionId
    });

  const owner = connectionResult.user;

  if (!owner?.id) return;

  await upsertUser(owner);
  await upsertBusinessConnection(connectionResult);

  await saveMessage({
    business_connection_id: connectionId,
    chat_id: message.chat.id,
    message_id: message.message_id,
    sender_id: message.from?.id,
    sender_username: message.from?.username,
    sender_name: getUserName(message.from),
    direction:
      message.from?.is_bot
        ? "outgoing"
        : "incoming",
    text: getMessageText(message),
    caption: getMessageCaption(message),
    message_date: message.date,
    edited: true,
    deleted: false,
    raw: message
  });

  await addEvent({
    owner_telegram_id: owner.id,
    business_connection_id: connectionId,
    type: "message_edited",
    chat_id: message.chat.id,
    message_id: message.message_id,
    user_id: message.from?.id,
    username: message.from?.username,
    payload: message
  });
}

async function handleDeletedBusinessMessages(data) {
  const connectionId =
    data.business_connection_id;

  if (!connectionId) return;

  const connectionResult =
    await telegram("getBusinessConnection", {
      business_connection_id: connectionId
    });

  const owner = connectionResult.user;

  if (!owner?.id) return;

  await upsertUser(owner);
  await upsertBusinessConnection(connectionResult);

  const chatId =
    data.chat?.id != null
      ? String(data.chat.id)
      : null;

  if (chatId) {
    await markMessagesDeleted(
      connectionId,
      chatId,
      data.message_ids || []
    );
  }

  await addEvent({
    owner_telegram_id: owner.id,
    business_connection_id: connectionId,
    type: "message_deleted",
    chat_id: chatId,
    payload: data
  });
}

export async function handleUpdate(update) {
  if (update.business_connection) {
    const connection =
      update.business_connection;

    await upsertUser(connection.user);
    await upsertBusinessConnection(connection);

    await addEvent({
      owner_telegram_id: connection.user.id,
      business_connection_id: connection.id,
      type: connection.is_enabled
        ? "business_connected"
        : "business_disconnected",
      user_id: connection.user.id,
      username: connection.user.username,
      payload: connection
    });

    if (!connection.is_enabled) {
      await disableBusinessConnection(
        connection.id
      );
    }

    return;
  }

  if (update.business_message) {
    await handleBusinessMessage(
      update.business_message
    );
    return;
  }

  if (update.edited_business_message) {
    await handleEditedBusinessMessage(
      update.edited_business_message
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
    const message = update.message;

    if (
      message.text === "/start" ||
      message.text?.startsWith("/start ")
    ) {
      await sendStartMessage(
        message.chat.id
      );
    }
  }
}

export async function sendStartMessage(chatId) {
  const webAppUrl =
    process.env.WEBAPP_URL ||
    process.env.RENDER_EXTERNAL_URL;

  if (!webAppUrl) {
    return telegram("sendMessage", {
      chat_id: chatId,
      text:
        "STMA запущен, но WEBAPP_URL ещё не настроен."
    });
  }

  await telegram("sendMessage", {
    chat_id: chatId,
    text:
      "🚀 STMA готов.\n\nВся работа выполняется внутри Mini App.",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🚀 Открыть STMA",
            web_app: {
              url: webAppUrl
            }
          }
        ]
      ]
    }
  });
}

export async function configureTelegram() {
  const webAppUrl =
    process.env.WEBAPP_URL ||
    process.env.RENDER_EXTERNAL_URL;

  if (!webAppUrl) {
    console.warn(
      "WEBAPP_URL / RENDER_EXTERNAL_URL not set"
    );
    return;
  }

  const webhookUrl =
    process.env.WEBHOOK_URL ||
    `${webAppUrl.replace(/\/$/, "")}/telegram/webhook`;

  await telegram("setWebhook", {
    url: webhookUrl,
    secret_token:
      process.env.WEBHOOK_SECRET || undefined,
    allowed_updates: [
      "message",
      "business_connection",
      "business_message",
      "edited_business_message",
      "deleted_business_messages"
    ]
  });

  await telegram("setChatMenuButton", {
    menu_button: {
      type: "web_app",
      text: "STMA",
      web_app: {
        url: webAppUrl
      }
    }
  });

  console.log(
    `Telegram webhook configured: ${webhookUrl}`
  );
}

export async function restoreDeletionTimers() {
  const rows =
    await getPendingDeletions();

  for (const row of rows) {
    scheduleDeletion(row);
  }
}

export function scheduleDeletion(row) {
  const executeAt =
    Number(row.execute_at) * 1000;

  const delay = Math.max(
    executeAt - Date.now(),
    0
  );

  setTimeout(async () => {
    try {
      await deleteBusinessMessage({
        connectionId:
          row.business_connection_id,
        messageId: row.message_id
      });

      await completeDeletion(
        row.id,
        "done"
      );

      await addEvent({
        owner_telegram_id:
          row.owner_telegram_id,
        business_connection_id:
          row.business_connection_id,
        type: "message_auto_deleted",
        chat_id: row.chat_id,
        message_id: row.message_id,
        payload: {
          scheduled_deletion_id: row.id
        }
      });
    } catch (error) {
      console.error(
        "Scheduled deletion error:",
        error.message
      );

      await completeDeletion(
        row.id,
        "failed"
      );
    }
  }, delay);
}