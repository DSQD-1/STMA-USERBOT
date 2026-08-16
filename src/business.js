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
        String(connectionId),

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

  if (!chatId) {
    throw new Error(
      "chat_id отсутствует"
    );
  }

  if (!messageId) {
    throw new Error(
      "message_id отсутствует"
    );
  }

  return telegramRequest(
    token,
    "deleteMessage",
    {
      business_connection_id:
        String(connectionId),

      chat_id:
        Number(chatId),

      message_id:
        Number(messageId)
    }
  );
}

/*
==================================================
CHECK MUTE
==================================================
*/

async function checkMutedUser(
  connectionId,
  message
) {
  const userId =
    message?.from?.id
      ? Number(message.from.id)
      : null;

  const username =
    message?.from?.username ||
    null;

  if (!userId && !username) {
    return false;
  }

  try {
    return await db.isMuted(
      connectionId,
      userId,
      username
    );
  } catch (error) {
    console.error(
      "MUTE CHECK ERROR:",
      error.message
    );

    return false;
  }
}

/*
==================================================
DELETE MUTED MESSAGE
==================================================
*/

async function deleteMutedMessage(
  token,
  message,
  connectionId
) {
  const chatId =
    message?.chat?.id;

  const messageId =
    message?.message_id;

  const senderId =
    message?.from?.id
      ? Number(message.from.id)
      : null;

  const username =
    message?.from?.username ||
    null;

  if (!chatId || !messageId) {
    return false;
  }

  try {
    await deleteBusinessMessage(
      token,
      connectionId,
      chatId,
      messageId
    );

    await db.addEvent({
      connectionId,

      type:
        "muted_message_deleted",

      chatId,

      messageId,

      data: {
        senderId,
        username
      }
    });

    console.log(
      `Muted message deleted: user=${senderId || username}, message=${messageId}`
    );

    return true;
  } catch (error) {
    /*
      Если Telegram не разрешил удаление,
      сообщение не помечаем как удалённое.
    */

    console.error(
      "MUTED MESSAGE DELETE ERROR:",
      error.message
    );

    await db.addEvent({
      connectionId,

      type:
        "muted_message_delete_error",

      chatId,

      messageId,

      data: {
        senderId,
        username,
        error:
          error.message
      }
    });

    return false;
  }
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
        Не помечаем выполненным.
        Следующий цикл попробует снова.
      */

      try {
        await db.markDeleteError(
          item.id,
          error.message
        );
      } catch (dbError) {
        console.error(
          "DELETE ERROR SAVE ERROR:",
          dbError.message
        );
      }
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
      String(connection.id),

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

    is_enabled:
      connection.is_enabled !== false,

    rights:
      connection.rights || null
  });

  await db.addEvent({
    connectionId:
      String(connection.id),

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
    `Business connection ${connection.id} -> user ${userId} -> ${
      connection.is_enabled !== false
        ? "enabled"
        : "disabled"
    }`
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

  if (!connectionId) {
    return;
  }

  /*
    ==============================================
    MUTE CHECK
    ==============================================

    Сначала проверяем пользователя.

    Если он находится в mutes:
    1. не записываем обычное сообщение;
    2. пытаемся удалить его через Telegram;
    3. создаём событие.
  */

  const muted =
    await checkMutedUser(
      connectionId,
      message
    );

  if (muted) {
    console.log(
      `MUTED USER MESSAGE: ${
        message?.from?.id ||
        message?.from?.username ||
        "unknown"
      }`
    );

    await deleteMutedMessage(
      token,
      message,
      connectionId
    );

    return;
  }

  /*
    ==============================================
    Обычное сообщение
    ==============================================
  */

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
  connectionId,
  token
) {
  if (!message?.message_id) {
    return;
  }

  if (!connectionId) {
    return;
  }

  /*
    Проверяем мут и для редактирования.

    Если пользователь был замьючен уже
    после отправки сообщения — удаляем
    отредактированное сообщение.
  */

  const muted =
    await checkMutedUser(
      connectionId,
      message
    );

  if (muted) {
    console.log(
      `MUTED USER EDITED MESSAGE: ${
        message?.from?.id ||
        message?.from?.username ||
        "unknown"
      }`
    );

    await deleteMutedMessage(
      token,
      message,
      connectionId
    );

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
    Array.isArray(data?.message_ids)
      ? data.message_ids
      : [];

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
    ==============================================
    BUSINESS CONNECTION
    ==============================================
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

    if (!connectionId) {
      console.error(
        "BUSINESS MESSAGE WITHOUT CONNECTION ID"
      );

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

    if (!connectionId) {
      console.error(
        "EDITED BUSINESS MESSAGE WITHOUT CONNECTION ID"
      );

      return;
    }

    await handleEditedMessage(
      message,
      connectionId,
      token
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
    const data =
      update.deleted_business_messages;

    const connectionId =
      data.business_connection_id;

    if (!connectionId) {
      console.error(
        "DELETED BUSINESS MESSAGES WITHOUT CONNECTION ID"
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
WEBHOOK SETUP
==================================================
*/

async function setWebhook(
  token,
  webhookUrl,
  secretToken
) {
  const params = {
    url:
      String(webhookUrl)
  };

  /*
    Если секрет задан в server.js,
    Telegram будет отправлять его
    в X-Telegram-Bot-Api-Secret-Token.
  */

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