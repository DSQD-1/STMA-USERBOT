import { createClient } from "@libsql/client/web";

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DATABASE_URL) {
  throw new Error("TURSO_DATABASE_URL is not set");
}

if (!TURSO_AUTH_TOKEN) {
  throw new Error("TURSO_AUTH_TOKEN is not set");
}

export const db = createClient({
  url: TURSO_DATABASE_URL,
  authToken: TURSO_AUTH_TOKEN
});

let initialized = false;

/* =========================================================
   HELPERS
========================================================= */

function now() {
  return Math.floor(Date.now() / 1000);
}

function rowToObject(row) {
  if (!row) return null;

  const result = {};

  for (const key of Object.keys(row)) {
    result[key] = row[key];
  }

  return result;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function safeJson(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

/* =========================================================
   DATABASE INSPECTION
========================================================= */

async function tableExists(tableName) {
  const result = await db.execute({
    sql: `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name = ?
      LIMIT 1
    `,
    args: [tableName]
  });

  return result.rows.length > 0;
}

async function getTableColumns(tableName) {
  const result = await db.execute({
    sql: `PRAGMA table_info(${tableName})`
  });

  return result.rows.map((row) => String(row.name));
}

async function columnExists(tableName, columnName) {
  const columns = await getTableColumns(tableName);

  return columns.includes(columnName);
}

async function addColumnIfMissing(
  tableName,
  columnName,
  definition
) {
  const exists = await tableExists(tableName);

  if (!exists) {
    return;
  }

  const existsColumn = await columnExists(
    tableName,
    columnName
  );

  if (existsColumn) {
    return;
  }

  console.log(
    `[DB MIGRATION] Adding ${tableName}.${columnName}`
  );

  await db.execute({
    sql: `
      ALTER TABLE ${tableName}
      ADD COLUMN ${columnName} ${definition}
    `
  });
}

async function createIndexSafe(
  indexName,
  tableName,
  columns
) {
  try {
    await db.execute({
      sql: `
        CREATE INDEX IF NOT EXISTS ${indexName}
        ON ${tableName}(${columns})
      `
    });
  } catch (error) {
    console.error(
      `[DB] Failed to create index ${indexName}:`,
      error?.message || error
    );

    throw error;
  }
}

/* =========================================================
   INITIAL SCHEMA
========================================================= */

async function createBaseTables() {
  /*
   * USERS
   */

  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      photo_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  /*
   * BUSINESS CONNECTIONS
   */

  await db.execute(`
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
      updated_at INTEGER NOT NULL
    )
  `);

  /*
   * MESSAGES
   */

  await db.execute(`
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
      UNIQUE(
        business_connection_id,
        chat_id,
        message_id
      )
    )
  `);

  /*
   * EVENTS
   */

  await db.execute(`
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
  `);

  /*
   * WATCHES
   */

  await db.execute(`
    CREATE TABLE IF NOT EXISTS watches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_telegram_id INTEGER NOT NULL,
      business_connection_id TEXT NOT NULL,
      username TEXT NOT NULL,
      username_normalized TEXT NOT NULL,
      user_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      UNIQUE(
        owner_telegram_id,
        business_connection_id,
        username_normalized
      )
    )
  `);

  /*
   * SCHEDULED DELETIONS
   */

  await db.execute(`
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
  `);

  /*
   * COMMANDS
   */

  await db.execute(`
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
  `);
}

/* =========================================================
   MIGRATIONS
========================================================= */

async function migrateUsers() {
  await addColumnIfMissing(
    "users",
    "username",
    "TEXT"
  );

  await addColumnIfMissing(
    "users",
    "first_name",
    "TEXT"
  );

  await addColumnIfMissing(
    "users",
    "last_name",
    "TEXT"
  );

  await addColumnIfMissing(
    "users",
    "photo_url",
    "TEXT"
  );

  await addColumnIfMissing(
    "users",
    "created_at",
    "INTEGER"
  );

  await addColumnIfMissing(
    "users",
    "updated_at",
    "INTEGER"
  );

  /*
   * Старые записи могли существовать без timestamp.
   */

  await db.execute(`
    UPDATE users
    SET created_at = COALESCE(created_at, ${now()}),
        updated_at = COALESCE(updated_at, ${now()})
    WHERE created_at IS NULL
       OR updated_at IS NULL
  `);
}

async function migrateBusinessConnections() {
  /*
   * КЛЮЧЕВОЙ FIX:
   *
   * Если таблица была создана старой версией,
   * owner_telegram_id добавится автоматически.
   */

  await addColumnIfMissing(
    "business_connections",
    "owner_telegram_id",
    "INTEGER"
  );

  await addColumnIfMissing(
    "business_connections",
    "user_id",
    "INTEGER"
  );

  await addColumnIfMissing(
    "business_connections",
    "username",
    "TEXT"
  );

  await addColumnIfMissing(
    "business_connections",
    "first_name",
    "TEXT"
  );

  await addColumnIfMissing(
    "business_connections",
    "last_name",
    "TEXT"
  );

  await addColumnIfMissing(
    "business_connections",
    "user_chat_id",
    "INTEGER"
  );

  await addColumnIfMissing(
    "business_connections",
    "date",
    "INTEGER"
  );

  await addColumnIfMissing(
    "business_connections",
    "is_enabled",
    "INTEGER"
  );

  await addColumnIfMissing(
    "business_connections",
    "rights_json",
    "TEXT"
  );

  await addColumnIfMissing(
    "business_connections",
    "updated_at",
    "INTEGER"
  );

  /*
   * Старые записи.
   *
   * Если owner_telegram_id отсутствует,
   * пытаемся восстановить его из user_id.
   */

  if (
    await columnExists(
      "business_connections",
      "owner_telegram_id"
    )
  ) {
    if (
      await columnExists(
        "business_connections",
        "user_id"
      )
    ) {
      await db.execute(`
        UPDATE business_connections
        SET owner_telegram_id = user_id
        WHERE owner_telegram_id IS NULL
          AND user_id IS NOT NULL
      `);
    }
  }

  /*
   * Значения по умолчанию для старых строк.
   */

  await db.execute(`
    UPDATE business_connections
    SET is_enabled = COALESCE(is_enabled, 1)
    WHERE is_enabled IS NULL
  `);

  await db.execute(`
    UPDATE business_connections
    SET rights_json = COALESCE(rights_json, '{}')
    WHERE rights_json IS NULL
  `);

  await db.execute(`
    UPDATE business_connections
    SET updated_at = COALESCE(updated_at, ${now()})
    WHERE updated_at IS NULL
  `);
}

async function migrateMessages() {
  await addColumnIfMissing(
    "messages",
    "business_connection_id",
    "TEXT"
  );

  await addColumnIfMissing(
    "messages",
    "chat_id",
    "TEXT"
  );

  await addColumnIfMissing(
    "messages",
    "message_id",
    "INTEGER"
  );

  await addColumnIfMissing(
    "messages",
    "sender_id",
    "INTEGER"
  );

  await addColumnIfMissing(
    "messages",
    "sender_username",
    "TEXT"
  );

  await addColumnIfMissing(
    "messages",
    "sender_name",
    "TEXT"
  );

  await addColumnIfMissing(
    "messages",
    "direction",
    "TEXT"
  );

  await addColumnIfMissing(
    "messages",
    "text",
    "TEXT"
  );

  await addColumnIfMissing(
    "messages",
    "caption",
    "TEXT"
  );

  await addColumnIfMissing(
    "messages",
    "message_date",
    "INTEGER"
  );

  await addColumnIfMissing(
    "messages",
    "edited",
    "INTEGER"
  );

  await addColumnIfMissing(
    "messages",
    "deleted",
    "INTEGER"
  );

  await addColumnIfMissing(
    "messages",
    "raw_json",
    "TEXT"
  );

  await addColumnIfMissing(
    "messages",
    "created_at",
    "INTEGER"
  );

  await addColumnIfMissing(
    "messages",
    "updated_at",
    "INTEGER"
  );

  await db.execute(`
    UPDATE messages
    SET direction = COALESCE(direction, 'incoming')
    WHERE direction IS NULL
  `);

  await db.execute(`
    UPDATE messages
    SET edited = COALESCE(edited, 0)
    WHERE edited IS NULL
  `);

  await db.execute(`
    UPDATE messages
    SET deleted = COALESCE(deleted, 0)
    WHERE deleted IS NULL
  `);

  await db.execute(`
    UPDATE messages
    SET raw_json = COALESCE(raw_json, '{}')
    WHERE raw_json IS NULL
  `);

  await db.execute(`
    UPDATE messages
    SET created_at = COALESCE(created_at, ${now()}),
        updated_at = COALESCE(updated_at, ${now()})
    WHERE created_at IS NULL
       OR updated_at IS NULL
  `);
}

async function migrateEvents() {
  await addColumnIfMissing(
    "events",
    "owner_telegram_id",
    "INTEGER"
  );

  await addColumnIfMissing(
    "events",
    "business_connection_id",
    "TEXT"
  );

  await addColumnIfMissing(
    "events",
    "type",
    "TEXT"
  );

  await addColumnIfMissing(
    "events",
    "chat_id",
    "TEXT"
  );

  await addColumnIfMissing(
    "events",
    "message_id",
    "INTEGER"
  );

  await addColumnIfMissing(
    "events",
    "user_id",
    "INTEGER"
  );

  await addColumnIfMissing(
    "events",
    "username",
    "TEXT"
  );

  await addColumnIfMissing(
    "events",
    "payload_json",
    "TEXT"
  );

  await addColumnIfMissing(
    "events",
    "created_at",
    "INTEGER"
  );

  await db.execute(`
    UPDATE events
    SET payload_json = COALESCE(payload_json, '{}')
    WHERE payload_json IS NULL
  `);

  await db.execute(`
    UPDATE events
    SET created_at = COALESCE(created_at, ${now()})
    WHERE created_at IS NULL
  `);
}

async function migrateWatches() {
  await addColumnIfMissing(
    "watches",
    "owner_telegram_id",
    "INTEGER"
  );

  await addColumnIfMissing(
    "watches",
    "business_connection_id",
    "TEXT"
  );

  await addColumnIfMissing(
    "watches",
    "username",
    "TEXT"
  );

  await addColumnIfMissing(
    "watches",
    "username_normalized",
    "TEXT"
  );

  await addColumnIfMissing(
    "watches",
    "user_id",
    "INTEGER"
  );

  await addColumnIfMissing(
    "watches",
    "active",
    "INTEGER"
  );

  await addColumnIfMissing(
    "watches",
    "created_at",
    "INTEGER"
  );

  await db.execute(`
    UPDATE watches
    SET username_normalized =
      LOWER(
        REPLACE(
          TRIM(username),
          '@',
          ''
        )
      )
    WHERE username_normalized IS NULL
       OR username_normalized = ''
  `);

  await db.execute(`
    UPDATE watches
    SET active = COALESCE(active, 1)
    WHERE active IS NULL
  `);

  await db.execute(`
    UPDATE watches
    SET created_at = COALESCE(created_at, ${now()})
    WHERE created_at IS NULL
  `);
}

async function migrateScheduledDeletions() {
  await addColumnIfMissing(
    "scheduled_deletions",
    "owner_telegram_id",
    "INTEGER"
  );

  await addColumnIfMissing(
    "scheduled_deletions",
    "business_connection_id",
    "TEXT"
  );

  await addColumnIfMissing(
    "scheduled_deletions",
    "chat_id",
    "TEXT"
  );

  await addColumnIfMissing(
    "scheduled_deletions",
    "message_id",
    "INTEGER"
  );

  await addColumnIfMissing(
    "scheduled_deletions",
    "execute_at",
    "INTEGER"
  );

  await addColumnIfMissing(
    "scheduled_deletions",
    "status",
    "TEXT"
  );

  await addColumnIfMissing(
    "scheduled_deletions",
    "created_at",
    "INTEGER"
  );

  await db.execute(`
    UPDATE scheduled_deletions
    SET status = COALESCE(status, 'pending')
    WHERE status IS NULL
  `);

  await db.execute(`
    UPDATE scheduled_deletions
    SET created_at = COALESCE(created_at, ${now()})
    WHERE created_at IS NULL
  `);
}

async function migrateCommands() {
  await addColumnIfMissing(
    "commands",
    "owner_telegram_id",
    "INTEGER"
  );

  await addColumnIfMissing(
    "commands",
    "business_connection_id",
    "TEXT"
  );

  await addColumnIfMissing(
    "commands",
    "command_text",
    "TEXT"
  );

  await addColumnIfMissing(
    "commands",
    "command_type",
    "TEXT"
  );

  await addColumnIfMissing(
    "commands",
    "result",
    "TEXT"
  );

  await addColumnIfMissing(
    "commands",
    "success",
    "INTEGER"
  );

  await addColumnIfMissing(
    "commands",
    "created_at",
    "INTEGER"
  );

  await db.execute(`
    UPDATE commands
    SET success = COALESCE(success, 0)
    WHERE success IS NULL
  `);

  await db.execute(`
    UPDATE commands
    SET created_at = COALESCE(created_at, ${now()})
    WHERE created_at IS NULL
  `);
}

/* =========================================================
   INDEXES
========================================================= */

async function createIndexes() {
  /*
   * Индексы создаются ТОЛЬКО после миграций.
   *
   * Поэтому ошибка:
   *
   * no such column: owner_telegram_id
   *
   * больше не должна возникать из-за старой схемы.
   */

  await createIndexSafe(
    "idx_business_owner",
    "business_connections",
    "owner_telegram_id"
  );

  await createIndexSafe(
    "idx_business_enabled",
    "business_connections",
    "owner_telegram_id, is_enabled"
  );

  await createIndexSafe(
    "idx_messages_connection",
    "messages",
    "business_connection_id, created_at DESC"
  );

  await createIndexSafe(
    "idx_messages_chat",
    "messages",
    "business_connection_id, chat_id, message_id"
  );

  await createIndexSafe(
    "idx_messages_sender",
    "messages",
    "business_connection_id, sender_id"
  );

  await createIndexSafe(
    "idx_events_owner",
    "events",
    "owner_telegram_id, created_at DESC"
  );

  await createIndexSafe(
    "idx_events_connection",
    "events",
    "business_connection_id, created_at DESC"
  );

  await createIndexSafe(
    "idx_watches_lookup",
    "watches",
    "business_connection_id, username_normalized, active"
  );

  await createIndexSafe(
    "idx_watches_owner",
    "watches",
    "owner_telegram_id, business_connection_id, active"
  );

  await createIndexSafe(
    "idx_deletions_pending",
    "scheduled_deletions",
    "status, execute_at"
  );

  await createIndexSafe(
    "idx_deletions_owner",
    "scheduled_deletions",
    "owner_telegram_id, status, execute_at"
  );

  await createIndexSafe(
    "idx_commands_owner",
    "commands",
    "owner_telegram_id, created_at DESC"
  );
}

/* =========================================================
   DATABASE INITIALIZATION
========================================================= */

export async function initDatabase() {
  if (initialized) {
    return;
  }

  console.log("[DB] Starting database initialization...");

  /*
   * 1. Создаём отсутствующие таблицы.
   */

  await createBaseTables();

  console.log("[DB] Base tables checked.");

  /*
   * 2. Мигрируем старые таблицы.
   */

  await migrateUsers();

  await migrateBusinessConnections();

  await migrateMessages();

  await migrateEvents();

  await migrateWatches();

  await migrateScheduledDeletions();

  await migrateCommands();

  console.log("[DB] Schema migrations completed.");

  /*
   * 3. Только после миграций создаём индексы.
   */

  await createIndexes();

  console.log("[DB] Indexes checked.");

  initialized = true;

  console.log("[DB] Database initialized successfully.");
}

/* =========================================================
   USERS
========================================================= */

export async function upsertUser(user) {
  const timestamp = now();

  const telegramId = Number(user.id);

  if (!Number.isFinite(telegramId)) {
    throw new Error("Invalid Telegram user ID");
  }

  await db.execute({
    sql: `
      INSERT INTO users
      (
        telegram_id,
        username,
        first_name,
        last_name,
        photo_url,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)

      ON CONFLICT(telegram_id)
      DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        photo_url = excluded.photo_url,
        updated_at = excluded.updated_at
    `,
    args: [
      telegramId,
      user.username || null,
      user.first_name || null,
      user.last_name || null,
      user.photo_url || null,
      timestamp,
      timestamp
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

/* =========================================================
   BUSINESS CONNECTIONS
========================================================= */

export async function upsertBusinessConnection(
  connection,
  ownerTelegramId = null
) {
  const timestamp = now();

  const user = connection.user || {};

  /*
   * Для Business Connection владельцем является
   * Telegram-пользователь, которому принадлежит
   * Business Connection.
   */

  const ownerId =
    ownerTelegramId != null
      ? Number(ownerTelegramId)
      : Number(user.id);

  if (!Number.isFinite(ownerId)) {
    throw new Error(
      "Unable to determine Business Connection owner"
    );
  }

  const userId =
    user.id != null
      ? Number(user.id)
      : ownerId;

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

      ON CONFLICT(id)
      DO UPDATE SET
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
      ownerId,
      userId,
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
      safeJson(connection.rights || {}),
      timestamp
    ]
  });
}

export async function disableBusinessConnection(
  connectionId
) {
  await db.execute({
    sql: `
      UPDATE business_connections
      SET
        is_enabled = 0,
        updated_at = ?
      WHERE id = ?
    `,
    args: [
      now(),
      String(connectionId)
    ]
  });
}

export async function getConnections(
  ownerTelegramId
) {
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

/* =========================================================
   MESSAGES
========================================================= */

export async function saveMessage(message) {
  const timestamp = now();

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

      ON CONFLICT(
        business_connection_id,
        chat_id,
        message_id
      )
      DO UPDATE SET
        sender_id = excluded.sender_id,
        sender_username = excluded.sender_username,
        sender_name = excluded.sender_name,
        direction = excluded.direction,
        text = excluded.text,
        caption = excluded.caption,
        message_date = excluded.message_date,
        edited = excluded.edited,
        deleted = excluded.deleted,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at
    `,
    args: [
      String(message.business_connection_id),
      String(message.chat_id),
      Number(message.message_id),
      numberOrNull(message.sender_id),
      message.sender_username || null,
      message.sender_name || null,
      message.direction || "incoming",
      message.text || null,
      message.caption || null,
      numberOrNull(message.message_date),
      message.edited ? 1 : 0,
      message.deleted ? 1 : 0,
      safeJson(message.raw || {}),
      timestamp,
      timestamp
    ]
  });
}

export async function markMessagesDeleted(
  businessConnectionId,
  chatId,
  messageIds
) {
  if (!Array.isArray(messageIds) || !messageIds.length) {
    return;
  }

  for (const messageId of messageIds) {
    await db.execute({
      sql: `
        UPDATE messages
        SET
          deleted = 1,
          updated_at = ?
        WHERE business_connection_id = ?
          AND chat_id = ?
          AND message_id = ?
      `,
      args: [
        now(),
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
  const safeLimit = Math.min(
    Math.max(Number(limit) || 100, 1),
    200
  );

  const safeOffset = Math.max(
    Number(offset) || 0,
    0
  );

  const result = await db.execute({
    sql: `
      SELECT *
      FROM messages
      WHERE business_connection_id = ?
      ORDER BY
        message_date DESC,
        id DESC
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

/* =========================================================
   EVENTS
========================================================= */

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
      String(event.type),
      event.chat_id != null
        ? String(event.chat_id)
        : null,
      event.message_id != null
        ? Number(event.message_id)
        : null,
      event.user_id != null
        ? Number(event.user_id)
        : null,
      event.username || null,
      safeJson(event.payload || {}),
      now()
    ]
  });
}

export async function getEvents(
  ownerTelegramId,
  connectionId,
  limit = 100
) {
  const safeLimit = Math.min(
    Math.max(Number(limit) || 100, 1),
    200
  );

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

/* =========================================================
   WATCHES
========================================================= */

function normalizeUsername(username) {
  return String(username || "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase();
}

export async function addWatch({
  ownerTelegramId,
  connectionId,
  username,
  userId = null
}) {
  const normalized = normalizeUsername(username);

  if (!normalized) {
    throw new Error("Username is required");
  }

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
        user_id = excluded.user_id,
        username = excluded.username
    `,
    args: [
      Number(ownerTelegramId),
      String(connectionId),
      `@${normalized}`,
      normalized,
      userId != null
        ? Number(userId)
        : null,
      now()
    ]
  });
}

export async function removeWatch(
  ownerTelegramId,
  connectionId,
  username
) {
  const normalized = normalizeUsername(username);

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
  const normalized = normalizeUsername(username);

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

/* =========================================================
   SCHEDULED DELETIONS
========================================================= */

export async function createScheduledDeletion(
  data
) {
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
      now()
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

export async function completeDeletion(
  id,
  status = "done"
) {
  await db.execute({
    sql: `
      UPDATE scheduled_deletions
      SET status = ?
      WHERE id = ?
    `,
    args: [
      String(status),
      Number(id)
    ]
  });
}

/* =========================================================
   COMMANDS
========================================================= */

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
      now()
    ]
  });
}

/* =========================================================
   STATISTICS
========================================================= */

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
      args: [
        owner,
        connection
      ]
    }),

    db.execute({
      sql: `
        SELECT COUNT(*) AS count
        FROM watches
        WHERE owner_telegram_id = ?
          AND business_connection_id = ?
          AND active = 1
      `,
      args: [
        owner,
        connection
      ]
    }),

    db.execute({
      sql: `
        SELECT COUNT(*) AS count
        FROM commands
        WHERE owner_telegram_id = ?
          AND business_connection_id = ?
      `,
      args: [
        owner,
        connection
      ]
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

  const value = (result) => {
    return Number(
      result.rows[0]?.count || 0
    );
  };

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

/* =========================================================
   OPTIONAL ADMIN / DEBUG HELPERS
========================================================= */

export async function getDatabaseInfo() {
  const tables = await db.execute(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
    ORDER BY name
  `);

  const result = {};

  for (const row of tables.rows) {
    const tableName = String(row.name);

    result[tableName] = await getTableColumns(
      tableName
    );
  }

  return result;
}