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

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error(
      `Telegram API вернул некорректный ответ: ${method}`
    );
  }

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
BUSINESS CONNECTION
==================================================
*/

async function getConnection(connectionId) {
  if (!connectionId) {
    throw new Error(
      "Business Connection ID не указан"
    );
  }

  const connection =
    await db.getBusinessConnection(
      String(connectionId)
    );

  if (!connection) {
    throw new Error(
      "Business Connection не найден"
    );
  }

  if (
    Number(connection.is_enabled) !== 1
  ) {
    throw new Error(
      "Business Connection отключён"
    );
  }

  return connection;
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
  const connection =
    await getConnection(connectionId);

  if (
    !Number.isInteger(Number(chatId))
  ) {
    throw new Error(
      "Некорректный chat_id"
    );
  }

  const cleanText =
    String(text || "").trim();

  if (!cleanText) {
    throw new Error(
      "Текст сообщения пустой"
    );
  }

  return telegramRequest(
    token,
    "sendMessage",
    {
      business_connection_id:
        connection.id,

      chat_id:
        Number(chatId),

      text:
        cleanText
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
  const connection =
    await getConnection(connectionId);

  if (
    !Number.isInteger(Number(chatId))
  ) {
    throw new Error(
      "Некорректный chat_id"
    );
  }

  if (
    !Number.isInteger(Number(messageId))
  ) {
    throw new Error(
      "Некорректный message_id"
    );
  }

  return telegramRequest(
    token,
    "deleteMessage",
    {
      business_connection_id:
        connection.id,

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
        `DELETE MESSAGE ERROR [${item.id}]:`,
        error.message
      );

      await db.markDeleteError(
        item.id,
        error.message
      );

      /*
       * Не помечаем done.
       *
       * Если ошибка временная,
       * запись останется для повторной
       * попытки следующим циклом.
       */
    }
  }
}

/*
==================================================
BUSINESS CONNECTION UPDATE
==================================================
*/

async function handleBusinessConnection(
  connection
) {
  if (!connection?.id) {
    console.error(
      "BUSINESS CONNECTION WITHOUT ID"
    );

    return;
  }

  const user =
    connection.user || {};

  const userId =
    Number(user.id || 0);

  if (!userId) {
    console.error(
      "BUSINESS CONNECTION WITHOUT USER ID"
    );

    return;
  }

  const enabled =
    connection.is_enabled !== false;

  await db.saveBusinessConnection({
    id:
      String(connection.id),

    user: {
      id:
        userId,

      username:
        user.username ||
        null,

      first_name:
        user.first_name ||
        null,

      last_name:
        user.last_name ||
        null
    },

    is_enabled:
      enabled,

    rights:
      connection.rights ||
      null
  });

  await db.addEvent({
    connectionId:
      String(connection.id),

    type:
      enabled
        ? "connection_enabled"
        : "connection_disabled",

    data: {
      userId,
      username:
        user.username || null,
      isEnabled:
        enabled
    }
  });

  console.log(
    `Business connection ${
      connection.id
    } -> user ${userId} -> ${
      enabled
        ? "enabled"
        : "disabled"
    }`
  );
}

/*
==================================================
NEW BUSINESS MESSAGE
==================================================
*/

async function handleBusinessMessage(
  message,
  connectionId
) {
  if (!message?.message_id) {
    return;
  }

  if (!connectionId) {
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
      message?.chat?.id ||
      null,

    messageId:
      message?.message_id ||
      null,

    data: {
      senderId:
        message?.from?.id ||
        null,

      username:
        message?.from?.username ||
        null,

      text:
        message?.text ||
        message?.caption ||
        ""
    }
  });
}

/*
==================================================
EDITED BUSINESS MESSAGE
==================================================
*/

async function handleEditedMessage(
  message,
  connectionId
) {
  if (!message?.message_id) {
    return;
  }

  if (!connectionId) {
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
      null,

    data: {
      text:
        message?.text ||
        message?.caption ||
        ""
    }
  });
}

/*
==================================================
DELETED BUSINESS MESSAGES
==================================================
*/

async function handleDeletedMessages(
  update,
  connectionId
) {
  const data =
    update?.deleted_business_messages ||
    update?.business_messages_deleted ||
    null;

  if (!data) {
    return;
  }

  const chatId =
    data?.chat?.id;

  const messageIds =
    data?.message_ids || [];

  if (
    chatId === undefined ||
    !Array.isArray(messageIds) ||
    messageIds.length === 0
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
HANDLE TELEGRAM UPDATE
==================================================
*/

async function handleUpdate(
  update,
  { token } = {}
) {
  if (!update) {
    return;
  }

  /*
  ----------------------------------------------
  BUSINESS CONNECTION
  ----------------------------------------------
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
  ----------------------------------------------
  NEW BUSINESS MESSAGE
  ----------------------------------------------
  */

  if (
    update.business_message
  ) {
    const message =
      update.business_message;

    const connectionId =
      message.business_connection_id;

    if (!connectionId) {
      console.warn(
        "BUSINESS MESSAGE WITHOUT CONNECTION ID"
      );

      return;
    }

    await handleBusinessMessage(
      message,
      connectionId
    );

    return;
  }

  /*
  ----------------------------------------------
  EDITED BUSINESS MESSAGE
  ----------------------------------------------
  */

  if (
    update.edited_business_message
  ) {
    const message =
      update.edited_business_message;

    const connectionId =
      message.business_connection_id;

    if (!connectionId) {
      console.warn(
        "EDITED BUSINESS MESSAGE WITHOUT CONNECTION ID"
      );

      return;
    }

    await handleEditedMessage(
      message,
      connectionId
    );

    return;
  }

  /*
  ----------------------------------------------
  DELETED BUSINESS MESSAGES
  ----------------------------------------------
  */

  if (
    update.deleted_business_messages
  ) {
    const data =
      update.deleted_business_messages;

    const connectionId =
      data.business_connection_id;

    if (!connectionId) {
      console.warn(
        "DELETED BUSINESS MESSAGE WITHOUT CONNECTION ID"
      );

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
  webhookUrl,
  secretToken = null
) {
  if (!webhookUrl) {
    throw new Error(
      "WEBHOOK URL не указан"
    );
  }

  const params = {
    url:
      String(webhookUrl)
  };

  if (secretToken) {
    params.secret_token =
      String(secretToken);
  }

  return telegramRequest(
    token,
    "setWebhook",
    params
  );
}

/*
==================================================
DELETE WEBHOOK
==================================================
*/

async function deleteWebhook(
  token
) {
  return telegramRequest(
    token,
    "deleteWebhook",
    {
      drop_pending_updates: false
    }
  );
}

/*
==================================================
WEBHOOK INFO
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

  getConnection,

  sendBusinessMessage,
  deleteBusinessMessage,

  processDueDeletes,

  handleUpdate,

  setWebhook,
  deleteWebhook,
  getWebhookInfo,

  getBotInfo
};