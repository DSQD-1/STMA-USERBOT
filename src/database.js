const fs = require("fs");
const path = require("path");

/*
==================================================
DATABASE CONFIG
==================================================
*/

const DB_PATH =
  process.env.DB_PATH ||
  path.join(
    __dirname,
    "..",
    "stma-data.json"
  );

/*
==================================================
EMPTY DATABASE
==================================================
*/

const emptyDB = {
  version: 2,

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
CLONE
==================================================
*/

function clone(value) {
  return JSON.parse(
    JSON.stringify(value)
  );
}

/*
==================================================
LOAD DATABASE
==================================================
*/

function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const initial =
        clone(emptyDB);

      ensureDirectory();

      fs.writeFileSync(
        DB_PATH,
        JSON.stringify(
          initial,
          null,
          2
        ),
        "utf8"
      );

      return initial;
    }

    const raw =
      fs.readFileSync(
        DB_PATH,
        "utf8"
      );

    if (!raw.trim()) {
      return clone(emptyDB);
    }

    const parsed =
      JSON.parse(raw);

    return {
      ...clone(emptyDB),
      ...parsed,

      settings: {
        ...emptyDB.settings,
        ...(parsed.settings || {})
      },

      business_connections:
        Array.isArray(
          parsed.business_connections
        )
          ? parsed.business_connections
          : [],

      messages:
        Array.isArray(
          parsed.messages
        )
          ? parsed.messages
          : [],

      mutes:
        Array.isArray(
          parsed.mutes
        )
          ? parsed.mutes
          : [],

      watches:
        Array.isArray(
          parsed.watches
        )
          ? parsed.watches
          : [],

      events:
        Array.isArray(
          parsed.events
        )
          ? parsed.events
          : [],

      scheduled_deletes:
        Array.isArray(
          parsed.scheduled_deletes
        )
          ? parsed.scheduled_deletes
          : []
    };
  } catch (error) {
    console.error(
      "DATABASE LOAD ERROR:",
      error
    );

    return clone(emptyDB);
  }
}

/*
==================================================
 DATABASE STATE
==================================================
*/

let data = loadDB();

/*
==================================================
 DIRECTORY
==================================================
*/

function ensureDirectory() {
  const directory =
    path.dirname(DB_PATH);

  if (
    !fs.existsSync(directory)
  ) {
    fs.mkdirSync(
      directory,
      {
        recursive: true
      }
    );
  }
}

/*
==================================================
 SAVE DATABASE
==================================================
*/

function saveDB() {
  try {
    ensureDirectory();

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

    throw error;
  }
}

/*
==================================================
 DATABASE PATH
==================================================
*/

function getDatabasePath() {
  return DB_PATH;
}

/*
==================================================
 TIME
==================================================
*/

function now() {
  return Math.floor(
    Date.now() / 1000
  );
}

/*
==================================================
 ID
==================================================
*/

function nextId(collection) {
  if (!collection.length) {
    return 1;
  }

  let max = 0;

  for (const item of collection) {
    const id =
      Number(item.id) || 0;

    if (id > max) {
      max = id;
    }
  }

  return max + 1;
}

/*
==================================================
 SAFE JSON
==================================================
*/

function safeJSON(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return {};
  }

  if (
    typeof value === "object"
  ) {
    return value;
  }

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

  saveDB();

  return value;
}

/*
==================================================
 BUSINESS CONNECTIONS
==================================================
*/

/*
Telegram Business Connection
пример:

{
  id,
  user: {
    id,
    username,
    first_name,
    last_name
  },
  is_enabled
}
*/

function saveBusinessConnection(
  connection
) {
  if (!connection?.id) {
    throw new Error(
      "Business connection ID отсутствует"
    );
  }

  const timestamp =
    now();

  const index =
    data.business_connections.findIndex(
      row =>
        String(row.id) ===
        String(connection.id)
    );

  const old =
    index >= 0
      ? data.business_connections[
          index
        ]
      : null;

  const user =
    connection.user || {};

  const record = {
    id:
      connection.id,

    user_id:
      user.id ??
      old?.user_id ??
      null,

    username:
      user.username ??
      old?.username ??
      null,

    first_name:
      user.first_name ??
      old?.first_name ??
      null,

    last_name:
      user.last_name ??
      old?.last_name ??
      null,

    is_enabled:
      connection.is_enabled ===
        false
        ? 0
        : 1,

    created_at:
      old?.created_at ||
      timestamp,

    updated_at:
      timestamp
  };

  if (index >= 0) {
    data.business_connections[
      index
    ] = record;
  } else {
    data.business_connections.push(
      record
    );
  }

  saveDB();

  return record;
}

/*
Получить connection по ID
*/

function getBusinessConnection(
  id
) {
  return (
    data.business_connections.find(
      row =>
        String(row.id) ===
        String(id)
    ) || null
  );
}

/*
Получить активные connections
конкретного Telegram-пользователя
*/

function getConnectionsForUser(
  userId
) {
  return data.business_connections
    .filter(
      row =>
        Number(row.user_id) ===
          Number(userId) &&
        Number(row.is_enabled) === 1
    )
    .sort(
      (a, b) =>
        Number(b.updated_at || 0) -
        Number(a.updated_at || 0)
    );
}

/*
Получить активное соединение
конкретного пользователя
*/

function getActiveConnectionForUser(
  userId
) {
  return (
    getConnectionsForUser(
      userId
    )[0] || null
  );
}

/*
Получить любое активное соединение
*/

function getActiveConnection() {
  return (
    data.business_connections
      .filter(
        row =>
          Number(
            row.is_enabled
          ) === 1
      )
      .sort(
        (a, b) =>
          Number(b.updated_at || 0) -
          Number(a.updated_at || 0)
      )[0] || null
  );
}

/*
Отключить Business Connection
*/

function disableBusinessConnection(
  connectionId
) {
  const row =
    getBusinessConnection(
      connectionId
    );

  if (!row) {
    return false;
  }

  row.is_enabled = 0;
  row.updated_at = now();

  saveDB();

  return true;
}

/*
Включить Business Connection
*/

function enableBusinessConnection(
  connectionId
) {
  const row =
    getBusinessConnection(
      connectionId
    );

  if (!row) {
    return false;
  }

  row.is_enabled = 1;
  row.updated_at = now();

  saveDB();

  return true;
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
    message?.chat?.id ??
    message?.business_message
      ?.chat?.id ??
    null;

  const messageId =
    message?.message_id ??
    null;

  if (
    chatId === null ||
    messageId === null
  ) {
    return null;
  }

  const text =
    message?.text ||
    message?.caption ||
    "";

  const senderId =
    Number(
      message?.from?.id || 0
    );

  const senderUsername =
    message?.from?.username ||
    null;

  const senderName =
    [
      message?.from?.first_name,
      message?.from?.last_name
    ]
      .filter(Boolean)
      .join(" ") ||
    null;

  const existing =
    data.messages.find(
      row =>
        String(
          row.connection_id
        ) ===
          String(connectionId) &&
        Number(row.chat_id) ===
          Number(chatId) &&
        Number(row.message_id) ===
          Number(messageId)
    );

  if (existing) {
    existing.text =
      text;

    existing.sender_id =
      senderId;

    existing.sender_username =
      senderUsername;

    existing.sender_name =
      senderName;

    existing.edited_at =
      existing.edited_at ||
      null;

    saveDB();

    return existing;
  }

  const record = {
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

  data.messages.push(
    record
  );

  saveDB();

  return record;
}

/*
==================================================
 EDITED MESSAGE
==================================================
*/

function markEdited(
  message,
  connectionId
) {
  const chatId =
    message?.chat?.id;

  const messageId =
    message?.message_id;

  const row =
    data.messages.find(
      item =>
        String(
          item.connection_id
        ) ===
          String(connectionId) &&
        Number(item.chat_id) ===
          Number(chatId) &&
        Number(item.message_id) ===
          Number(messageId)
    );

  if (!row) {
    return false;
  }

  row.text =
    message?.text ||
    message?.caption ||
    "";

  row.edited_at =
    now();

  saveDB();

  return true;
}

/*
==================================================
 DELETED MESSAGE
==================================================
*/

function markDeleted(
  connectionId,
  chatId,
  messageIds
) {
  if (
    !Array.isArray(
      messageIds
    ) ||
    !messageIds.length
  ) {
    return 0;
  }

  let changed = 0;

  const timestamp =
    now();

  for (
    const messageId of messageIds
  ) {
    const row =
      data.messages.find(
        item =>
          String(
            item.connection_id
          ) ===
            String(connectionId) &&
          Number(item.chat_id) ===
            Number(chatId) &&
          Number(item.message_id) ===
            Number(messageId)
      );

    if (row) {
      row.deleted_at =
        timestamp;

      changed++;
    }
  }

  if (changed > 0) {
    saveDB();
  }

  return changed;
}

/*
==================================================
 GET HISTORY
==================================================
*/

function getHistory(
  connectionId,
  limit = 100
) {
  return data.messages
    .filter(
      row =>
        String(
          row.connection_id
        ) ===
        String(connectionId)
    )
    .sort(
      (a, b) =>
        Number(b.created_at || 0) -
        Number(a.created_at || 0)
    )
    .slice(
      0,
      Number(limit) || 100
    );
}

/*
==================================================
 MUTES
==================================================
*/

function addMute(
  connectionId,
  userId,
  username = null,
  expiresAt = null
) {
  const numericUserId =
    Number(userId);

  if (
    !Number.isSafeInteger(
      numericUserId
    ) ||
    numericUserId <= 0
  ) {
    throw new Error(
      "Некорректный Telegram ID"
    );
  }

  const existing =
    data.mutes.find(
      row =>
        String(
          row.connection_id
        ) ===
          String(connectionId) &&
        Number(row.user_id) ===
          numericUserId
    );

  if (existing) {
    existing.username =
      username ||
      existing.username ||
      null;

    existing.expires_at =
      expiresAt === undefined
        ? existing.expires_at
        : expiresAt;

    existing.updated_at =
      now();

    saveDB();

    return existing;
  }

  const record = {
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
      now(),

    updated_at:
      now()
  };

  data.mutes.push(
    record
  );

  saveDB();

  return record;
}

function removeMute(
  connectionId,
  userId
) {
  const numericUserId =
    Number(userId);

  const before =
    data.mutes.length;

  data.mutes =
    data.mutes.filter(
      row =>
        !(
          String(
            row.connection_id
          ) ===
            String(connectionId) &&
          Number(row.user_id) ===
            numericUserId
        )
    );

  const removed =
    before -
    data.mutes.length;

  if (removed > 0) {
    saveDB();
  }

  return removed;
}

function isMuted(
  connectionId,
  userId
) {
  const numericUserId =
    Number(userId);

  const row =
    data.mutes.find(
      item =>
        String(
          item.connection_id
        ) ===
          String(connectionId) &&
        Number(item.user_id) ===
          numericUserId
    );

  if (!row) {
    return false;
  }

  if (
    row.expires_at !== null &&
    Number(row.expires_at) <=
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

  const before =
    data.mutes.length;

  data.mutes =
    data.mutes.filter(
      row =>
        row.expires_at === null ||
        Number(row.expires_at) >
          timestamp
    );

  if (
    before !==
    data.mutes.length
  ) {
    saveDB();
  }

  return data.mutes
    .filter(
      row =>
        String(
          row.connection_id
        ) ===
        String(connectionId)
    )
    .sort(
      (a, b) =>
        Number(
          b.created_at || 0
        ) -
        Number(
          a.created_at || 0
        )
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
    String(
      target || ""
    ).trim();

  if (!cleanTarget) {
    throw new Error(
      "Укажи username или Telegram ID"
    );
  }

  /*
  Не даём создать одну и ту же
  слежку повторно.
  */

  const existing =
    data.watches.find(
      row =>
        String(
          row.connection_id
        ) ===
          String(connectionId) &&
        String(
          row.target
        ).toLowerCase() ===
          cleanTarget.toLowerCase() &&
        Number(row.enabled) === 1
    );

  if (existing) {
    return existing;
  }

  const activeCount =
    data.watches.filter(
      row =>
        String(
          row.connection_id
        ) ===
          String(connectionId) &&
        Number(row.enabled) === 1
    ).length;

  if (activeCount >= 10) {
    throw new Error(
      "Максимум 10 активных слежек"
    );
  }

  const timestamp =
    now();

  const record = {
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

  data.watches.push(
    record
  );

  saveDB();

  return {
    ...record,

    lastInsertRowid:
      record.id
  };
}

function getWatches(
  connectionId
) {
  return data.watches
    .filter(
      row =>
        String(
          row.connection_id
        ) ===
        String(connectionId)
    )
    .sort(
      (a, b) =>
        Number(
          b.created_at || 0
        ) -
        Number(
          a.created_at || 0
        )
    );
}

function removeWatch(
  connectionId,
  id
) {
  const numericId =
    Number(id);

  const before =
    data.watches.length;

  data.watches =
    data.watches.filter(
      row =>
        !(
          String(
            row.connection_id
          ) ===
            String(connectionId) &&
          Number(row.id) ===
            numericId
        )
    );

  const removed =
    before -
    data.watches.length;

  if (removed > 0) {
    saveDB();
  }

  return removed;
}

function updateWatch(
  connectionId,
  id,
  values = {}
) {
  const row =
    data.watches.find(
      item =>
        String(
          item.connection_id
        ) ===
          String(connectionId) &&
        Number(item.id) ===
          Number(id)
    );

  if (!row) {
    return null;
  }

  if (
    values.target !== undefined
  ) {
    row.target =
      String(
        values.target
      ).trim();
  }

  if (
    values.enabled !== undefined
  ) {
    row.enabled =
      values.enabled
        ? 1
        : 0;
  }

  if (
    values.last_data !==
    undefined
  ) {
    row.last_data =
      values.last_data;
  }

  row.updated_at =
    now();

  saveDB();

  return row;
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
  const record = {
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

  data.events.push(
    record
  );

  saveDB();

  return record;
}

function getEvents(
  connectionId,
  limit = 100
) {
  return data.events
    .filter(
      row =>
        String(
          row.connection_id
        ) ===
        String(connectionId)
    )
    .sort(
      (a, b) =>
        Number(
          b.created_at || 0
        ) -
        Number(
          a.created_at || 0
        )
    )
    .slice(
      0,
      Number(limit) || 100
    )
    .map(
      row => ({
        ...row,
        data:
          safeJSON(row.data)
      })
    );
}

/*
==================================================
 SCHEDULED DELETE
==================================================
*/

function scheduleDelete(
  connectionId,
  chatId,
  messageId,
  deleteAt
) {
  const record = {
    id:
      nextId(
        data.scheduled_deletes
      ),

    connection_id:
      connectionId,

    chat_id:
      chatId,

    message_id:
      messageId,

    delete_at:
      Number(deleteAt),

    done:
      0,

    created_at:
      now(),

    error:
      null
  };

  data.scheduled_deletes.push(
    record
  );

  saveDB();

  return record;
}

function getDueDeletes() {
  return data.scheduled_deletes
    .filter(
      row =>
        Number(row.done) === 0 &&
        Number(row.delete_at) <=
          now()
    )
    .sort(
      (a, b) =>
        Number(
          a.delete_at || 0
        ) -
        Number(
          b.delete_at || 0
        )
    );
}

function markDeleteDone(
  id
) {
  const row =
    data.scheduled_deletes.find(
      item =>
        Number(item.id) ===
        Number(id)
    );

  if (!row) {
    return false;
  }

  row.done = 1;
  row.completed_at =
    now();

  saveDB();

  return true;
}

function markDeleteError(
  id,
  error
) {
  const row =
    data.scheduled_deletes.find(
      item =>
        Number(item.id) ===
        Number(id)
    );

  if (!row) {
    return false;
  }

  row.error =
    String(error || "");

  row.updated_at =
    now();

  saveDB();

  return true;
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
      row =>
        String(
          row.connection_id
        ) ===
        String(connectionId)
    ).length;

  const edits =
    data.messages.filter(
      row =>
        String(
          row.connection_id
        ) ===
          String(connectionId) &&
        row.edited_at !== null
    ).length;

  const deleted =
    data.messages.filter(
      row =>
        String(
          row.connection_id
        ) ===
          String(connectionId) &&
        row.deleted_at !== null
    ).length;

  const events =
    data.events.filter(
      row =>
        String(
          row.connection_id
        ) ===
        String(connectionId)
    ).length;

  const mutes =
    data.mutes.filter(
      row =>
        String(
          row.connection_id
        ) ===
          String(connectionId) &&
        (
          row.expires_at === null ||
          Number(row.expires_at) >
            now()
        )
    ).length;

  const watches =
    data.watches.filter(
      row =>
        String(
          row.connection_id
        ) ===
          String(connectionId) &&
        Number(row.enabled) === 1
    ).length;

  return {
    messages,
    edits,
    deleted,
    events,
    mutes,
    watches
  };
}

/*
==================================================
 DATABASE OBJECT
==================================================

Оставляем совместимость со старым кодом,
если где-то используется db.prepare().
==================================================
*/

const db = {
  prepare(sql) {
    const normalized =
      String(sql)
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    return {
      all(...params) {
        if (
          normalized.includes(
            "from business_connections"
          )
        ) {
          const userId =
            Number(params[0]);

          return getConnectionsForUser(
            userId
          );
        }

        return [];
      },

      get(...params) {
        if (
          normalized.includes(
            "from business_connections"
          )
        ) {
          const userId =
            Number(params[0]);

          return getActiveConnectionForUser(
            userId
          );
        }

        return undefined;
      },

      run() {
        return {
          changes: 0
        };
      }
    };
  }
};

/*
==================================================
 EXPORT
==================================================
*/

module.exports = {
  /*
  compatibility
  */

  db,

  /*
  database
  */

  getDatabasePath,

  /*
  settings
  */

  getSetting,
  setSetting,

  /*
  business
  */

  saveBusinessConnection,
  getBusinessConnection,

  getConnectionsForUser,
  getActiveConnectionForUser,
  getActiveConnection,

  enableBusinessConnection,
  disableBusinessConnection,

  /*
  messages
  */

  saveMessage,
  markEdited,
  markDeleted,
  getHistory,

  /*
  mutes
  */

  addMute,
  removeMute,
  isMuted,
  getMutes,

  /*
  watches
  */

  addWatch,
  getWatches,
  removeWatch,
  updateWatch,

  /*
  events
  */

  addEvent,
  getEvents,

  /*
  scheduled deletes
  */

  scheduleDelete,
  getDueDeletes,
  markDeleteDone,
  markDeleteError,

  /*
  stats
  */

  getStats
};