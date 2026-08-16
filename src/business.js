const fs = require("fs");
const path = require("path");

/*
==================================================
DATABASE PATH
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

const EMPTY_DB = {
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
UTILS
==================================================
*/

function clone(value) {
  return JSON.parse(
    JSON.stringify(value)
  );
}

function now() {
  return Math.floor(
    Date.now() / 1000
  );
}

function ensureDatabaseFile() {
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
        EMPTY_DB,
        null,
        2
      ),
      "utf8"
    );
  }
}

/*
==================================================
LOAD
==================================================
*/

function loadDB() {
  try {
    ensureDatabaseFile();

    const raw =
      fs.readFileSync(
        DB_PATH,
        "utf8"
      );

    if (!raw.trim()) {
      return clone(
        EMPTY_DB
      );
    }

    const parsed =
      JSON.parse(raw);

    return {
      ...clone(EMPTY_DB),
      ...parsed,

      settings:
        parsed.settings &&
        typeof parsed.settings ===
          "object"
          ? parsed.settings
          : {},

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

    return clone(
      EMPTY_DB
    );
  }
}

let data = loadDB();

/*
==================================================
SAVE
==================================================
*/

function saveDB() {
  ensureDatabaseFile();

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
}

/*
==================================================
DATABASE INFO
==================================================
*/

function getDatabasePath() {
  return DB_PATH;
}

/*
==================================================
ID
==================================================
*/

function nextId(collection) {
  if (
    !Array.isArray(collection) ||
    collection.length === 0
  ) {
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

function saveBusinessConnection(
  connection
) {
  if (!connection?.id) {
    throw new Error(
      "Некорректное Business Connection"
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

  const record = {
    id:
      connection.id,

    user_id:
      connection.user?.id ??
      old?.user_id ??
      null,

    username:
      connection.user?.username ??
      old?.username ??
      null,

    first_name:
      connection.user?.first_name ??
      old?.first_name ??
      null,

    last_name:
      connection.user?.last_name ??
      old?.last_name ??
      null,

    is_enabled:
      connection.is_enabled
        ? 1
        : 0,

    created_at:
      old?.created_at ??
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
==================================================
GET CONNECTION
==================================================
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
==================================================
GET CONNECTIONS FOR USER
==================================================
*/

function getConnectionsForUser(
  userId
) {
  const numericUserId =
    Number(userId);

  return data.business_connections
    .filter(
      row =>
        Number(row.user_id) ===
        numericUserId &&
        Number(row.is_enabled) ===
          1
    )
    .sort(
      (a, b) =>
        Number(
          b.updated_at || 0
        ) -
        Number(
          a.updated_at || 0
        )
    );
}

/*
==================================================
ACTIVE CONNECTION
==================================================
*/

function getActiveConnection() {
  return (
    data.business_connections
      .filter(
        row =>
          Number(row.is_enabled) ===
          1
      )
      .sort(
        (a, b) =>
          Number(
            b.updated_at || 0
          ) -
          Number(
            a.updated_at || 0
          )
      )[0] || null
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
    return;
  }

  const chatId =
    message.chat?.id ??
    null;

  const messageId =
    message.message_id ??
    null;

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

    text:
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
EDIT MESSAGE
==================================================
*/

function markEdited(
  message,
  connectionId
) {
  if (!message) {
    return;
  }

  const row =
    data.messages.find(
      item =>
        String(
          item.connection_id
        ) ===
          String(connectionId) &&
        Number(item.chat_id) ===
          Number(
            message.chat?.id
          ) &&
        Number(
          item.message_id
        ) ===
          Number(
            message.message_id
          )
    );

  if (!row) {
    return;
  }

  row.text =
    message.text ||
    message.caption ||
    "";

  row.edited_at =
    now();

  saveDB();
}

/*
==================================================
DELETE MESSAGE MARK
==================================================
*/

function markDeleted(
  connectionId,
  chatId,
  messageIds
) {
  if (
    !Array.isArray(messageIds) ||
    messageIds.length === 0
  ) {
    return;
  }

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
          Number(
            item.message_id
          ) ===
            Number(messageId)
      );

    if (row) {
      row.deleted_at =
        timestamp;
    }
  }

  saveDB();
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
    !Number.isInteger(
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
      expiresAt;

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
      expiresAt,

    created_at:
      now()
  };

  data.mutes.push(
    record
  );

  saveDB();

  return record;
}

/*
==================================================
REMOVE MUTE
==================================================
*/

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

  saveDB();

  return (
    before !==
    data.mutes.length
  );
}

/*
==================================================
IS MUTED
==================================================
*/

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
    row.expires_at !==
      null &&
    row.expires_at !==
      undefined &&
    Number(
      row.expires_at
    ) <= now()
  ) {
    removeMute(
      connectionId,
      userId
    );

    return false;
  }

  return true;
}

/*
==================================================
GET MUTES
==================================================
*/

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
        row.expires_at ===
          null ||
        row.expires_at ===
          undefined ||
        Number(
          row.expires_at
        ) > timestamp
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
      "Укажи username или ID"
    );
  }

  const activeCount =
    data.watches.filter(
      row =>
        String(
          row.connection_id
        ) ===
          String(connectionId) &&
        Number(row.enabled) ===
          1
    ).length;

  if (
    activeCount >= 10
  ) {
    throw new Error(
      "Максимум 10 активных слежек"
    );
  }

  const duplicate =
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
        Number(row.enabled) ===
          1
    );

  if (duplicate) {
    throw new Error(
      "Этот пользователь уже находится в слежке"
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
    lastInsertRowid:
      record.id,

    record
  };
}

/*
==================================================
GET WATCHES
==================================================
*/

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

/*
==================================================
REMOVE WATCH
==================================================
*/

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

  saveDB();

  return (
    before !==
    data.watches.length
  );
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

    type:
      String(type || "unknown"),

    chat_id:
      chatId,

    message_id:
      messageId,

    data:
      JSON.stringify(
        eventData ?? {}
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

/*
==================================================
GET EVENTS
==================================================
*/

function getEvents(
  connectionId,
  limit = 100
) {
  const amount =
    Math.max(
      1,
      Number(limit) || 100
    );

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
      amount
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
      now()
  };

  data.scheduled_deletes.push(
    record
  );

  saveDB();

  return record;
}

/*
==================================================
DUE DELETES
==================================================
*/

function getDueDeletes() {
  return data.scheduled_deletes
    .filter(
      row =>
        Number(row.done) ===
          0 &&
        Number(
          row.delete_at
        ) <= now()
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

/*
==================================================
MARK DELETE DONE
==================================================
*/

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

  saveDB();

  return true;
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
  const amount =
    Math.max(
      1,
      Number(limit) || 100
    );

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
        Number(
          b.created_at || 0
        ) -
        Number(
          a.created_at || 0
        )
    )
    .slice(
      0,
      amount
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
      row =>
        String(
          row.connection_id
        ) ===
        String(connectionId)
    );

  const events =
    data.events.filter(
      row =>
        String(
          row.connection_id
        ) ===
        String(connectionId)
    );

  return {
    messages:
      messages.length,

    edits:
      messages.filter(
        row =>
          row.edited_at !==
          null
      ).length,

    deleted:
      messages.filter(
        row =>
          row.deleted_at !==
          null
      ).length,

    events:
      events.length
  };
}

/*
==================================================
JSON
==================================================
*/

function safeJSON(
  value
) {
  if (
    value &&
    typeof value ===
      "object"
  ) {
    return value;
  }

  try {
    return JSON.parse(
      value
    );
  } catch {
    return {};
  }
}

/*
==================================================
DATABASE OBJECT
==================================================
*/

const database = {
  getDatabasePath,

  getSetting,
  setSetting,

  saveBusinessConnection,
  getBusinessConnection,
  getConnectionsForUser,
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
  getStats,

  saveDB
};

module.exports = database;