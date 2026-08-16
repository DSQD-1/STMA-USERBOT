const { createClient } = require("@libsql/client");

if (!process.env.TURSO_DATABASE_URL) {
  throw new Error("TURSO_DATABASE_URL is missing");
}

if (!process.env.TURSO_AUTH_TOKEN) {
  throw new Error("TURSO_AUTH_TOKEN is missing");
}

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

async function initDatabase() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS business_connections (
      connection_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_chat_id TEXT,
      is_enabled INTEGER DEFAULT 1,
      rights TEXT,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id TEXT NOT NULL,
      chat_id TEXT,
      message_id TEXT,
      sender_id TEXT,
      text TEXT,
      raw_json TEXT,
      created_at INTEGER
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id TEXT,
      type TEXT NOT NULL,
      chat_id TEXT,
      message_id TEXT,
      data TEXT,
      created_at INTEGER
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS ignored_users (
      connection_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY(connection_id, user_id)
    )
  `);

  console.log("Database initialized");
}

async function saveBusinessConnection(connection) {
  const now = Math.floor(Date.now() / 1000);

  await db.execute({
    sql: `
      INSERT INTO business_connections
      (
        connection_id,
        user_id,
        user_chat_id,
        is_enabled,
        rights,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)

      ON CONFLICT(connection_id)
      DO UPDATE SET
        user_id = excluded.user_id,
        user_chat_id = excluded.user_chat_id,
        is_enabled = excluded.is_enabled,
        rights = excluded.rights,
        updated_at = excluded.updated_at
    `,
    args: [
      connection.id,
      String(connection.user?.id || ""),
      String(connection.user_chat_id || ""),
      connection.is_enabled ? 1 : 0,
      JSON.stringify(connection.rights || {}),
      connection.date || now,
      now
    ]
  });
}

async function getBusinessConnection(connectionId) {
  const result = await db.execute({
    sql: `
      SELECT *
      FROM business_connections
      WHERE connection_id = ?
      LIMIT 1
    `,
    args: [connectionId]
  });

  return result.rows[0] || null;
}

async function saveMessage(message, connectionId) {
  const text =
    message.text ||
    message.caption ||
    "";

  await db.execute({
    sql: `
      INSERT INTO messages
      (
        connection_id,
        chat_id,
        message_id,
        sender_id,
        text,
        raw_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      connectionId,
      String(message.chat?.id || ""),
      String(message.message_id || ""),
      String(message.from?.id || ""),
      text,
      JSON.stringify(message),
      Math.floor(Date.now() / 1000)
    ]
  });
}

async function saveEvent({
  connectionId,
  type,
  chatId,
  messageId,
  data
}) {
  await db.execute({
    sql: `
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
    `,
    args: [
      connectionId || null,
      type,
      chatId ? String(chatId) : null,
      messageId ? String(messageId) : null,
      JSON.stringify(data || {}),
      Math.floor(Date.now() / 1000)
    ]
  });
}

async function getUserStats(connectionId) {
  const messages = await db.execute({
    sql: `
      SELECT COUNT(*) AS count
      FROM messages
      WHERE connection_id = ?
    `,
    args: [connectionId]
  });

  const events = await db.execute({
    sql: `
      SELECT COUNT(*) AS count
      FROM events
      WHERE connection_id = ?
    `,
    args: [connectionId]
  });

  return {
    messages: Number(messages.rows[0]?.count || 0),
    events: Number(events.rows[0]?.count || 0)
  };
}

async function addIgnore(connectionId, userId) {
  await db.execute({
    sql: `
      INSERT OR IGNORE INTO ignored_users
      (connection_id, user_id)
      VALUES (?, ?)
    `,
    args: [
      connectionId,
      String(userId)
    ]
  });
}

async function removeIgnore(connectionId, userId) {
  await db.execute({
    sql: `
      DELETE FROM ignored_users
      WHERE connection_id = ?
      AND user_id = ?
    `,
    args: [
      connectionId,
      String(userId)
    ]
  });
}

async function isIgnored(connectionId, userId) {
  const result = await db.execute({
    sql: `
      SELECT 1
      FROM ignored_users
      WHERE connection_id = ?
      AND user_id = ?
      LIMIT 1
    `,
    args: [
      connectionId,
      String(userId)
    ]
  });

  return result.rows.length > 0;
}

module.exports = {
  db,
  initDatabase,
  saveBusinessConnection,
  getBusinessConnection,
  saveMessage,
  saveEvent,
  getUserStats,
  addIgnore,
  removeIgnore,
  isIgnored
};