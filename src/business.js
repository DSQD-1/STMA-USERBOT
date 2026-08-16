const db = require("./database");

/*
==================================================
TELEGRAM API
==================================================
*/

async function telegramRequest(
  token,
  method,
  params = {}
) {
  if (!token) {
    throw new Error(
      "BOT_TOKEN не настроен"
    );
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

  const result =
    await response.json();

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
DELETE BUSINESS MESSAGES
==================================================

Правильный метод Telegram Business.

Нужен permission:
can_delete_all_messages
==================================================
*/

async function deleteBusinessMessages(
  token,
  connectionId,
  messageIds
) {
  if (!connectionId) {
    throw new Error(
      "Business Connection не найден"
    );
  }

  if (
    !Array.isArray(messageIds) ||
    !messageIds.length
  ) {
    return false;
  }

  return telegramRequest(
    token,
    "deleteBusinessMessages",
    {
      business_connection_id:
        connectionId,

      message_ids:
        messageIds.map(Number)
    }
  );
}

/*
==================================================
DELETE ONE BUSINESS MESSAGE
==================================================
*/

async function deleteBusinessMessage(
  token,
  connectionId,
  chatId,
  messageId
) {
  return deleteBusinessMessages(
    token,
    connectionId,
    [messageId]
  );
}

/*
==================================================
SCHEDULED DELETES
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

      await db.markDeleteError(
        item.id,
        error.message
      );
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
        null,

      last_name:
        connection?.user?.last_name ||
        null
    },

    rights:
      connection?.rights ||
      null,

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
        connection.is_enabled !== false,

      rights:
        connection?.rights || null
    }
  });

  console.log(
    `Business connection ${connection.id} -> user ${userId}`
  );

  console.log(
    "Business rights:",
    JSON.stringify(
      connection?.rights || {},
      null,
      2
    )
  );
}

/*
==================================================
MESSAGE
==================================================
*/

async function handleBusinessMessage(
  message,
  connectionId,
  token
) {
  if (!message?.message_id) {
    return;
  }

  /*
  Сначала сохраняем сообщение.
  */

  await db.saveMessage(
    message,
    connectionId
  );

  const senderId =
    message?.from?.id
      ? Number(message.from.id)
      : null;

  const username =
    message?.from?.username ||
    null;

  /*
  Проверяем mute.
  */

  const muted =
    await db.isMuted(
      connectionId,
      senderId,
      username
    );

  if (muted) {
    try {
      /*
      Удаляем сообщение нарушителя
      сразу после получения update.
      */

      await deleteBusinessMessages(
        token,
        connectionId,
        [message.message_id]
      );

      /*
      Отмечаем его удалённым
      в нашей истории.
      */

      await db.markDeleted(
        connectionId,
        message.chat?.id,
        [message.message_id]
      );

      await db.addEvent({
        connectionId,

        type:
          "muted_message_deleted",

        chatId:
          message?.chat?.id ||
          null,

        messageId:
          message?.message_id ||
          null,

        data: {
          senderId,
          username
        }
      });

      console.log(
        `MUTED: deleted message ${message.message_id} from ${senderId || username}`
      );
    } catch (error) {
      console.error(
        "MUTE DELETE ERROR:",
        error.message
      );

      await db.addEvent({
        connectionId,

        type:
          "mute_delete_error",

        chatId:
          message?.chat?.id ||
          null,

        messageId:
          message?.message_id ||
          null,

        data: {
          senderId,
          username,
          error:
            error.message
        }
      });
    }

    return;
  }

  /*
  Обычное сообщение.
  */

  await db.addEvent({
    connectionId,

    type:
      "message",

    chatId:
      message?.chat?.id ||
      null,

    messageId:
      message?.message_id ||
      null,

    data: {
      senderId,
      username
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
      message?.chat?.id ||
      null,

    messageId:
      message?.message_id ||
      null
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
  const data =
    update?.deleted_business_messages;

  if (!data) {
    return;
  }

  const chatId =
    data?.chat?.id;

  const messageIds =
    data?.message_ids || [];

  if (
    !chatId ||
    !messageIds.length
  ) {
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
  BUSINESS CONNECTION
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
  NEW BUSINESS MESSAGE
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
      connectionId,
      token
    );

    return;
  }

  /*
  EDITED BUSINESS MESSAGE
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
  DELETED BUSINESS MESSAGES
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
WEBHOOK
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
      url: webhookUrl
    }
  );
}

async function getWebhookInfo(
  token
) {
  return telegramRequest(
    token,
    "getWebhookInfo"
  );
}

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
  deleteBusinessMessages,

  processDueDeletes,

  handleUpdate,

  setWebhook,
  getWebhookInfo,
  getBotInfo
};