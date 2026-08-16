const fs = require("fs");
const path = require("path");

/*
==================================================
 CONFIG
==================================================
*/

const DB_PATH =
  process.env.DB_PATH ||
  path.join(__dirname, "..", "stma-data.json");

/*
==================================================
 EMPTY DATABASE
==================================================
*/

const EMPTY_DB = {
  version: 3,

  settings: {},

  business_connections: [],

  users: [],

  messages: [],

  mutes: [],

  watches: [],

  events: [],

  scheduled_deletes: []
};

/*
==================================================
 HELPERS
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

function ensureDirectory() {
  const dir =
    path.dirname(DB_PATH);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {
      recursive: true
    });
  }
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

function normalizeUsername(username) {
  if (
    username === null ||
    username === undefined
  ) {
    return null;
  }

  let value =
    String(username).trim();

  if (!value) {
    return null;
  }

  if (value.startsWith("@")) {
    value = value.slice(1);
  }

  return value.toLowerCase();
}

function displayUsername(username) {
  const normalized =
    normalizeUsername(username);

  return normalized
    ? `@${normalized}`
    : null;
}

function normalizeUserId(userId) {
  const value =
    Number(userId);

  if (
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    return null;
  }

  return value;
}

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
 LOAD
==================================================
*/

function loadDB() {
  try {
    ensureDirectory();

    if (!fs.existsSync(DB_PATH)) {
      const initial =
        clone(EMPTY_DB);

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
      return clone(EMPTY_DB);
    }

    const parsed =
      JSON.parse(raw);

    return {
      ...clone(EMPTY_DB),
      ...parsed,

      settings:
        parsed.settings || {},

      business_connections:
        Array.isArray(
          parsed.business_connections
        )
          ? parsed.business_connections
          : [],

      users:
        Array.isArray(
          parsed.users
        )
          ? parsed.users
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

    return clone(EMPTY_DB);
  }
}

let data = loadDB();

/*
==================================================
 SAVE
==================================================
*/

function saveDB() {
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
}

function getDatabasePath() {
  return DB_PATH;
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
    value;

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
      normalizeUserId(
        user.id
      ) ??
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
      connection.is_enabled === false
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

function getActiveConnectionForUser(
  userId
) {
  return (
    getConnectionsForUser(
      userId
    )[0] || null
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
==================================================
 USERS
==================================================
*/

function saveUser(user) {
  if (!user?.id) {
    return null;
  }

  const userId =
    normalizeUserId(
      user.id
    );

  if (!userId) {
    return null;
  }

  const index =
    data.users.findIndex(
      row =>
        Number(row.id) ===
        userId
    );

  const old =
    index >= 0
      ? data.users[index]
      : null;

  const record = {
    id:
      userId,

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

    language_code:
      user.language_code ??
      old?.language_code ??
      null,

    updated_at:
      now(),

    created_at:
      old?.created_at ||
      now()
  };

  if (index >= 0) {
    data.users[index] =
      record;
  } else {
    data.users.push(
      record
    );
  }

  saveDB();

  return record;
}

function getUser(userId) {
  const id =
    normalizeUserId(userId);

  if (!id) {
    return null;
  }

  return (
    data.users.find(
      row =>
        Number(row.id) === id
    ) || null
  );
}

function getUserByUsername(
  username
) {
  const normalized =
    normalizeUsername(
      username
    );

  if (!normalized) {
    return null;
  }

  return (
    data.users.find(
      row =>
        normalizeUsername(
          row.username
        ) === normalized
    ) || null
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
    message?.chat?.id ??
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

  const sender =
    message.from || {};

  const senderId =
    normalizeUserId(
      sender.id
    );

  const senderUsername =
    sender.username ||
    null;

  if (senderId) {
    saveUserWithoutExtraSave(
      sender
    );
  }

  const text =
    message.text ||
    message.caption ||
    "";

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
    existing.text = text;

    existing.sender_id =
      senderId;

    existing.sender_username =
      senderUsername;

    existing.sender_name =
      [
        sender.first_name,
        sender.last_name
      ]
        .filter(Boolean)
        .join(" ") ||
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
      [
        sender.first_name,
        sender.last_name
      ]
        .filter(Boolean)
        .join(" ") ||
      null,

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

function saveUserWithoutExtraSave(
  user
) {
  const userId =
    normalizeUserId(
      user?.id
    );

  if (!userId) {
    return null;
  }

  const index =
    data.users.findIndex(
      row =>
        Number(row.id) ===
        userId
    );

  const old =
    index >= 0
      ? data.users[index]
      : null;

  const record = {
    id:
      userId,

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

    language_code:
      user.language_code ??
      old?.language_code ??
      null,

    created_at:
      old?.created_at ||
      now(),

    updated_at:
      now()
  };

  if (index >= 0) {
    data.users[index] =
      record;
  } else {
    data.users.push(
      record
    );
  }

  return record;
}

/*
==================================================
 EDITED
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
    message.text ||
    message.caption ||
    "";

  row.edited_at =
    now();

  saveDB();

  return true;
}

/*
==================================================
 DELETED
==================================================
*/

function markDeleted(
  connectionId,
  chatId,
  messageIds
) {
  if (
    !Array.isArray(messageIds)
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

  if (changed) {
    saveDB();
  }

  return changed;
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
  userId = null,
  username = null,
  expiresAt = null
) {
  const numericUserId =
    userId !== null &&
    userId !== undefined
      ? normalizeUserId(userId)
      : null;

  const normalizedUsername =
    normalizeUsername(
      username
    );

  if (
    !numericUserId &&
    !normalizedUsername
  ) {
    throw new Error(
      "Укажи Telegram ID или username"
    );
  }

  /*
  Ищем существующий мут
  либо по ID, либо по username.
  */

  let existing =
    data.mutes.find(
      row =>
        String(
          row.connection_id
        ) ===
          String(connectionId) &&
        (
          (
            numericUserId &&
            Number(row.user_id) ===
              numericUserId
          ) ||
          (
            normalizedUsername &&
            normalizeUsername(
              row.username
            ) ===
              normalizedUsername
          )
        )
    );

  if (existing) {
    if (numericUserId) {
      existing.user_id =
        numericUserId;
    }

    if (normalizedUsername) {
      existing.username =
        normalizedUsername;
    }

    existing.expires_at =
      expiresAt;

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
      normalizedUsername,

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

/*
==================================================
 REMOVE MUTE
==================================================
*/

function removeMute(
  connectionId,
  userId = null,
  username = null
) {
  const numericUserId =
    userId !== null &&
    userId !== undefined
      ? normalizeUserId(userId)
      : null;

  const normalizedUsername =
    normalizeUsername(
      username
    );

  const before =
    data.mutes.length;

  data.mutes =
    data.mutes.filter(
      row => {
        if (
          String(
            row.connection_id
          ) !==
          String(connectionId)
        ) {
          return true;
        }

        const sameId =
          numericUserId &&
          Number(row.user_id) ===
            numericUserId;

        const sameUsername =
          normalizedUsername &&
          normalizeUsername(
            row.username
          ) ===
            normalizedUsername;

        return !(
          sameId ||
          sameUsername
        );
      }
    );

  const removed =
    before -
    data.mutes.length;

  if (removed) {
    saveDB();
  }

  return removed;
}

/*
==================================================
 IS MUTED
==================================================
*/

function isMuted(
  connectionId,
  userId = null,
  username = null
) {
  const numericUserId =
    userId !== null &&
    userId !== undefined
      ? normalizeUserId(userId)
      : null;

  const normalizedUsername =
    normalizeUsername(
      username
    );

  if (
    !numericUserId &&
    !normalizedUsername
  ) {
    return false;
  }

  const timestamp =
    now();

  const row =
    data.mutes.find(
      item => {
        if (
          String(
            item.connection_id
          ) !==
          String(connectionId)
        ) {
          return false;
        }

        const idMatch =
          numericUserId &&
          Number(item.user_id) ===
            numericUserId;

        const usernameMatch =
          normalizedUsername &&
          normalizeUsername(
            item.username
          ) ===
            normalizedUsername;

        return (
          idMatch ||
          usernameMatch
        );
      }
    );

  if (!row) {
    return false;
  }

  if (
    row.expires_at !== null &&
    Number(row.expires_at) <=
      timestamp
  ) {
    removeMute(
      connectionId,
      row.user_id,
      row.username
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
    .map(
      row => ({
        ...row,

        username:
          row.username
            ? `@${normalizeUsername(
                row.username
              )}`
            : null
      })
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

  const existing =
    data.watches.find(
      row =>
        String(
          row.connection_id
        ) ===
          String(connectionId) &&
        String(row.target)
          .toLowerCase() ===
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
            Number(id)
        )
    );

  const removed =
    before -
    data.watches.length;

  if (removed) {
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
      values.enabled ? 1 : 0;
  }

  if (
    values.last_data !== undefined
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
        Number(b.created_at || 0) -
        Number(a.created_at || 0)
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
        Number(row.delete_at) <= now()
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
    return false;
  }

  row.done = 1;
  row.completed_at = now();

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
    getMutes(
      connectionId
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
 COMPATIBILITY
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
          return getConnectionsForUser(
            Number(params[0])
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
          return getActiveConnectionForUser(
            Number(params[0])
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
  db,

  getDatabasePath,

  getSetting,
  setSetting,

  saveBusinessConnection,
  getBusinessConnection,

  getConnectionsForUser,
  getActiveConnectionForUser,
  getActiveConnection,

  enableBusinessConnection,
  disableBusinessConnection,

  saveUser,
  getUser,
  getUserByUsername,

  saveMessage,
  markEdited,
  markDeleted,
  getHistory,

  addMute,
  removeMute,
  isMuted,
  getMutes,

  addWatch,
  getWatches,
  removeWatch,
  updateWatch,

  addEvent,
  getEvents,

  scheduleDelete,
  getDueDeletes,
  markDeleteDone,
  markDeleteError,

  getStats
};