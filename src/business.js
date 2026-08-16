const db = require("./database");

/*
==================================================
TELEGRAM API
==================================================
*/

async function telegramRequest(token, method, params = {}) {
  if (!token) {
    throw new Error("BOT_TOKEN не настроен");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(params)
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

/*
==================================================
SEND BUSINESS MESSAGE
==================================================
*/

async function sendBusinessMessage(
  token,
  connectionId,
  chatId,
  text
) {
  if (!connectionId) {
    throw new Error(
      "Business Connection не найден"
    );
  }

  return telegramRequest(
    token,
    "sendMessage",
    {
      business_connection_id:
        connectionId,

      chat_id:
        Number(chatId),

      text:
        String(text)
    }
  );
}

/*
==================================================
DELETE BUSINESS MESSAGE
==================================================
*/

async function deleteBusinessMessage(
  token,
  connectionId,
  chatId,
  messageId
) {
  if (!connectionId) {
    throw new Error(
      "Business Connection не найден"
    );
  }

  return telegramRequest(
    token,
    "deleteMessage",
    {
      business_connection_id:
        connectionId,

      chat_id:
        Number(chatId),

      message_id:
        Number(messageId)
    }
  );
}

/*
==================================================
PROCESS DUE DELETES
==================================================
*/

async function processDueDeletes({
  token
}) {
  const deletes =
    await db.getDueDeletes();

  for (const item of deletes) {
    try {
      await deleteBusinessMessage(
        token,
        item.connection_id,
        item.chat_id,
        item.message_id
      );

      await db.markDeleteDone(
        item.id
      );

      await db.addEvent({
        connectionId:
          item.connection_id,

        type:
          "message_deleted",

        chatId:
          item.chat_id,

        messageId:
          item.message_id,

        data: {
          scheduled: true
        }
      });

    } catch (error) {
      console.error(
        "DELETE MESSAGE ERROR:",
        error.message
      );

      /*
        Помечаем выполненным только
        если Telegram действительно
        подтвердил удаление.

        Если ошибка временная —
        запись останется и будет
        повторена следующим циклом.
      */
    }
  }
}

/*
==================================================
BUSINESS CONNECTION
==================================================
*/

async function handleBusinessConnection(
  connection
) {
  if (!connection?.id) {
    return;
  }

  const userId =
    Number(
      connection?.user?.id || 0
    );

  if (!userId) {
    console.error(
      "BUSINESS CONNECTION WITHOUT USER ID"
    );

    return;
  }

  await db.saveBusinessConnection({
    id:
      connection.id,

    user: {
      id:
        userId,

      username:
        connection?.user?.username ||
        null,

      first_name:
        connection?.user?.first_name ||
        null
    },

    is_enabled:
      connection.is_enabled !== false
  });

  await db.addEvent({
    connectionId:
      connection.id,

    type:
      connection.is_enabled !== false
        ? "connection_enabled"
        : "connection_disabled",

    data: {
      userId,
      isEnabled:
        connection.is_enabled !== false
    }
  });

  console.log(
    `Business connection ${
      connection.id
    } → user ${userId}`
  );
}

/*
==================================================
MESSAGE
==================================================
*/

async function handleBusinessMessage(
  message,
  connectionId
) {
  if (!message?.message_id) {
    return;
  }

  await db.saveMessage(
    message,
    connectionId
  );

  await db.addEvent({
    connectionId,

    type:
      "message",

    chatId:
      message?.chat?.id || null,

    messageId:
      message?.message_id || null,

    data: {
      senderId:
        message?.from?.id ||
        null,

      username:
        message?.from?.username ||
        null
    }
  });
}

/*
==================================================
EDITED MESSAGE
==================================================
*/

async function handleEditedMessage(
  message,
  connectionId
) {
  if (!message?.message_id) {
    return;
  }

  await db.markEdited(
    message,
    connectionId
  );

  await db.addEvent({
    connectionId,

    type:
      "message_edited",

    chatId:
      message?.chat?.id || null,

    messageId:
      message?.message_id || null
  });
}

/*
==================================================
DELETED MESSAGES
==================================================
*/

async function handleDeletedMessages(
  update,
  connectionId
) {
  const chatId =
    update?.business_messages_deleted
      ?.chat
      ?.id;

  const messageIds =
    update?.business_messages_deleted
      ?.message_ids || [];

  if (!chatId || !messageIds.length) {
    return;
  }

  await db.markDeleted(
    connectionId,
    chatId,
    messageIds
  );

  await db.addEvent({
    connectionId,

    type:
      "messages_deleted",

    chatId,

    data: {
      messageIds
    }
  });
}

/*
==================================================
HANDLE UPDATE
==================================================
*/

async function handleUpdate(
  update,
  { token }
) {
  if (!update) {
    return;
  }

  /*
    Business connection
  */

  if (
    update.business_connection
  ) {
    await handleBusinessConnection(
      update.business_connection
    );

    return;
  }

  /*
    New business message
  */

  if (
    update.business_message
  ) {
    const message =
      update.business_message;

    const connectionId =
      message.business_connection_id;

    if (!connectionId) {
      return;
    }

    await handleBusinessMessage(
      message,
      connectionId
    );

    return;
  }

  /*
    Edited business message
  */

  if (
    update.edited_business_message
  ) {
    const message =
      update.edited_business_message;

    const connectionId =
      message.business_connection_id;

    if (!connectionId) {
      return;
    }

    await handleEditedMessage(
      message,
      connectionId
    );

    return;
  }

  /*
    Deleted business messages
  */

  if (
    update.deleted_business_messages
  ) {
    const data =
      update.deleted_business_messages;

    const connectionId =
      data.business_connection_id;

    if (!connectionId) {
      return;
    }

    await handleDeletedMessages(
      update,
      connectionId
    );

    return;
  }
}

/*
==================================================
WEBHOOK SETUP
==================================================
*/

async function setWebhook(
  token,
  webhookUrl
) {
  return telegramRequest(
    token,
    "setWebhook",
    {
      url:
        webhookUrl
    }
  );
}

/*
==================================================
GET WEBHOOK INFO
==================================================
*/

async function getWebhookInfo(
  token
) {
  return telegramRequest(
    token,
    "getWebhookInfo"
  );
}

/*
==================================================
BOT INFO
==================================================
*/

async function getBotInfo(
  token
) {
  return telegramRequest(
    token,
    "getMe"
  );
}

/*
==================================================
EXPORT
==================================================
*/

module.exports = {
  telegramRequest,

  sendBusinessMessage,
  deleteBusinessMessage,

  processDueDeletes,

  handleUpdate,

  setWebhook,
  getWebhookInfo,
  getBotInfo
};