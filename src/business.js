const BOT_TOKEN =
  process.env.BOT_TOKEN || "";

async function telegramRequest(
  method,
  payload = {}
) {
  if (!BOT_TOKEN) {
    throw new Error(
      "BOT_TOKEN is not configured"
    );
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
    const description =
      data?.description ||
      `Telegram HTTP ${response.status}`;

    const error = new Error(description);
    error.telegram = data;

    throw error;
  }

  return data.result;
}

async function sendBusinessMessage(
  businessConnectionId,
  chatId,
  text
) {
  return telegramRequest(
    "sendMessage",
    {
      business_connection_id:
        businessConnectionId,
      chat_id: chatId,
      text
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
          businessConnectionId,
        chat_id: chatId,
        message_ids: [
          Number(messageId)
        ]
      }
    );
  } catch (error) {
    if (
      /message to delete not found/i.test(
        error.message
      ) ||
      /message can't be deleted/i.test(
        error.message
      )
    ) {
      return true;
    }

    throw error;
  }
}

async function muteUser(
  businessConnectionId,
  chatId,
  userId,
  duration
) {
  const untilDate =
    Math.floor(Date.now() / 1000) +
    Number(duration);

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

async function setWebhook(
  webhookUrl,
  secret
) {
  const payload = {
    url: webhookUrl,
    allowed_updates: [
      "message",
      "business_connection",
      "business_message",
      "edited_business_message",
      "deleted_business_messages"
    ]
  };

  if (secret) {
    payload.secret_token = secret;
  }

  return telegramRequest(
    "setWebhook",
    payload
  );
}

async function setMenuButton(
  webappUrl
) {
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
          "STMA готов, но WEBAPP_URL ещё не настроен."
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
  sendBusinessMessage,
  deleteBusinessMessage,
  muteUser,
  unmuteUser,
  setWebhook,
  setMenuButton,
  answerStart
};