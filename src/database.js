const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH =
  process.env.DB_PATH ||
  path.join(__dirname, "..", "stma.db");

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS business_connections (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    username TEXT,
    first_name TEXT,
    is_enabled INTEGER DEFAULT 1,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id TEXT,
    chat_id INTEGER,
    message_id INTEGER,
    sender_id INTEGER,
    sender_username TEXT,
    sender_name TEXT,
    text TEXT,
    created_at INTEGER,
    edited_at INTEGER,
    deleted_at INTEGER,
    UNIQUE(connection_id, chat_id, message_id)
  );

  CREATE TABLE IF NOT EXISTS mutes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id TEXT,
    user_id INTEGER,
    username TEXT,
    expires_at INTEGER,
    created_at INTEGER,
    UNIQUE(connection_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS watches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id TEXT,
    target TEXT,
    enabled INTEGER DEFAULT 1,
    last_data TEXT,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id TEXT,
    type TEXT,
    chat_id INTEGER,
    message_id INTEGER,
    data TEXT,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS scheduled_deletes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id TEXT,
    chat_id INTEGER,
    message_id INTEGER,
    delete_at INTEGER,
    done INTEGER DEFAULT 0,
    created_at INTEGER
  );
`);

/* =========================
   SETTINGS
========================= */

function getSetting(key) {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key);

  return row?.value ?? null;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key)
    DO UPDATE SET value = excluded.value
  `).run(key, String(value));

  return value;
}

/* =========================
   BUSINESS CONNECTION
========================= */

function saveBusinessConnection(c) {
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO business_connections
    (
      id,
      user_id,
      username,
      first_name,
      is_enabled,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)

    ON CONFLICT(id)
    DO UPDATE SET
      user_id = excluded.user_id,
      username = excluded.username,
      first_name = excluded.first_name,
      is_enabled = excluded.is_enabled,
      updated_at = excluded.updated_at
  `).run(
    c.id,
    c.user?.id || null,
    c.user?.username || null,
    c.user?.first_name || null,
    c.is_enabled ? 1 : 0,
    now,
    now
  );
}

function getBusinessConnection(id) {
  return db
    .prepare(`
      SELECT *
      FROM business_connections
      WHERE id = ?
    `)
    .get(id);
}

function getActiveConnection() {
  return db
    .prepare(`
      SELECT *
      FROM business_connections
      WHERE is_enabled = 1
      ORDER BY updated_at DESC
      LIMIT 1
    `)
    .get();
}

/* =========================
   MESSAGES
========================= */

function saveMessage(message, connectionId) {
  const text =
    message?.text ||
    message?.caption ||
    "";

  const senderId =
    Number(message?.from?.id || 0);

  const senderUsername =
    message?.from?.username || null;

  const senderName =
    [
      message?.from?.first_name,
      message?.from?.last_name
    ]
      .filter(Boolean)
      .join(" ") || null;

  const now =
    Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO messages
    (
      connection_id,
      chat_id,
      message_id,
      sender_id,
      sender_username,
      sender_name,
      text,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)

    ON CONFLICT(connection_id, chat_id, message_id)
    DO UPDATE SET
      text = excluded.text,
      sender_username = excluded.sender_username,
      sender_name = excluded.sender_name
  `).run(
    connectionId,
    message?.chat?.id || null,
    message?.message_id || null,
    senderId,
    senderUsername,
    senderName,
    text,
    now
  );
}

function markEdited(message, connectionId) {
  const now =
    Math.floor(Date.now() / 1000);

  const text =
    message?.text ||
    message?.caption ||
    "";

  db.prepare(`
    UPDATE messages
    SET
      text = ?,
      edited_at = ?
    WHERE
      connection_id = ?
      AND chat_id = ?
      AND message_id = ?
  `).run(
    text,
    now,
    connectionId,
    message?.chat?.id,
    message?.message_id
  );
}

function markDeleted(
  connectionId,
  chatId,
  messageIds
) {
  if (!messageIds?.length) return;

  const now =
    Math.floor(Date.now() / 1000);

  const stmt = db.prepare(`
    UPDATE messages
    SET deleted_at = ?
    WHERE
      connection_id = ?
      AND chat_id = ?
      AND message_id = ?
  `);

  const transaction =
    db.transaction(ids => {
      for (const id of ids) {
        stmt.run(
          now,
          connectionId,
          chatId,
          id
        );
      }
    });

  transaction(messageIds);
}

/* =========================
   MUTES
========================= */

function addMute(
  connectionId,
  userId,
  username,
  expiresAt
) {
  const now =
    Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO mutes
    (
      connection_id,
      user_id,
      username,
      expires_at,
      created_at
    )
    VALUES (?, ?, ?, ?, ?)

    ON CONFLICT(connection_id, user_id)
    DO UPDATE SET
      username = excluded.username,
      expires_at = excluded.expires_at
  `).run(
    connectionId,
    Number(userId),
    username || null,
    expiresAt,
    now
  );
}

function removeMute(
  connectionId,
  userId
) {
  db.prepare(`
    DELETE FROM mutes
    WHERE
      connection_id = ?
      AND user_id = ?
  `).run(
    connectionId,
    Number(userId)
  );
}

function isMuted(
  connectionId,
  userId
) {
  const row =
    db.prepare(`
      SELECT *
      FROM mutes
      WHERE
        connection_id = ?
        AND user_id = ?
    `).get(
      connectionId,
      Number(userId)
    );

  if (!row) return false;

  if (
    row.expires_at !== null &&
    row.expires_at <=
      Math.floor(Date.now() / 1000)
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
  const now =
    Math.floor(Date.now() / 1000);

  db.prepare(`
    DELETE FROM mutes
    WHERE
      expires_at IS NOT NULL
      AND expires_at <= ?
  `).run(now);

  return db.prepare(`
    SELECT
      user_id,
      username,
      expires_at,
      created_at
    FROM mutes
    WHERE connection_id = ?
    ORDER BY created_at DESC
  `).all(connectionId);
}

/* =========================
   WATCH
========================= */

function addWatch(
  connectionId,
  target
) {
  const count =
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM watches
      WHERE
        connection_id = ?
        AND enabled = 1
    `).get(connectionId).count;

  if (count >= 10) {
    throw new Error(
      "Максимум 10 активных слежек"
    );
  }

  const now =
    Math.floor(Date.now() / 1000);

  return db.prepare(`
    INSERT INTO watches
    (
      connection_id,
      target,
      enabled,
      created_at,
      updated_at
    )
    VALUES (?, ?, 1, ?, ?)
  `).run(
    connectionId,
    target,
    now,
    now
  );
}

function getWatches(connectionId) {
  return db.prepare(`
    SELECT *
    FROM watches
    WHERE connection_id = ?
    ORDER BY created_at DESC
  `).all(connectionId);
}

function removeWatch(
  connectionId,
  id
) {
  db.prepare(`
    DELETE FROM watches
    WHERE
      connection_id = ?
      AND id = ?
  `).run(
    connectionId,
    Number(id)
  );
}

/* =========================
   EVENTS
========================= */

function addEvent({
  connectionId,
  type,
  chatId = null,
  messageId = null,
  data = {}
}) {
  db.prepare(`
    INSERT INTO events
    (
      connection_id,
      type,
      chat_id,
      message_id,
      data,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    connectionId,
    type,
    chatId,
    messageId,
    JSON.stringify(data),
    Math.floor(Date.now() / 1000)
  );
}

function getEvents(
  connectionId,
  limit = 100
) {
  const rows = db.prepare(`
    SELECT *
    FROM events
    WHERE connection_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(
    connectionId,
    Number(limit)
  );

  return rows.map(row => ({
    ...row,
    data: safeJSON(row.data)
  }));
}

/* =========================
   SCHEDULED DELETE
========================= */

function scheduleDelete(
  connectionId,
  chatId,
  messageId,
  deleteAt
) {
  db.prepare(`
    INSERT INTO scheduled_deletes
    (
      connection_id,
      chat_id,
      message_id,
      delete_at,
      created_at
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(
    connectionId,
    chatId,
    messageId,
    deleteAt,
    Math.floor(Date.now() / 1000)
  );
}

function getDueDeletes() {
  return db.prepare(`
    SELECT *
    FROM scheduled_deletes
    WHERE
      done = 0
      AND delete_at <= ?
    ORDER BY delete_at ASC
  `).all(
    Math.floor(Date.now() / 1000)
  );
}

function markDeleteDone(id) {
  db.prepare(`
    UPDATE scheduled_deletes
    SET done = 1
    WHERE id = ?
  `).run(id);
}

/* =========================
   HISTORY
========================= */

function getHistory(
  connectionId,
  limit = 100
) {
  return db.prepare(`
    SELECT *
    FROM messages
    WHERE connection_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(
    connectionId,
    Number(limit)
  );
}

/* =========================
   STATS
========================= */

function getStats(connectionId) {
  const messages =
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM messages
      WHERE connection_id = ?
    `).get(connectionId).count;

  const edits =
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM messages
      WHERE
        connection_id = ?
        AND edited_at IS NOT NULL
    `).get(connectionId).count;

  const deleted =
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM messages
      WHERE
        connection_id = ?
        AND deleted_at IS NOT NULL
    `).get(connectionId).count;

  const events =
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM events
      WHERE connection_id = ?
    `).get(connectionId).count;

  return {
    messages,
    edits,
    deleted,
    events
  };
}

/* =========================
   HELPERS
========================= */

function safeJSON(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/* =========================
   EXPORT
========================= */

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