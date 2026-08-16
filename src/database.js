const fs = require("fs");
const path = require("path");

const DB_PATH =
  process.env.DB_PATH ||
  path.join(__dirname, "..", "stma-data.json");

const emptyDB = {
  settings: {},
  business_connections: [],
  messages: [],
  mutes: [],
  watches: [],
  events: [],
  scheduled_deletes: []
};

function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(
        DB_PATH,
        JSON.stringify(emptyDB, null, 2),
        "utf8"
      );

      return structuredClone(emptyDB);
    }

    const raw = fs.readFileSync(DB_PATH, "utf8");

    const data = JSON.parse(raw);

    return {
      ...structuredClone(emptyDB),
      ...data
    };
  } catch (error) {
    console.error("DATABASE LOAD ERROR:", error);

    return structuredClone(emptyDB);
  }
}

let data = loadDB();

function saveDB() {
  const tempPath = `${DB_PATH}.tmp`;

  fs.writeFileSync(
    tempPath,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  fs.renameSync(
    tempPath,
    DB_PATH
  );
}

function now() {
  return Math.floor(Date.now() / 1000);
}

function nextId(collection) {
  if (!collection.length) {
    return 1;
  }

  return (
    Math.max(
      ...collection.map(
        item => Number(item.id) || 0
      )
    ) + 1
  );
}

/*
==================================================
COMPATIBILITY DB API
==================================================

server.js использует:

db.db.prepare(...).all(...)
db.db.prepare(...).get(...)

Здесь мы сохраняем совместимый интерфейс
без native SQLite.
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

          return data.business_connections
            .filter(
              row =>
                Number(row.user_id) === userId &&
                Number(row.is_enabled) === 1
            )
            .sort(
              (a, b) =>
                Number(b.updated_at || 0) -
                Number(a.updated_at || 0)
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

          return data.business_connections
            .filter(
              row =>
                Number(row.user_id) === userId &&
                Number(row.is_enabled) === 1
            )
            .sort(
              (a, b) =>
                Number(b.updated_at || 0) -
                Number(a.updated_at || 0)
            )[0];
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

/* ==================================================
   SETTINGS
================================================== */

function getSetting(key) {
  return (
    data.settings[key] ??
    null
  );
}

function setSetting(key, value) {
  data.settings[key] =
    String(value);

  saveDB();

  return value;
}

/* ==================================================
   BUSINESS CONNECTION
================================================== */

function saveBusinessConnection(c) {
  const timestamp = now();

  const index =
    data.business_connections.findIndex(
      row => row.id === c.id
    );

  const record = {
    id: c.id,
    user_id:
      c.user?.id || null,
    username:
      c.user?.username || null,
    first_name:
      c.user?.first_name || null,
    is_enabled:
      c.is_enabled ? 1 : 0,
    created_at:
      index >= 0
        ? data.business_connections[index]
            .created_at
        : timestamp,
    updated_at: timestamp
  };

  if (index >= 0) {
    data.business_connections[index] =
      record;
  } else {
    data.business_connections.push(
      record
    );
  }

  saveDB();

  return record;
}

function getBusinessConnection(id) {
  return (
    data.business_connections.find(
      row => row.id === id
    ) || null
  );
}

function getActiveConnection() {
  return (
    data.business_connections
      .filter(
        row =>
          Number(row.is_enabled) === 1
      )
      .sort(
        (a, b) =>
          Number(b.updated_at || 0) -
          Number(a.updated_at || 0)
      )[0] || null
  );
}

/* ==================================================
   MESSAGES
================================================== */

function saveMessage(
  message,
  connectionId
) {
  const chatId =
    message?.chat?.id ?? null;

  const messageId =
    message?.message_id ?? null;

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
      .join(" ") || null;

  const existing =
    data.messages.find(
      row =>
        row.connection_id ===
          connectionId &&
        Number(row.chat_id) ===
          Number(chatId) &&
        Number(row.message_id) ===
          Number(messageId)
    );

  if (existing) {
    existing.text = text;
    existing.sender_username =
      senderUsername;
    existing.sender_name =
      senderName;
  } else {
    data.messages.push({
      id: nextId(data.messages),
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
      created_at: now(),
      edited_at: null,
      deleted_at: null
    });
  }

  saveDB();
}

function markEdited(
  message,
  connectionId
) {
  const row =
    data.messages.find(
      item =>
        item.connection_id ===
          connectionId &&
        Number(item.chat_id) ===
          Number(message?.chat?.id) &&
        Number(item.message_id) ===
          Number(message?.message_id)
    );

  if (!row) {
    return;
  }

  row.text =
    message?.text ||
    message?.caption ||
    "";

  row.edited_at = now();

  saveDB();
}

function markDeleted(
  connectionId,
  chatId,
  messageIds
) {
  if (!messageIds?.length) {
    return;
  }

  const timestamp = now();

  for (const messageId of messageIds) {
    const row =
      data.messages.find(
        item =>
          item.connection_id ===
            connectionId &&
          Number(item.chat_id) ===
            Number(chatId) &&
          Number(item.message_id) ===
            Number(messageId)
      );

    if (row) {
      row.deleted_at =
        timestamp;
    }
  }

  saveDB();
}

/* ==================================================
   MUTES
================================================== */

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
      row =>
        row.connection_id ===
          connectionId &&
        Number(row.user_id) ===
          numericUserId
    );

  if (existing) {
    existing.username =
      username || null;

    existing.expires_at =
      expiresAt;

    saveDB();

    return;
  }

  data.mutes.push({
    id: nextId(data.mutes),
    connection_id:
      connectionId,
    user_id:
      numericUserId,
    username:
      username || null,
    expires_at:
      expiresAt,
    created_at:
      now()
  });

  saveDB();
}

function removeMute(
  connectionId,
  userId
) {
  const numericUserId =
    Number(userId);

  data.mutes =
    data.mutes.filter(
      row =>
        !(
          row.connection_id ===
            connectionId &&
          Number(row.user_id) ===
            numericUserId
        )
    );

  saveDB();
}

function isMuted(
  connectionId,
  userId
) {
  const row =
    data.mutes.find(
      item =>
        item.connection_id ===
          connectionId &&
        Number(item.user_id) ===
          Number(userId)
    );

  if (!row) {
    return false;
  }

  if (
    row.expires_at !== null &&
    Number(row.expires_at) <= now()
  ) {
    removeMute(
      connectionId,
      userId
    );

    return false;
  }

  return true;
}

function getMutes(connectionId) {
  const timestamp = now();

  data.mutes =
    data.mutes.filter(
      row =>
        row.expires_at === null ||
        Number(row.expires_at) >
          timestamp
    );

  saveDB();

  return data.mutes
    .filter(
      row =>
        row.connection_id ===
        connectionId
    )
    .sort(
      (a, b) =>
        Number(b.created_at || 0) -
        Number(a.created_at || 0)
    );
}

/* ==================================================
   WATCH
================================================== */

function addWatch(
  connectionId,
  target
) {
  const activeCount =
    data.watches.filter(
      row =>
        row.connection_id ===
          connectionId &&
        Number(row.enabled) === 1
    ).length;

  if (activeCount >= 10) {
    throw new Error(
      "Максимум 10 активных слежек"
    );
  }

  const timestamp = now();

  const record = {
    id: nextId(data.watches),
    connection_id:
      connectionId,
    target,
    enabled: 1,
    last_data: null,
    created_at:
      timestamp,
    updated_at:
      timestamp
  };

  data.watches.push(record);

  saveDB();

  return {
    lastInsertRowid:
      record.id
  };
}

function getWatches(connectionId) {
  return data.watches
    .filter(
      row =>
        row.connection_id ===
        connectionId
    )
    .sort(
      (a, b) =>
        Number(b.created_at || 0) -
        Number(a.created_at || 0)
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
      row =>
        !(
          row.connection_id ===
            connectionId &&
          Number(row.id) ===
            numericId
        )
    );

  saveDB();
}

/* ==================================================
   EVENTS
================================================== */

function addEvent({
  connectionId,
  type,
  chatId = null,
  messageId = null,
  data: eventData = {}
}) {
  data.events.push({
    id: nextId(data.events),
    connection_id:
      connectionId,
    type,
    chat_id:
      chatId,
    message_id:
      messageId,
    data: JSON.stringify(
      eventData
    ),
    created_at:
      now()
  });

  saveDB();
}

function getEvents(
  connectionId,
  limit = 100
) {
  return data.events
    .filter(
      row =>
        row.connection_id ===
        connectionId
    )
    .sort(
      (a, b) =>
        Number(b.created_at || 0) -
        Number(a.created_at || 0)
    )
    .slice(
      0,
      Number(limit)
    )
    .map(row => ({
      ...row,
      data: safeJSON(row.data)
    }));
}

/* ==================================================
   SCHEDULED DELETE
================================================== */

function scheduleDelete(
  connectionId,
  chatId,
  messageId,
  deleteAt
) {
  data.scheduled_deletes.push({
    id: nextId(
      data.scheduled_deletes
    ),
    connection_id:
      connectionId,
    chat_id:
      chatId,
    message_id:
      messageId,
    delete_at:
      deleteAt,
    done: 0,
    created_at:
      now()
  });

  saveDB();
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
        Number(a.delete_at || 0) -
        Number(b.delete_at || 0)
    );
}

function markDeleteDone(id) {
  const row =
    data.scheduled_deletes.find(
      item =>
        Number(item.id) ===
        Number(id)
    );

  if (!row) {
    return;
  }

  row.done = 1;

  saveDB();
}

/* ==================================================
   HISTORY
================================================== */

function getHistory(
  connectionId,
  limit = 100
) {
  return data.messages
    .filter(
      row =>
        row.connection_id ===
        connectionId
    )
    .sort(
      (a, b) =>
        Number(b.created_at || 0) -
        Number(a.created_at || 0)
    )
    .slice(
      0,
      Number(limit)
    );
}

/* ==================================================
   STATS
================================================== */

function getStats(connectionId) {
  const messages =
    data.messages.filter(
      row =>
        row.connection_id ===
        connectionId
    ).length;

  const edits =
    data.messages.filter(
      row =>
        row.connection_id ===
          connectionId &&
        row.edited_at !== null
    ).length;

  const deleted =
    data.messages.filter(
      row =>
        row.connection_id ===
          connectionId &&
        row.deleted_at !== null
    ).length;

  const events =
    data.events.filter(
      row =>
        row.connection_id ===
        connectionId
    ).length;

  return {
    messages,
    edits,
    deleted,
    events
  };
}

/* ==================================================
   HELPERS
================================================== */

function safeJSON(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/* ==================================================
   EXPORT
================================================== */

module.exports = {
  db,

  getSetting,
  setSetting,

  saveBusinessConnection,
  getBusinessConnection,
  getActiveConnection,

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
  getStats
};