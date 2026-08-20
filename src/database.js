import { createClient } from "@libsql/client/web";

if (!process.env.TURSO_DATABASE_URL) {
  throw new Error("TURSO_DATABASE_URL is not set");
}

if (!process.env.TURSO_AUTH_TOKEN) {
  throw new Error("TURSO_AUTH_TOKEN is not set");
}

export const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

let initialized = false;

export async function initDatabase() {
  if (initialized) return;

  await db.batch(
    [
      `
      CREATE TABLE IF NOT EXISTS users (
        telegram_id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        photo_url TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS business_connections (
        id TEXT PRIMARY KEY,
        owner_telegram_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        user_chat_id INTEGER,
        date INTEGER,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        rights_json TEXT,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(owner_telegram_id) REFERENCES users(telegram_id)
      )
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_business_owner
      ON business_connections(owner_telegram_id)
      `,
      `
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_connection_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        message_id INTEGER NOT NULL,
        sender_id INTEGER,
        sender_username TEXT,
        sender_name TEXT,
        direction TEXT NOT NULL,
        text TEXT,
        caption TEXT,
        message_date INTEGER,
        edited INTEGER NOT NULL DEFAULT 0,
        deleted INTEGER NOT NULL DEFAULT 0,
        raw_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(business_connection_id, chat_id, message_id)
      )
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_messages_connection
      ON messages(business_connection_id, created_at DESC)
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_messages_chat
      ON messages(business_connection_id, chat_id, message_id)
      `,
      `
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_telegram_id INTEGER NOT NULL,
        business_connection_id TEXT,
        type TEXT NOT NULL,
        chat_id TEXT,
        message_id INTEGER,
        user_id INTEGER,
        username TEXT,
        payload_json TEXT,
        created_at INTEGER NOT NULL
      )
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_events_owner
      ON events(owner_telegram_id, created_at DESC)
      `,
      `
      CREATE TABLE IF NOT EXISTS watches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_telegram_id INTEGER NOT NULL,
        business_connection_id TEXT NOT NULL,
        username TEXT NOT NULL,
        username_normalized TEXT NOT NULL,
        user_id INTEGER,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        UNIQUE(owner_telegram_id, business_connection_id, username_normalized)
      )
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_watches_lookup
      ON watches(business_connection_id, username_normalized, active)
      `,
      `
      CREATE TABLE IF NOT EXISTS scheduled_deletions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_telegram_id INTEGER NOT NULL,
        business_connection_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        message_id INTEGER NOT NULL,
        execute_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL
      )
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_deletions_pending
      ON scheduled_deletions(status, execute_at)
      `,
      `
      CREATE TABLE IF NOT EXISTS commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_telegram_id INTEGER NOT NULL,
        business_connection_id TEXT NOT NULL,
        command_text TEXT NOT NULL,
        command_type TEXT,
        result TEXT,
        success INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )
      `
    ],
    "write"
  );

  initialized = true;
}

function rowToObject(row) {
  if (!row) return null;

  const result = {};

  for (const key of Object.keys(row)) {
    result[key] = row[key];
  }

  return result;
}

export async function upsertUser(user) {
  const now = Math.floor(Date.now() / 1000);

  await db.execute({
    sql: `
      INSERT INTO users
        (telegram_id, username, first_name, last_name, photo_url, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        photo_url = excluded.photo_url,
        updated_at = excluded.updated_at
    `,
    args: [
      Number(user.id),
      user.username || null,
      user.first_name || null,
      user.last_name || null,
      user.photo_url || null,
      now,
      now
    ]
  });
}

export async function getUser(telegramId) {
  const result = await db.execute({
    sql: `
      SELECT *
      FROM users
      WHERE telegram_id = ?
      LIMIT 1
    `,
    args: [Number(telegramId)]
  });

  return rowToObject(result.rows[0]);
}

export async function upsertBusinessConnection(connection) {
  const now = Math.floor(Date.now() / 1000);
  const user = connection.user || {};

  await db.execute({
    sql: `
      INSERT INTO business_connections
        (
          id,
          owner_telegram_id,
          user_id,
          username,
          first_name,
          last_name,
          user_chat_id,
          date,
          is_enabled,
          rights_json,
          updated_at
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_telegram_id = excluded.owner_telegram_id,
        user_id = excluded.user_id,
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        user_chat_id = excluded.user_chat_id,
        date = excluded.date,
        is_enabled = excluded.is_enabled,
        rights_json = excluded.rights_json,
        updated_at = excluded.updated_at
    `,
    args: [
      String(connection.id),
      Number(user.id),
      Number(user.id),
      user.username || null,
      user.first_name || null,
      user.last_name || null,
      connection.user_chat_id != null
        ? Number(connection.user_chat_id)
        : null,
      connection.date != null
        ? Number(connection.date)
        : null,
      connection.is_enabled ? 1 : 0,
      JSON.stringify(connection.rights || {}),
      now
    ]
  });
}

export async function disableBusinessConnection(connectionId) {
  await db.execute({
    sql: `
      UPDATE business_connections
      SET is_enabled = 0,
          updated_at = ?
      WHERE id = ?
    `,
    args: [
      Math.floor(Date.now() / 1000),
      String(connectionId)
    ]
  });
}

export async function getConnections(ownerTelegramId) {
  const result = await db.execute({
    sql: `
      SELECT *
      FROM business_connections
      WHERE owner_telegram_id = ?
      ORDER BY updated_at DESC
    `,
    args: [Number(ownerTelegramId)]
  });

  return result.rows.map(rowToObject);
}

export async function getConnectionForOwner(
  connectionId,
  ownerTelegramId
) {
  const result = await db.execute({
    sql: `
      SELECT *
      FROM business_connections
      WHERE id = ?
        AND owner_telegram_id = ?
      LIMIT 1
    `,
    args: [
      String(connectionId),
      Number(ownerTelegramId)
    ]
  });

  return rowToObject(result.rows[0]);
}

export async function saveMessage(message) {
  const now = Math.floor(Date.now() / 1000);

  await db.execute({
    sql: `
      INSERT INTO messages
      (
        business_connection_id,
        chat_id,
        message_id,
        sender_id,
        sender_username,
        sender_name,
        direction,
        text,
        caption,
        message_date,
        edited,
        deleted,
        raw_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(business_connection_id, chat_id, message_id)
      DO UPDATE SET
        sender_id = excluded.sender_id,
        sender_username = excluded.sender_username,
        sender_name = excluded.sender_name,
        direction = excluded.direction,
        text = excluded.text,
        caption = excluded.caption,
        message_date = excluded.message_date,
        edited = excluded.edited,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at
    `,
    args: [
      String(message.business_connection_id),
      String(message.chat_id),
      Number(message.message_id),
      message.sender_id != null
        ? Number(message.sender_id)
        : null,
      message.sender_username || null,
      message.sender_name || null,
      message.direction || "incoming",
      message.text || null,
      message.caption || null,
      message.message_date != null
        ? Number(message.message_date)
        : null,
      message.edited ? 1 : 0,
      message.deleted ? 1 : 0,
      JSON.stringify(message.raw || {}),
      now,
      now
    ]
  });
}

export async function markMessagesDeleted(
  businessConnectionId,
  chatId,
  messageIds
) {
  if (!messageIds.length) return;

  for (const messageId of messageIds) {
    await db.execute({
      sql: `
        UPDATE messages
        SET deleted = 1,
            updated_at = ?
        WHERE business_connection_id = ?
          AND chat_id = ?
          AND message_id = ?
      `,
      args: [
        Math.floor(Date.now() / 1000),
        String(businessConnectionId),
        String(chatId),
        Number(messageId)
      ]
    });
  }
}

export async function getMessages(
  businessConnectionId,
  limit = 100,
  offset = 0
) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const result = await db.execute({
    sql: `
      SELECT *
      FROM messages
      WHERE business_connection_id = ?
      ORDER BY message_date DESC, id DESC
      LIMIT ? OFFSET ?
    `,
    args: [
      String(businessConnectionId),
      safeLimit,
      safeOffset
    ]
  });

  return result.rows.map(rowToObject);
}

export async function getMessage(
  businessConnectionId,
  chatId,
  messageId
) {
  const result = await db.execute({
    sql: `
      SELECT *
      FROM messages
      WHERE business_connection_id = ?
        AND chat_id = ?
        AND message_id = ?
      LIMIT 1
    `,
    args: [
      String(businessConnectionId),
      String(chatId),
      Number(messageId)
    ]
  });

  return rowToObject(result.rows[0]);
}

export async function addEvent(event) {
  await db.execute({
    sql: `
      INSERT INTO events
      (
        owner_telegram_id,
        business_connection_id,
        type,
        chat_id,
        message_id,
        user_id,
        username,
        payload_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      Number(event.owner_telegram_id),
      event.business_connection_id || null,
      event.type,
      event.chat_id != null ? String(event.chat_id) : null,
      event.message_id != null ? Number(event.message_id) : null,
      event.user_id != null ? Number(event.user_id) : null,
      event.username || null,
      JSON.stringify(event.payload || {}),
      Math.floor(Date.now() / 1000)
    ]
  });
}

export async function getEvents(
  ownerTelegramId,
  connectionId,
  limit = 100
) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);

  const result = await db.execute({
    sql: `
      SELECT *
      FROM events
      WHERE owner_telegram_id = ?
        AND (
          ? IS NULL
          OR business_connection_id = ?
        )
      ORDER BY created_at DESC
      LIMIT ?
    `,
    args: [
      Number(ownerTelegramId),
      connectionId || null,
      connectionId || null,
      safeLimit
    ]
  });

  return result.rows.map(rowToObject);
}

export async function addWatch({
  ownerTelegramId,
  connectionId,
  username,
  userId = null
}) {
  const normalized = String(username)
    .replace(/^@/, "")
    .trim()
    .toLowerCase();

  await db.execute({
    sql: `
      INSERT INTO watches
      (
        owner_telegram_id,
        business_connection_id,
        username,
        username_normalized,
        user_id,
        active,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(
        owner_telegram_id,
        business_connection_id,
        username_normalized
      )
      DO UPDATE SET
        active = 1,
        user_id = excluded.user_id
    `,
    args: [
      Number(ownerTelegramId),
      String(connectionId),
      `@${normalized}`,
      normalized,
      userId != null ? Number(userId) : null,
      Math.floor(Date.now() / 1000)
    ]
  });
}

export async function removeWatch(
  ownerTelegramId,
  connectionId,
  username
) {
  const normalized = String(username)
    .replace(/^@/, "")
    .trim()
    .toLowerCase();

  await db.execute({
    sql: `
      UPDATE watches
      SET active = 0
      WHERE owner_telegram_id = ?
        AND business_connection_id = ?
        AND username_normalized = ?
    `,
    args: [
      Number(ownerTelegramId),
      String(connectionId),
      normalized
    ]
  });
}

export async function getWatches(
  ownerTelegramId,
  connectionId
) {
  const result = await db.execute({
    sql: `
      SELECT *
      FROM watches
      WHERE owner_telegram_id = ?
        AND business_connection_id = ?
        AND active = 1
      ORDER BY created_at DESC
    `,
    args: [
      Number(ownerTelegramId),
      String(connectionId)
    ]
  });

  return result.rows.map(rowToObject);
}

export async function findWatch(
  connectionId,
  username
) {
  const normalized = String(username || "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase();

  const result = await db.execute({
    sql: `
      SELECT *
      FROM watches
      WHERE business_connection_id = ?
        AND username_normalized = ?
        AND active = 1
      LIMIT 1
    `,
    args: [
      String(connectionId),
      normalized
    ]
  });

  return rowToObject(result.rows[0]);
}

export async function createScheduledDeletion(data) {
  await db.execute({
    sql: `
      INSERT INTO scheduled_deletions
      (
        owner_telegram_id,
        business_connection_id,
        chat_id,
        message_id,
        execute_at,
        status,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `,
    args: [
      Number(data.ownerTelegramId),
      String(data.connectionId),
      String(data.chatId),
      Number(data.messageId),
      Number(data.executeAt),
      Math.floor(Date.now() / 1000)
    ]
  });
}

export async function getPendingDeletions() {
  const result = await db.execute({
    sql: `
      SELECT *
      FROM scheduled_deletions
      WHERE status = 'pending'
      ORDER BY execute_at ASC
    `
  });

  return result.rows.map(rowToObject);
}

export async function completeDeletion(id, status = "done") {
  await db.execute({
    sql: `
      UPDATE scheduled_deletions
      SET status = ?
      WHERE id = ?
    `,
    args: [status, Number(id)]
  });
}

export async function saveCommand(data) {
  await db.execute({
    sql: `
      INSERT INTO commands
      (
        owner_telegram_id,
        business_connection_id,
        command_text,
        command_type,
        result,
        success,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      Number(data.ownerTelegramId),
      String(data.connectionId),
      String(data.commandText),
      data.commandType || null,
      data.result || null,
      data.success ? 1 : 0,
      Math.floor(Date.now() / 1000)
    ]
  });
}

export async function getStats(
  ownerTelegramId,
  connectionId
) {
  const owner = Number(ownerTelegramId);
  const connection = String(connectionId);

  const [
    messages,
    sent,
    deleted,
    events,
    watches,
    commands,
    connections
  ] = await Promise.all([
    db.execute({
      sql: `
        SELECT COUNT(*) AS count
        FROM messages
        WHERE business_connection_id = ?
      `,
      args: [connection]
    }),

    db.execute({
      sql: `
        SELECT COUNT(*) AS count
        FROM messages
        WHERE business_connection_id = ?
          AND direction = 'outgoing'
      `,
      args: [connection]
    }),

    db.execute({
      sql: `
        SELECT COUNT(*) AS count
        FROM messages
        WHERE business_connection_id = ?
          AND deleted = 1
      `,
      args: [connection]
    }),

    db.execute({
      sql: `
        SELECT COUNT(*) AS count
        FROM events
        WHERE owner_telegram_id = ?
          AND business_connection_id = ?
      `,
      args: [owner, connection]
    }),

    db.execute({
      sql: `
        SELECT COUNT(*) AS count
        FROM watches
        WHERE owner_telegram_id = ?
          AND business_connection_id = ?
          AND active = 1
      `,
      args: [owner, connection]
    }),

    db.execute({
      sql: `
        SELECT COUNT(*) AS count
        FROM commands
        WHERE owner_telegram_id = ?
          AND business_connection_id = ?
      `,
      args: [owner, connection]
    }),

    db.execute({
      sql: `
        SELECT COUNT(*) AS count
        FROM business_connections
        WHERE owner_telegram_id = ?
          AND is_enabled = 1
      `,
      args: [owner]
    })
  ]);

  const value = (result) =>
    Number(result.rows[0]?.count || 0);

  return {
    messages: value(messages),
    sent: value(sent),
    deleted: value(deleted),
    events: value(events),
    watches: value(watches),
    commands: value(commands),
    connections: value(connections)
  };
}