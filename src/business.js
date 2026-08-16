const db = require("./database");

const TELEGRAM_API =
  "https://api.telegram.org/bot";

/*
==================================================
 TELEGRAM API
==================================================
*/

async function telegramRequest(
  token,
  method,
  payload = {}
) {
  if (!token) {
    throw new Error(
      "BOT_TOKEN не задан"
    );
  }

  const response = await fetch(
    `${TELEGRAM_API}${token}/${method}`,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json"
      },

      body: JSON.stringify(
        payload
      )
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
 BOT INFO
==================================================
*/

async function getBotInfo(token) {
  return telegramRequest(
    token,
    "getMe"
  );
}

/*
==================================================
 WEBHOOK
==================================================
*/

async function setWebhook(
  token,
  url
) {
  return telegramRequest(
    token,
    "setWebhook",
    {
      url,

      allowed_updates: [
        "business_connection",
        "business_message",
        "edited_business_message",
        "deleted_business_messages"
      ]
    }
  );
}

async function deleteWebhook(
  token
) {
  return telegramRequest(
    token,
    "deleteWebhook"
  );
}

/*
==================================================
 SEND BUSINESS MESSAGE
==================================================
*/

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

      chat_id:
        Number(chatId),

      message_id:
        Number(messageId)
    }
  );
}

/*
==================================================
 BUSINESS CONNECTION
==================================================
*/

async function handleBusinessConnection(
  update
) {
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
        connection.user?.id ||
        null,

      username:
        connection.user?.username ||
        null,

      firstName:
        connection.user?.first_name ||
        null,

      lastName:
        connection.user?.last_name ||
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

/*
==================================================
 CHECK MUTE
==================================================
*/

function isMessageMuted(
  connectionId,
  message
) {
  const userId =
    message?.from?.id ||
    null;

  const username =
    message?.from?.username ||
    null;

  return db.isMuted(
    connectionId,
    userId,
    username
  );
}

/*
==================================================
 MUTED MESSAGE
==================================================
*/

async function handleMutedMessage(
  token,
  message,
  connectionId
) {
  const chatId =
    message?.chat?.id;

  const messageId =
    message?.message_id;

  if (
    !chatId ||
    !messageId
  ) {
    return {
      deleted: false,
      reason:
        "Нет chat_id или message_id"
    };
  }

  try {
    await deleteBusinessMessage(
      token,
      connectionId,
      chatId,
      messageId
    );

    db.markDeleted(
      connectionId,
      chatId,
      [messageId]
    );

    db.addEvent({
      connectionId,

      type:
        "muted_message_deleted",

      chatId,

      messageId,

      data: {
        userId:
          message?.from?.id ||
          null,

        username:
          message?.from?.username ||
          null,

        success: true
      }
    });

    console.log(
      `MUTED MESSAGE DELETED: ${
        message?.from?.username
          ? "@" +
            message.from.username
          : message?.from?.id
      } / ${messageId}`
    );

    return {
      deleted: true
    };
  } catch (error) {
    console.error(
      "MUTED MESSAGE DELETE ERROR:",
      error.message
    );

    db.addEvent({
      connectionId,

      type:
        "muted_message_delete_error",

      chatId,

      messageId,

      data: {
        userId:
          message?.from?.id ||
          null,

        username:
          message?.from?.username ||
          null,

        success: false,

        error:
          error.message
      }
    });

    return {
      deleted: false,

      error:
        error.message
    };
  }
}

/*
==================================================
 NEW BUSINESS MESSAGE
==================================================
*/

async function handleBusinessMessage(
  token,
  update
) {
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

  /*
  Сохраняем информацию
  о пользователе.
  */

  if (message.from?.id) {
    db.saveUser({
      id:
        message.from.id,

      username:
        message.from.username ||
        null,

      first_name:
        message.from.first_name ||
        null,

      last_name:
        message.from.last_name ||
        null
    });
  }

  /*
  Сначала сохраняем сообщение
  в историю.
  */

  db.saveMessage(
    message,
    connectionId
  );

  /*
  Проверяем мут.
  Работает одновременно
  по ID и username.
  */

  const muted =
    isMessageMuted(
      connectionId,
      message
    );

  if (muted) {
    await handleMutedMessage(
      token,
      message,
      connectionId
    );

    return;
  }

  /*
  Обычное сообщение.
  */

  db.addEvent({
    connectionId,

    type:
      "message",

    chatId:
      message.chat?.id ||
      null,

    messageId:
      message.message_id ||
      null,

    data: {
      text:
        message.text ||
        message.caption ||
        "",

      senderId:
        message.from?.id ||
        null,

      senderUsername:
        message.from?.username ||
        null,

      senderName:
        [
          message.from?.first_name,
          message.from?.last_name
        ]
          .filter(Boolean)
          .join(" ") ||
        null,

      muted: false
    }
  });
}

/*
==================================================
 EDITED BUSINESS MESSAGE
==================================================
*/

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

    type:
      "message_edited",

    chatId:
      message.chat?.id ||
      null,

    messageId:
      message.message_id ||
      null,

    data: {
      text:
        message.text ||
        message.caption ||
        "",

      senderId:
        message.from?.id ||
        null,

      username:
        message.from?.username ||
        null
    }
  });
}

/*
==================================================
 DELETED BUSINESS MESSAGES
==================================================
*/

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
  options = {}
) {
  if (!update) {
    return;
  }

  const token =
    options.token ||
    process.env.BOT_TOKEN ||
    "";

  /*
  Business connection
  */

  if (
    update.business_connection
  ) {
    await handleBusinessConnection(
      update
    );
  }

  /*
  New business message
  */

  if (
    update.business_message
  ) {
    await handleBusinessMessage(
      token,
      update
    );
  }

  /*
  Edited message
  */

  if (
    update.edited_business_message
  ) {
    await handleEditedBusinessMessage(
      update
    );
  }

  /*
  Deleted messages
  */

  if (
    update.deleted_business_messages
  ) {
    await handleDeletedBusinessMessages(
      update
    );
  }
}

/*
==================================================
 SCHEDULED DELETE PROCESSOR
==================================================
*/

async function processDueDeletes({
  token
}) {
  if (!token) {
    return;
  }

  const deletes =
    db.getDueDeletes();

  if (!deletes.length) {
    return;
  }

  for (
    const item of deletes
  ) {
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

      db.markDeleteError(
        item.id,
        error.message
      );

      /*
      Помечаем выполненным,
      чтобы одна сломанная задача
      не крутилась бесконечно.
      */

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

          error:
            error.message
        }
      });
    }
  }
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

  getBotInfo,

  setWebhook,

  deleteWebhook,

  handleUpdate,

  handleBusinessConnection,

  handleBusinessMessage,

  handleEditedBusinessMessage,

  handleDeletedBusinessMessages,

  processDueDeletes
};