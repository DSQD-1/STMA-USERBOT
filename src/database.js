const fs = require("fs");
const path = require("path");

/*
==================================================
STMA DATABASE
==================================================

Без better-sqlite3 и без native-модулей.

Данные хранятся в JSON-файле.
Для Render это проще и не требует компиляции
нативных зависимостей.

Для постоянного хранения на Render позже
можно подключить Disk или внешнюю БД.
==================================================
*/

const DB_PATH =
  process.env.DB_PATH ||
  path.join(__dirname, "..", "stma-data.json");

const DEFAULT_DATA = {
  settings: {},

  business_connections: [],

  messages: [],

  mutes: [],

  watches: [],

  events: [],

  scheduled_deletes: []
};


/*
==================================================
LOAD / SAVE
==================================================
*/

function cloneDefaultData() {
  return JSON.parse(
    JSON.stringify(DEFAULT_DATA)
  );
}

function ensureDatabase() {
  const directory =
    path.dirname(DB_PATH);

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, {
      recursive: true
    });
  }

  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(
      DB_PATH,
      JSON.stringify(
        DEFAULT_DATA,
        null,
        2
      ),
      "utf8"
    );
  }
}

function loadDatabase() {
  ensureDatabase();

  try {
    const raw =
      fs.readFileSync(
        DB_PATH,
        "utf8"
      );

    const data =
      JSON.parse(raw);

    return {
      ...cloneDefaultData(),
      ...data
    };
  } catch (error) {
    console.error(
      "DATABASE LOAD ERROR:",
      error
    );

    return cloneDefaultData();
  }
}

let data = loadDatabase();

let saveTimer = null;

function saveDatabase() {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(
    () => {
      try {
        const tempPath =
          `${DB_PATH}.tmp`;

        fs.writeFileSync(
          tempPath,
          JSON.stringify(
            data,
            null,
            2
          ),
          "utf8"
        );

        fs.renameSync(
          tempPath,
          DB_PATH
        );
      } catch (error) {
        console.error(
          "DATABASE SAVE ERROR:",
          error
        );
      }
    },
    50
  );
}


/*
==================================================
HELPERS
==================================================
*/

function now() {
  return Math.floor(
    Date.now() / 1000
  );
}

function nextId(list) {
  if (!list.length) {
    return 1;
  }

  return (
    Math.max(
      ...list.map(
        item =>
          Number(item.id) || 0
      )
    ) + 1
  );
}

function safeJSON(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}


/*
==================================================
SETTINGS
==================================================
*/

function getSetting(key) {
  return (
    data.settings[key] ??
    null
  );
}

function setSetting(
  key,
  value
) {
  data.settings[key] =
    String(value);

  saveDatabase();

  return value;
}


/*
==================================================
BUSINESS CONNECTIONS
==================================================
*/

function saveBusinessConnection(c) {
  if (!c || !c.id) {
    throw new Error(
      "Business connection ID отсутствует"
    );
  }

  const timestamp =
    now();

  const existing =
    data.business_connections.find(
      item =>
        item.id === c.id
    );

  const connection = {
    id: c.id,

    user_id:
      c.user?.id ??
      c.user_id ??
      null,

    username:
      c.user?.username ??
      c.username ??
      null,

    first_name:
      c.user?.first_name ??
      c.first_name ??
      null,

    is_enabled:
      c.is_enabled === false
        ? 0
        : 1,

    created_at:
      existing?.created_at ??
      timestamp,

    updated_at:
      timestamp
  };

  if (existing) {
    Object.assign(
      existing,
      connection
    );
  } else {
    data.business_connections.push(
      connection
    );
  }

  saveDatabase();

  return connection;
}

function getBusinessConnection(id) {
  return (
    data.business_connections.find(
      item =>
        item.id === id
    ) || null
  );
}

function getActiveConnection() {
  return (
    [...data.business_connections]
      .filter(
        item =>
          item.is_enabled === 1
      )
      .sort(
        (a, b) =>
          b.updated_at -
          a.updated_at
      )[0] || null
  );
}

function getConnectionsForUser(
  userId
) {
  return data.business_connections
    .filter(
      item =>
        Number(item.user_id) ===
          Number(userId) &&
        item.is_enabled === 1
    )
    .sort(
      (a, b) =>
        b.updated_at -
        a.updated_at
    );
}


/*
==================================================
MESSAGES
==================================================
*/

function saveMessage(
  message,
  connectionId
) {
  if (!message) {
    return null;
  }

  const chatId =
    Number(
      message.chat?.id || 0
    );

  const messageId =
    Number(
      message.message_id || 0
    );

  if (!chatId || !messageId) {
    return null;
  }

  const text =
    message.text ||
    message.caption ||
    "";

  const senderId =
    Number(
      message.from?.id || 0
    );

  const senderUsername =
    message.from?.username ||
    null;

  const senderName =
    [
      message.from?.first_name,
      message.from?.last_name
    ]
      .filter(Boolean)
      .join(" ") || null;

  const existing =
    data.messages.find(
      item =>
        item.connection_id ===
          connectionId &&
        Number(item.chat_id) ===
          chatId &&
        Number(item.message_id) ===
          messageId
    );

  if (existing) {
    existing.text = text;

    existing.sender_id =
      senderId;

    existing.sender_username =
      senderUsername;

    existing.sender_name =
      senderName;

    saveDatabase();

    return existing;
  }

  const item = {
    id:
      nextId(data.messages),

    connection_id:
      connectionId,

    chat_id:
      chatId,

    message_id:
      messageId,

    sender_id:
      senderId,

    sender_username:
      senderUsername,

    sender_name:
      senderName,

    text,

    created_at:
      now(),

    edited_at:
      null,

    deleted_at:
      null
  };

  data.messages.push(item);

  saveDatabase();

  return item;
}

function markEdited(
  message,
  connectionId
) {
  const item =
    data.messages.find(
      row =>
        row.connection_id ===
          connectionId &&
        Number(row.chat_id) ===
          Number(message?.chat?.id) &&
        Number(row.message_id) ===
          Number(message?.message_id)
    );

  if (!item) {
    return;
  }

  item.text =
    message?.text ||
    message?.caption ||
    "";

  item.edited_at =
    now();

  saveDatabase();
}

function markDeleted(
  connectionId,
  chatId,
  messageIds
) {
  if (
    !Array.isArray(
      messageIds
    )
  ) {
    return;
  }

  const timestamp =
    now();

  for (
    const messageId of messageIds
  ) {
    const item =
      data.messages.find(
        row =>
          row.connection_id ===
            connectionId &&
          Number(row.chat_id) ===
            Number(chatId) &&
          Number(row.message_id) ===
            Number(messageId)
      );

    if (item) {
      item.deleted_at =
        timestamp;
    }
  }

  saveDatabase();
}


/*
==================================================
MUTES
==================================================
*/

function addMute(
  connectionId,
  userId,
  username,
  expiresAt
) {
  const numericUserId =
    Number(userId);

  const existing =
    data.mutes.find(
      item =>
        item.connection_id ===
          connectionId &&
        Number(item.user_id) ===
          numericUserId
    );

  if (existing) {
    existing.username =
      username || null;

    existing.expires_at =
      expiresAt ?? null;

    saveDatabase();

    return existing;
  }

  const item = {
    id:
      nextId(data.mutes),

    connection_id:
      connectionId,

    user_id:
      numericUserId,

    username:
      username || null,

    expires_at:
      expiresAt ?? null,

    created_at:
      now()
  };

  data.mutes.push(item);

  saveDatabase();

  return item;
}

function removeMute(
  connectionId,
  userId
) {
  const numericUserId =
    Number(userId);

  data.mutes =
    data.mutes.filter(
      item =>
        !(
          item.connection_id ===
            connectionId &&
          Number(item.user_id) ===
            numericUserId
        )
    );

  saveDatabase();
}

function isMuted(
  connectionId,
  userId
) {
  const numericUserId =
    Number(userId);

  const item =
    data.mutes.find(
      row =>
        row.connection_id ===
          connectionId &&
        Number(row.user_id) ===
          numericUserId
    );

  if (!item) {
    return false;
  }

  if (
    item.expires_at !==
      null &&
    Number(item.expires_at) <=
      now()
  ) {
    removeMute(
      connectionId,
      numericUserId
    );

    return false;
  }

  return true;
}

function getMutes(
  connectionId
) {
  const timestamp =
    now();

  data.mutes =
    data.mutes.filter(
      item =>
        item.expires_at ===
          null ||
        Number(item.expires_at) >
          timestamp
    );

  saveDatabase();

  return data.mutes
    .filter(
      item =>
        item.connection_id ===
        connectionId
    )
    .sort(
      (a, b) =>
        b.created_at -
        a.created_at
    );
}


/*
==================================================
WATCHES
==================================================
*/

function addWatch(
  connectionId,
  target
) {
  const cleanTarget =
    String(target || "")
      .trim();

  if (!cleanTarget) {
    throw new Error(
      "Цель слежки не указана"
    );
  }

  const activeCount =
    data.watches.filter(
      item =>
        item.connection_id ===
          connectionId &&
        item.enabled === 1
    ).length;

  if (activeCount >= 10) {
    throw new Error(
      "Максимум 10 активных слежек"
    );
  }

  const duplicate =
    data.watches.find(
      item =>
        item.connection_id ===
          connectionId &&
        item.enabled === 1 &&
        item.target.toLowerCase() ===
          cleanTarget.toLowerCase()
    );

  if (duplicate) {
    throw new Error(
      "Эта цель уже добавлена"
    );
  }

  const timestamp =
    now();

  const item = {
    id:
      nextId(data.watches),

    connection_id:
      connectionId,

    target:
      cleanTarget,

    enabled:
      1,

    last_data:
      null,

    created_at:
      timestamp,

    updated_at:
      timestamp
  };

  data.watches.push(item);

  saveDatabase();

  return item;
}

function getWatches(
  connectionId
) {
  return data.watches
    .filter(
      item =>
        item.connection_id ===
        connectionId
    )
    .sort(
      (a, b) =>
        b.created_at -
        a.created_at
    );
}

function removeWatch(
  connectionId,
  id
) {
  const numericId =
    Number(id);

  data.watches =
    data.watches.filter(
      item =>
        !(
          item.connection_id ===
            connectionId &&
          Number(item.id) ===
            numericId
        )
    );

  saveDatabase();
}


/*
==================================================
EVENTS
==================================================
*/

function addEvent({
  connectionId,
  type,
  chatId = null,
  messageId = null,
  data: eventData = {}
}) {
  const item = {
    id:
      nextId(data.events),

    connection_id:
      connectionId,

    type,

    chat_id:
      chatId,

    message_id:
      messageId,

    data:
      JSON.stringify(
        eventData
      ),

    created_at:
      now()
  };

  data.events.push(item);

  saveDatabase();

  return item;
}

function getEvents(
  connectionId,
  limit = 100
) {
  return data.events
    .filter(
      item =>
        item.connection_id ===
        connectionId
    )
    .sort(
      (a, b) =>
        b.created_at -
        a.created_at
    )
    .slice(
      0,
      Number(limit)
    )
    .map(item => ({
      ...item,
      data:
        safeJSON(item.data)
    }));
}


/*
==================================================
SCHEDULED DELETES
==================================================
*/

function scheduleDelete(
  connectionId,
  chatId,
  messageId,
  deleteAt
) {
  const item = {
    id:
      nextId(
        data.scheduled_deletes
      ),

    connection_id:
      connectionId,

    chat_id:
      Number(chatId),

    message_id:
      Number(messageId),

    delete_at:
      Number(deleteAt),

    done:
      0,

    created_at:
      now()
  };

  data.scheduled_deletes.push(
    item
  );

  saveDatabase();

  return item;
}

function getDueDeletes() {
  return data.scheduled_deletes
    .filter(
      item =>
        item.done === 0 &&
        Number(item.delete_at) <=
          now()
    )
    .sort(
      (a, b) =>
        a.delete_at -
        b.delete_at
    );
}

function markDeleteDone(id) {
  const item =
    data.scheduled_deletes.find(
      row =>
        Number(row.id) ===
        Number(id)
    );

  if (!item) {
    return;
  }

  item.done = 1;

  saveDatabase();
}


/*
==================================================
HISTORY
==================================================
*/

function getHistory(
  connectionId,
  limit = 100
) {
  return data.messages
    .filter(
      item =>
        item.connection_id ===
        connectionId
    )
    .sort(
      (a, b) =>
        b.created_at -
        a.created_at
    )
    .slice(
      0,
      Number(limit)
    );
}


/*
==================================================
STATS
==================================================
*/

function getStats(
  connectionId
) {
  const messages =
    data.messages.filter(
      item =>
        item.connection_id ===
        connectionId
    ).length;

  const edits =
    data.messages.filter(
      item =>
        item.connection_id ===
          connectionId &&
        item.edited_at !== null
    ).length;

  const deleted =
    data.messages.filter(
      item =>
        item.connection_id ===
          connectionId &&
        item.deleted_at !== null
    ).length;

  const events =
    data.events.filter(
      item =>
        item.connection_id ===
        connectionId
    ).length;

  return {
    messages,
    edits,
    deleted,
    events
  };
}


/*
==================================================
EXPORT
==================================================
*/

module.exports = {
  getSetting,
  setSetting,

  saveBusinessConnection,
  getBusinessConnection,
  getActiveConnection,
  getConnectionsForUser,

  saveMessage,
  markEdited,
  markDeleted,

  addMute,
  removeMute,
  isMuted,
  getMutes,

  addWatch,
  getWatches,
  removeWatch,

  addEvent,
  getEvents,

  scheduleDelete,
  getDueDeletes,
  markDeleteDone,

  getHistory,
  getStats,

  // Для диагностики
  getDatabasePath() {
    return DB_PATH;
  }
};