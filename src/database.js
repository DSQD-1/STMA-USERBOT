const Database = require("better-sqlite3");

const db = new Database(process.env.DB_PATH || "./stma.db");

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  language_code TEXT,
  photo_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS business_connections (
  id TEXT PRIMARY KEY,
  user_id INTEGER,
  user_chat_id INTEGER,
  is_enabled INTEGER DEFAULT 0,
  rights_json TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mutes (
  connection_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (connection_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  connection_id TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  sender_id INTEGER,
  sender_username TEXT,
  sender_name TEXT,
  text TEXT,
  kind TEXT,
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  deleted_at INTEGER,
  PRIMARY KEY (connection_id, chat_id, message_id)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT,
  type TEXT NOT NULL,
  chat_id INTEGER,
  message_id INTEGER,
  data_json TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_deletes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  delete_at INTEGER NOT NULL,
  done INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL,
  target TEXT NOT NULL,
  target_user_id INTEGER,
  last_snapshot_json TEXT,
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mutes_connection
ON mutes(connection_id);

CREATE INDEX IF NOT EXISTS idx_messages_connection
ON messages(connection_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_connection
ON events(connection_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scheduled_delete
ON scheduled_deletes(done, delete_at);

CREATE INDEX IF NOT EXISTS idx_watches_connection
ON watches(connection_id, enabled);
`);

function now() {
  return Math.floor(Date.now() / 1000);
}

/* =========================
   SETTINGS
========================= */

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings(key, value)
    VALUES(?, ?)
    ON CONFLICT(key)
    DO UPDATE SET value=excluded.value
  `).run(key, String(value));
}

function getSetting(key, fallback = null) {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key=?`)
    .get(key);

  return row ? row.value : fallback;
}

/* =========================
   USERS
========================= */

function saveUser(user) {
  if (!user?.id) return;

  const t = now();

  db.prepare(`
    INSERT INTO users (
      telegram_id,
      username,
      first_name,
      last_name,
      language_code,
      photo_url,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)

    ON CONFLICT(telegram_id)
    DO UPDATE SET
      username=excluded.username,
      first_name=excluded.first_name,
      last_name=excluded.last_name,
      language_code=excluded.language_code,
      photo_url=excluded.photo_url,
      updated_at=excluded.updated_at
  `).run(
    user.id,
    user.username || null,
    user.first_name || null,
    user.last_name || null,
    user.language_code || null,
    user.photo_url || null,
    t,
    t
  );
}

function getUser(id) {
  return db
    .prepare(`SELECT * FROM users WHERE telegram_id=?`)
    .get(Number(id));
}

/* =========================
   BUSINESS CONNECTION
========================= */

function saveBusinessConnection(connection) {
  if (!connection?.id) return;

  const t = now();

  db.prepare(`
    INSERT INTO business_connections (
      id,
      user_id,
      user_chat_id,
      is_enabled,
      rights_json,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)

    ON CONFLICT(id)
    DO UPDATE SET
      user_id=excluded.user_id,
      user_chat_id=excluded.user_chat_id,
      is_enabled=excluded.is_enabled,
      rights_json=excluded.rights_json,
      updated_at=excluded.updated_at
  `).run(
    connection.id,
    connection.user?.id || null,
    connection.user_chat_id || null,
    connection.is_enabled ? 1 : 0,
    JSON.stringify(connection.rights || {}),
    t,
    t
  );
}

function getConnection(id) {
  return db
    .prepare(`SELECT * FROM business_connections WHERE id=?`)
    .get(id);
}

function getConnections() {
  return db
    .prepare(`
      SELECT *
      FROM business_connections
      ORDER BY updated_at DESC
    `)
    .all();
}

/* =========================
   MUTES
========================= */

function addMute(connectionId, userId, username = null, expiresAt = null) {
  db.prepare(`
    INSERT INTO mutes (
      connection_id,
      user_id,
      username,
      expires_at,
      created_at
    )
    VALUES (?, ?, ?, ?, ?)

    ON CONFLICT(connection_id, user_id)
    DO UPDATE SET
      username=excluded.username,
      expires_at=excluded.expires_at
  `).run(
    connectionId,
    Number(userId),
    username || null,
    expiresAt,
    now()
  );
}

function removeMute(connectionId, userId) {
  return db
    .prepare(`
      DELETE FROM mutes
      WHERE connection_id=?
      AND user_id=?
    `)
    .run(connectionId, Number(userId));
}

function isMuted(connectionId, userId) {
  const row = db
    .prepare(`
      SELECT *
      FROM mutes
      WHERE connection_id=?
      AND user_id=?
    `)
    .get(connectionId, Number(userId));

  if (!row) return false;

  if (
    row.expires_at !== null &&
    Number(row.expires_at) <= now()
  ) {
    removeMute(connectionId, userId);
    return false;
  }

  return true;
}

function getMutes(connectionId) {
  db.prepare(`
    DELETE FROM mutes
    WHERE connection_id=?
    AND expires_at IS NOT NULL
    AND expires_at <= ?
  `).run(connectionId, now());

  return db.prepare(`
    SELECT *
    FROM mutes
    WHERE connection_id=?
    ORDER BY created_at DESC
  `).all(connectionId);
}

/* =========================
   MESSAGES
========================= */

function saveMessage(message, connectionId) {
  const chatId = message?.chat?.id;
  const messageId = message?.message_id;

  if (chatId == null || messageId == null) {
    return;
  }

  const from = message.from || {};

  const text =
    message.text ||
    message.caption ||
    "";

  const kind =
    message.text
      ? "text"
      : message.caption
        ? "caption"
        : "media";

  const t = now();

  db.prepare(`
    INSERT INTO messages (
      connection_id,
      chat_id,
      message_id,
      sender_id,
      sender_username,
      sender_name,
      text,
      kind,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)

    ON CONFLICT(connection_id, chat_id, message_id)
    DO UPDATE SET
      sender_username=excluded.sender_username,
      sender_name=excluded.sender_name,
      text=excluded.text,
      kind=excluded.kind,
      edited_at=?
  `).run(
    connectionId,
    Number(chatId),
    Number(messageId),
    from.id || null,
    from.username || null,
    [
      from.first_name,
      from.last_name
    ]
      .filter(Boolean)
      .join(" ") || null,
    text,
    kind,
    t,
    t
  );
}

function markEdited(message, connectionId) {
  saveMessage(message, connectionId);
}

function markDeleted(connectionId, chatId, messageIds = []) {
  if (chatId == null || !messageIds.length) {
    return;
  }

  const stmt = db.prepare(`
    UPDATE messages
    SET deleted_at=?
    WHERE connection_id=?
    AND chat_id=?
    AND message_id=?
  `);

  const t = now();

  const transaction = db.transaction((ids) => {
    for (const id of ids) {
      stmt.run(
        t,
        connectionId,
        Number(chatId),
        Number(id)
      );
    }
  });

  transaction(messageIds);
}

function getMessages(connectionId, limit = 50) {
  limit = Math.min(
    Math.max(Number(limit) || 50, 1),
    200
  );

  return db.prepare(`
    SELECT *
    FROM messages
    WHERE connection_id=?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(connectionId, limit);
}

/* =========================
   EVENTS
========================= */

function addEvent(event) {
  db.prepare(`
    INSERT INTO events (
      connection_id,
      type,
      chat_id,
      message_id,
      data_json,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    event.connectionId || null,
    event.type,
    event.chatId != null
      ? Number(event.chatId)
      : null,
    event.messageId != null
      ? Number(event.messageId)
      : null,
    JSON.stringify(event.data || {}),
    now()
  );
}

function getEvents(connectionId, limit = 50) {
  limit = Math.min(
    Math.max(Number(limit) || 50, 1),
    200
  );

  return db.prepare(`
    SELECT *
    FROM events
    WHERE connection_id=?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(connectionId, limit);
}

/* =========================
   AUTO DELETE
========================= */

function addScheduledDelete(
  connectionId,
  chatId,
  messageId,
  seconds
) {
  const deleteAt =
    now() +
    Math.max(1, Number(seconds));

  return db.prepare(`
    INSERT INTO scheduled_deletes (
      connection_id,
      chat_id,
      message_id,
      delete_at,
      created_at
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(
    connectionId,
    Number(chatId),
    Number(messageId),
    deleteAt,
    now()
  ).lastInsertRowid;
}

function getDueDeletes(limit = 50) {
  return db.prepare(`
    SELECT *
    FROM scheduled_deletes
    WHERE done=0
    AND delete_at<=?
    ORDER BY delete_at ASC
    LIMIT ?
  `).all(now(), limit);
}

function markDeleteDone(id) {
  db.prepare(`
    UPDATE scheduled_deletes
    SET done=1
    WHERE id=?
  `).run(id);
}

/* =========================
   WATCH
========================= */

function addWatch(
  connectionId,
  target,
  targetUserId = null
) {
  const count = db.prepare(`
    SELECT COUNT(*) AS count
    FROM watches
    WHERE connection_id=?
    AND enabled=1
  `).get(connectionId).count;

  if (count >= 10) {
    throw new Error(
      "Максимум 10 активных слежек."
    );
  }

  return db.prepare(`
    INSERT INTO watches (
      connection_id,
      target,
      target_user_id,
      enabled,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, 1, ?, ?)
  `).run(
    connectionId,
    target,
    targetUserId,
    now(),
    now()
  ).lastInsertRowid;
}

function getWatches(connectionId) {
  return db.prepare(`
    SELECT *
    FROM watches
    WHERE connection_id=?
    ORDER BY created_at DESC
  `).all(connectionId);
}

function removeWatch(connectionId, id) {
  return db.prepare(`
    DELETE FROM watches
    WHERE connection_id=?
    AND id=?
  `).run(
    connectionId,
    Number(id)
  );
}

/* =========================
   STATS
========================= */

function getStats(connectionId) {
  const messages = db.prepare(`
    SELECT COUNT(*) AS n
    FROM messages
    WHERE connection_id=?
  `).get(connectionId).n;

  const edits = db.prepare(`
    SELECT COUNT(*) AS n
    FROM messages
    WHERE connection_id=?
    AND edited_at IS NOT NULL
  `).get(connectionId).n;

  const deleted = db.prepare(`
    SELECT COUNT(*) AS n
    FROM messages
    WHERE connection_id=?
    AND deleted_at IS NOT NULL
  `).get(connectionId).n;

  const events = db.prepare(`
    SELECT COUNT(*) AS n
    FROM events
    WHERE connection_id=?
  `).get(connectionId).n;

  return {
    messages,
    edits,
    deleted,
    events
  };
}

module.exports = {
  db,

  setSetting,
  getSetting,

  saveUser,
  getUser,

  saveBusinessConnection,
  getConnection,
  getConnections,

  addMute,
  removeMute,
  isMuted,
  getMutes,

  saveMessage,
  markEdited,
  markDeleted,
  getMessages,

  addEvent,
  getEvents,

  addScheduledDelete,
  getDueDeletes,
  markDeleteDone,

  addWatch,
  getWatches,
  removeWatch,

  getStats
};