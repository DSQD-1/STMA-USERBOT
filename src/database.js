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

const EMPTY_DB = {
  version: 3,

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

function nextId(collection) {
  if (!collection.length) {
    return 1;
  }

  return (
    Math.max(
      0,
      ...collection.map(
        item =>
          Number(item.id) || 0
      )
    ) + 1
  );
}

function normalizeUsername(value) {
  return String(
    value || ""
  )
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
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

function normalizeDatabase(parsed) {
  parsed =
    parsed &&
    typeof parsed === "object"
      ? parsed
      : {};

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
}

function loadDB() {
  ensureDirectory();

  if (
    !fs.existsSync(DB_PATH)
  ) {
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

  try {
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

    return normalizeDatabase(
      JSON.parse(raw)
    );
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
  ensureDirectory();

  const tempPath =
    `${DB_PATH}.tmp`;

  try {
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
    try {
      if (
        fs.existsSync(
          tempPath
        )
      ) {
        fs.unlinkSync(
          tempPath
        );
      }
    } catch {}

    console.error(
      "DATABASE SAVE ERROR:",
      error
    );

    throw error;
  }
}

/*
==================================================
 PATH
==================================================
*/

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

    rights:
      connection.rights ??
      old?.rights ??
      null,

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
          Number(
            row.is_enabled
          ) === 1
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
    existing.text = text;

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
      nextId(
        data.messages
      ),

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
    /*
    Если исходного сообщения
    нет в базе — создаём его.
    */

    saveMessage(
      message,
      connectionId
    );

    return true;
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

    if (
      row &&
      row.deleted_at === null
    ) {
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
    );
}

/*
==================================================
 MUTES
==================================================

Поддерживаем:

ID:
123456789

USERNAME:
@username

Сохраняем оба значения.
==================================================
*/

function addMute(
  connectionId,
  userId = null,
  username = null,
  expiresAt = null
) {
  const numericUserId =
    userId === null ||
    userId === undefined ||
    userId === ""
      ? null
      : Number(userId);

  const cleanUsername =
    username
      ? normalizeUsername(
          username
        )
      : null;

  if (
    numericUserId !== null &&
    (
      !Number.isSafeInteger(
        numericUserId
      ) ||
      numericUserId <= 0
    )
  ) {
    throw new Error(
      "Некорректный Telegram ID"
    );
  }

  if (
    numericUserId === null &&
    !cleanUsername
  ) {
    throw new Error(
      "Нужен Telegram ID или username"
    );
  }

  /*
  Ищем существующий мут:

  1. по ID
  2. по username
  */

  let existing =
    null;

  if (
    numericUserId !== null
  ) {
    existing =
      data.mutes.find(
        row =>
          String(
            row.connection_id
          ) ===
            String(connectionId) &&
          Number(row.user_id) ===
            numericUserId
      ) || null;
  }

  if (
    !existing &&
    cleanUsername
  ) {
    existing =
      data.mutes.find(
        row =>
          String(
            row.connection_id
          ) ===
            String(connectionId) &&
          normalizeUsername(
            row.username
          ) === cleanUsername
      ) || null;
  }

  if (existing) {
    if (
      numericUserId !== null
    ) {
      existing.user_id =
        numericUserId;
    }

    if (cleanUsername) {
      existing.username =
        cleanUsername;
    }

    existing.expires_at =
      expiresAt;

    existing.updated_at =
      now();

    saveDB();

    return existing;
  }

  const timestamp =
    now();

  const record = {
    id:
      nextId(data.mutes),

    connection_id:
      connectionId,

    user_id:
      numericUserId,

    username:
      cleanUsername,

    expires_at:
      expiresAt,

    created_at:
      timestamp,

    updated_at:
      timestamp
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
    userId === null ||
    userId === undefined ||
    userId === ""
      ? null
      : Number(userId);

  const cleanUsername =
    username
      ? normalizeUsername(
          username
        )
      : null;

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

        if (
          numericUserId !== null &&
          Number(row.user_id) ===
            numericUserId
        ) {
          return false;
        }

        if (
          cleanUsername &&
          normalizeUsername(
            row.username
          ) === cleanUsername
        ) {
          return false;
        }

        return true;
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
  const timestamp =
    now();

  const numericUserId =
    userId === null ||
    userId === undefined ||
    userId === ""
      ? null
      : Number(userId);

  const cleanUsername =
    username
      ? normalizeUsername(
          username
        )
      : null;

  /*
  Сначала очищаем
  просроченные муты.
  */

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

  return data.mutes.some(
    row => {
      if (
        String(
          row.connection_id
        ) !==
        String(connectionId)
      ) {
        return false;
      }

      if (
        numericUserId !== null &&
        Number(row.user_id) ===
          numericUserId
      ) {
        return true;
      }

      if (
        cleanUsername &&
        normalizeUsername(
          row.username
        ) === cleanUsername
      ) {
        return true;
      }

      return false;
    }
  );
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
 FIND MUTE
==================================================
*/

function findMute(
  connectionId,
  userId = null,
  username = null
) {
  const numericUserId =
    userId === null ||
    userId === undefined
      ? null
      : Number(userId);

  const cleanUsername =
    username
      ? normalizeUsername(
          username
        )
      : null;

  return (
    data.mutes.find(
      row => {
        if (
          String(
            row.connection_id
          ) !==
          String(connectionId)
        ) {
          return false;
        }

        if (
          numericUserId !== null &&
          Number(row.user_id) ===
            numericUserId
        ) {
          return true;
        }

        if (
          cleanUsername &&
          normalizeUsername(
            row.username
          ) === cleanUsername
        ) {
          return true;
        }

        return false;
      }
    ) || null
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
      nextId(
        data.watches
      ),

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
    values.target !==
    undefined
  ) {
    row.target =
      String(
        values.target
      ).trim();
  }

  if (
    values.enabled !==
    undefined
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

  /*
  Ограничиваем историю событий,
  чтобы JSON не рос бесконечно.
  */

  if (
    data.events.length >
    10000
  ) {
    data.events =
      data.events.slice(
        -10000
      );
  }

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
          safeJSON(
            row.data
          )
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
    String(
      error || ""
    );

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
            params[0]
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
            params[0]
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

  saveMessage,
  markEdited,
  markDeleted,
  getHistory,

  addMute,
  removeMute,
  isMuted,
  getMutes,
  findMute,

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