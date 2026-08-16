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
 DELETE BUSINESS MESSAGES
==================================================

Актуальный Business API:
deleteBusinessMessages

Можно удалить 1-100 сообщений
одного чата.

==================================================
*/

async function deleteBusinessMessages(
  token,
  businessConnectionId,
  messageIds
) {
  const ids =
    Array.isArray(messageIds)
      ? messageIds
      : [messageIds];

  const cleanIds =
    ids
      .map(Number)
      .filter(
        Number.isInteger
      );

  if (!cleanIds.length) {
    throw new Error(
      "Нет корректных message_id"
    );
  }

  return telegramRequest(
    token,
    "deleteBusinessMessages",
    {
      business_connection_id:
        businessConnectionId,

      message_ids:
        cleanIds.slice(0, 100)
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
  businessConnectionId,
  chatId,
  messageId
) {
  /*
  chatId здесь оставляем
  для совместимости со старым кодом.

  Telegram Business API для
  deleteBusinessMessages требует
  только connection_id + message_ids.
  */

  return deleteBusinessMessages(
    token,
    businessConnectionId,
    [messageId]
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

      /*
      Нам нужны именно Business updates.
      */

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
        ),

      rights:
        connection.rights ||
        null
    }
  });

  console.log(
    "BUSINESS CONNECTION:",
    saved
  );

  return saved;
}


/*
==================================================
 RESOLVE WATCH / MUTE TARGET
==================================================
*/

/*
Telegram ID:

123456789
@username

Мы определяем ID по сообщениям,
которые уже видел STMA.
*/

function normalizeUsername(
  username
) {
  return String(
    username || ""
  )
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}


/*
Проверка:
находится ли sender в муте.

Сначала проверяем ID.

Если в муте username —
сопоставляем username отправителя.
*/

function isSenderMuted(
  connectionId,
  senderId,
  senderUsername
) {
  /*
  1. Проверка по Telegram ID
  */

  if (
    senderId &&
    db.isMuted(
      connectionId,
      senderId
    )
  ) {
    return true;
  }

  /*
  2. Проверка по username
  */

  const username =
    normalizeUsername(
      senderUsername
    );

  if (!username) {
    return false;
  }

  const mutes =
    db.getMutes(
      connectionId
    );

  return mutes.some(
    mute =>
      normalizeUsername(
        mute.username
      ) === username
  );
}


/*
==================================================
 REGISTER USERNAME
==================================================
*/

/*
Если пользователь был добавлен
в мут по @username, а Telegram
прислал его ID, обновляем запись.

Это позволяет дальше работать
надёжно по ID.
*/

function upgradeMuteUsernameToId(
  connectionId,
  senderId,
  senderUsername
) {
  if (
    !senderId ||
    !senderUsername
  ) {
    return;
  }

  const username =
    normalizeUsername(
      senderUsername
    );

  if (!username) {
    return;
  }

  const mutes =
    db.getMutes(
      connectionId
    );

  const mute =
    mutes.find(
      item =>
        normalizeUsername(
          item.username
        ) === username
    );

  if (!mute) {
    return;
  }

  /*
  Создаём/обновляем мут
  уже с настоящим Telegram ID.
  */

  db.addMute(
    connectionId,
    senderId,
    senderUsername,
    mute.expires_at
  );

  /*
  Старую username-запись удалять
  нельзя напрямую, потому что
  текущая база идентифицирует мут
  по user_id.

  Новый ID уже будет главным.
  */
}


/*
==================================================
 HANDLE MUTED MESSAGE
==================================================
*/

async function processMute(
  message,
  connectionId
) {
  const senderId =
    Number(
      message?.from?.id || 0
    );

  const senderUsername =
    message?.from?.username ||
    null;

  if (!senderId) {
    return false;
  }

  /*
  Если мут задан по @username,
  привязываем его к ID.
  */

  upgradeMuteUsernameToId(
    connectionId,
    senderId,
    senderUsername
  );

  const muted =
    isSenderMuted(
      connectionId,
      senderId,
      senderUsername
    );

  if (!muted) {
    return false;
  }

  const messageId =
    Number(
      message?.message_id || 0
    );

  if (!messageId) {
    return false;
  }

  try {
    await deleteBusinessMessages(
      process.env.BOT_TOKEN,
      connectionId,
      [messageId]
    );

    db.markDeleted(
      connectionId,
      message.chat?.id,
      [messageId]
    );

    db.addEvent({
      connectionId,

      type:
        "muted_message_deleted",

      chatId:
        message.chat?.id ||
        null,

      messageId,

      data: {
        senderId,

        senderUsername,

        reason:
          "active_mute"
      }
    });

    console.log(
      `MUTED MESSAGE DELETED: ${senderId} ${senderUsername || ""} #${messageId}`
    );

    return true;
  } catch (error) {
    console.error(
      "MUTED MESSAGE DELETE ERROR:",
      error.message
    );

    db.addEvent({
      connectionId,

      type:
        "muted_message_delete_error",

      chatId:
        message.chat?.id ||
        null,

      messageId,

      data: {
        senderId,

        senderUsername,

        error:
          error.message
      }
    });

    return false;
  }
}


/*
==================================================
 NEW BUSINESS MESSAGE
==================================================
*/

async function handleBusinessMessage(
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
  Сначала сохраняем сообщение.
  */

  db.saveMessage(
    message,
    connectionId
  );

  /*
  Затем проверяем мут.
  Если пользователь замьючен —
  сообщение удаляется.
  */

  const deleted =
    await processMute(
      message,
      connectionId
    );

  /*
  Даже если сообщение удалили,
  событие получения сохраняем.
  */

  db.addEvent({
    connectionId,

    type:
      deleted
        ? "message_muted"
        : "message",

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

      muted:
        deleted
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

  /*
  Если пользователь редактирует
  сообщение во время мута —
  тоже удаляем его.
  */

  const deleted =
    await processMute(
      message,
      connectionId
    );

  if (!deleted) {
    db.markEdited(
      message,
      connectionId
    );
  }

  db.addEvent({
    connectionId,

    type:
      deleted
        ? "muted_edited_message"
        : "message_edited",

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

      muted:
        deleted
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

  try {
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
  } catch (error) {
    console.error(
      "HANDLE UPDATE ERROR:",
      error
    );

    throw error;
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
  const deletes =
    db.getDueDeletes();

  if (!deletes.length) {
    return;
  }

  for (const item of deletes) {
    try {
      await deleteBusinessMessages(
        token,
        item.connection_id,
        [item.message_id]
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

      /*
      Не теряем запись.
      */

      db.markDeleteError(
        item.id,
        error.message
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

  deleteBusinessMessages,

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