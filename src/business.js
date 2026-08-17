const BOT_TOKEN = String(process.env.BOT_TOKEN || "").trim();

async function telegramRequest(method, payload = {}) {
  if (!BOT_TOKEN) {
    throw new Error("BOT_TOKEN is not configured");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Telegram returned invalid JSON (${response.status})`
    );
  }

  if (!response.ok || !data.ok) {
    const error = new Error(
      data?.description ||
      `Telegram HTTP ${response.status}`
    );

    error.telegram = data;

    throw error;
  }

  return data.result;
}

/*
==================================================
BUSINESS CONNECTION
==================================================
*/

/*
Получить актуальное Business Connection
по его ID.

Это критически важно:
если Telegram прислал business_message,
а connection ещё отсутствует в Turso,
мы можем восстановить его через этот метод.
*/

async function getBusinessConnection(connectionId) {
  if (!connectionId) {
    throw new Error("Business connection ID is required");
  }

  return telegramRequest(
    "getBusinessConnection",
    {
      business_connection_id: String(connectionId)
    }
  );
}

/*
==================================================
MESSAGES
==================================================
*/

async function sendBusinessMessage(
  businessConnectionId,
  chatId,
  text
) {
  return telegramRequest(
    "sendMessage",
    {
      business_connection_id:
        String(businessConnectionId),

      chat_id: chatId,

      text: String(text)
    }
  );
}

async function deleteBusinessMessage(
  businessConnectionId,
  chatId,
  messageId
) {
  try {
    return await telegramRequest(
      "deleteBusinessMessages",
      {
        business_connection_id:
          String(businessConnectionId),

        chat_id: chatId,

        message_ids: [
          Number(messageId)
        ]
      }
    );
  } catch (error) {
    const message =
      String(error.message || "").toLowerCase();

    /*
    Если сообщение уже удалено,
    STMA не должен падать.
    */

    if (
      message.includes("message to delete not found") ||
      message.includes("message can't be deleted") ||
      message.includes("message not found") ||
      message.includes("message_id_invalid")
    ) {
      return true;
    }

    throw error;
  }
}

/*
==================================================
MUTE
==================================================
*/

async function muteUser(
  businessConnectionId,
  chatId,
  userId,
  duration
) {
  const untilDate =
    Math.floor(Date.now() / 1000) +
    Number(duration);

  /*
  Важно:
  restrictChatMember не использует
  business_connection_id.

  Поэтому эта функция предназначена
  только для чатов, где Telegram позволяет
  боту выполнить соответствующую операцию.
  */

  return telegramRequest(
    "restrictChatMember",
    {
      chat_id: chatId,

      user_id: Number(userId),

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
        can_invite_users: true,
        can_pin_messages: false,
        can_manage_topics: false
      },

      until_date: untilDate
    }
  );
}

async function unmuteUser(
  businessConnectionId,
  chatId,
  userId
) {
  return telegramRequest(
    "restrictChatMember",
    {
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
        can_add_web_page_previews: true,
        can_change_info: false,
        can_invite_users: true,
        can_pin_messages: false,
        can_manage_topics: false
      }
    }
  );
}

/*
==================================================
WEBHOOK
==================================================
*/

async function setWebhook(
  webhookUrl,
  secret
) {
  if (!webhookUrl) {
    throw new Error(
      "Webhook URL is not configured"
    );
  }

  if (!/^https:\/\//i.test(webhookUrl)) {
    throw new Error(
      "Webhook URL must use HTTPS"
    );
  }

  const payload = {
    url: webhookUrl,

    allowed_updates: [
      "message",
      "business_connection",
      "business_message",
      "edited_business_message",
      "deleted_business_messages"
    ],

    drop_pending_updates: false
  };

  if (secret) {
    payload.secret_token = secret;
  }

  return telegramRequest(
    "setWebhook",
    payload
  );
}

async function getWebhookInfo() {
  return telegramRequest(
    "getWebhookInfo"
  );
}

/*
==================================================
MENU BUTTON
==================================================
*/

async function setMenuButton(webappUrl) {
  if (!webappUrl) {
    throw new Error(
      "WEBAPP_URL is not configured"
    );
  }

  if (!/^https:\/\//i.test(webappUrl)) {
    throw new Error(
      "WEBAPP_URL must use HTTPS"
    );
  }

  return telegramRequest(
    "setChatMenuButton",
    {
      menu_button: {
        type: "web_app",

        text: "STMA",

        web_app: {
          url: webappUrl
        }
      }
    }
  );
}

/*
==================================================
/start
==================================================
*/

async function answerStart(
  chatId,
  webappUrl
) {
  if (!webappUrl) {
    return telegramRequest(
      "sendMessage",
      {
        chat_id: chatId,

        text:
          "STMA готов, но Web App URL ещё не настроен."
      }
    );
  }

  return telegramRequest(
    "sendMessage",
    {
      chat_id: chatId,

      text:
        "STMA готов.\nОткрой панель управления кнопкой ниже.",

      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "Открыть STMA",

              web_app: {
                url: webappUrl
              }
            }
          ]
        ]
      }
    }
  );
}

module.exports = {
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
};