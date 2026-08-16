const db = require("./database");

const TELEGRAM_API =
  "https://api.telegram.org/bot";

async function telegramRequest(
  token,
  method,
  payload = {}
) {
  if (!token) {
    throw new Error("BOT_TOKEN не задан");
  }

  const response = await fetch(
    `${TELEGRAM_API}${token}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  const result = await response.json();

  if (!result.ok) {
    throw new Error(
      result.description ||
        `Telegram API error: ${method}`
    );
  }

  return result.result;
}

/* ==================================================
   SEND BUSINESS MESSAGE
================================================== */

async function sendBusinessMessage(
  token,
  businessConnectionId,
  chatId,
  text
) {
  return telegramRequest(
    token,
    "sendMessage",
    {
      business_connection_id:
        businessConnectionId,

      chat_id: Number(chatId),

      text: String(text)
    }
  );
}

/* ==================================================
   DELETE BUSINESS MESSAGE
================================================== */

async function deleteBusinessMessage(
  token,
  businessConnectionId,
  chatId,
  messageId
) {
  return telegramRequest(
    token,
    "deleteMessage",
    {
      business_connection_id:
        businessConnectionId,

      chat_id: Number(chatId),

      message_id: Number(messageId)
    }
  );
}

/* ==================================================
   BOT INFO
================================================== */

async function getBotInfo(token) {
  return telegramRequest(
    token,
    "getMe"
  );
}

/* ==================================================
   WEBHOOK
================================================== */

async function setWebhook(
  token,
  url
) {
  return telegramRequest(
    token,
    "setWebhook",
    {
      url
    }
  );
}

async function deleteWebhook(token) {
  return telegramRequest(
    token,
    "deleteWebhook"
  );
}

/* ==================================================
   BUSINESS CONNECTION
================================================== */

async function handleBusinessConnection(update) {
  const connection =
    update.business_connection;

  if (!connection) {
    return;
  }

  const saved =
    db.saveBusinessConnection(
      connection
    );

  db.addEvent({
    connectionId:
      connection.id,

    type:
      connection.is_enabled
        ? "business_connected"
        : "business_disconnected",

    data: {
      userId:
        connection.user?.id || null,

      username:
        connection.user?.username || null,

      firstName:
        connection.user?.first_name ||
        null,

      enabled:
        Boolean(
          connection.is_enabled
        )
    }
  });

  console.log(
    "BUSINESS CONNECTION:",
    saved
  );
}

/* ==================================================
   NEW BUSINESS MESSAGE
================================================== */

async function handleBusinessMessage(update) {
  const message =
    update.business_message;

  if (!message) {
    return;
  }

  const connectionId =
    message.business_connection_id;

  if (!connectionId) {
    return;
  }

  db.saveMessage(
    message,
    connectionId
  );

  db.addEvent({
    connectionId,

    type: "message",

    chatId:
      message.chat?.id || null,

    messageId:
      message.message_id || null,

    data: {
      text:
        message.text ||
        message.caption ||
        "",

      senderId:
        message.from?.id || null,

      senderUsername:
        message.from?.username ||
        null
    }
  });
}

/* ==================================================
   EDITED BUSINESS MESSAGE
================================================== */

async function handleEditedBusinessMessage(
  update
) {
  const message =
    update.edited_business_message;

  if (!message) {
    return;
  }

  const connectionId =
    message.business_connection_id;

  if (!connectionId) {
    return;
  }

  db.markEdited(
    message,
    connectionId
  );

  db.addEvent({
    connectionId,

    type: "message_edited",

    chatId:
      message.chat?.id || null,

    messageId:
      message.message_id || null,

    data: {
      text:
        message.text ||
        message.caption ||
        ""
    }
  });
}

/* ==================================================
   DELETED BUSINESS MESSAGES
================================================== */

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

  const chatId =
    deleted.chat?.id;

  const messageIds =
    deleted.message_ids || [];

  if (
    !connectionId ||
    !chatId
  ) {
    return;
  }

  db.markDeleted(
    connectionId,
    chatId,
    messageIds
  );

  db.addEvent({
    connectionId,

    type: "messages_deleted",

    chatId,

    data: {
      messageIds
    }
  });
}

/* ==================================================
   HANDLE UPDATE
================================================== */

async function handleUpdate(
  update,
  options = {}
) {
  if (!update) {
    return;
  }

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
      update
    );
  }

  if (
    update.edited_business_message
  ) {
    await handleEditedBusinessMessage(
      update
    );
  }

  if (
    update.deleted_business_messages
  ) {
    await handleDeletedBusinessMessages(
      update
    );
  }
}

/* ==================================================
   SCHEDULED DELETE PROCESSOR
================================================== */

async function processDueDeletes({
  token
}) {
  const deletes =
    db.getDueDeletes();

  if (!deletes.length) {
    return;
  }

  for (const item of deletes) {
    try {
      await deleteBusinessMessage(
        token,
        item.connection_id,
        item.chat_id,
        item.message_id
      );

      db.markDeleteDone(
        item.id
      );

      db.addEvent({
        connectionId:
          item.connection_id,

        type:
          "scheduled_delete",

        chatId:
          item.chat_id,

        messageId:
          item.message_id,

        data: {
          success: true
        }
      });
    } catch (error) {
      console.error(
        "SCHEDULED DELETE ERROR:",
        error.message
      );

      db.markDeleteDone(
        item.id
      );

      db.addEvent({
        connectionId:
          item.connection_id,

        type:
          "scheduled_delete_error",

        chatId:
          item.chat_id,

        messageId:
          item.message_id,

        data: {
          success: false,
          error: error.message
        }
      });
    }
  }
}

/* ==================================================
   EXPORT
================================================== */

module.exports = {
  telegramRequest,
  sendBusinessMessage,
  deleteBusinessMessage,
  getBotInfo,
  setWebhook,
  deleteWebhook,
  handleUpdate,
  processDueDeletes
};