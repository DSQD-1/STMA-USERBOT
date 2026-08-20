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

const now = () => Math.floor(Date.now() / 1000);

function objectFromRow(row) {
  if (!row) return null;

  const result = {};

  for (const key of Object.keys(row)) {
    result[key] = row[key];
  }

  return result;
}

function json(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function normalizeUsername(value) {
  return String(value || "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase();
}

async function tableExists(name) {
  const result = await db.execute({
    sql: `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name = ?
      LIMIT 1
    `,
    args: [name]
  });

  return result.rows.length > 0;
}

async function columns(table) {
  if (!(await tableExists(table))) {
    return [];
  }

  const result = await db.execute({
    sql: `PRAGMA table_info("${table}")`
  });

  return result.rows.map((row) => String(row.name));
}

async function hasColumn(table, column) {
  const list = await columns(table);
  return list.includes(column);
}

async function addColumn(table, column, definition) {
  if (!(await tableExists(table))) return;

  if (await hasColumn(table, column)) return;

  console.log(
    `[DB MIGRATION] Adding ${table}.${column}`
  );

  await db.execute(`
    ALTER TABLE "${table}"
    ADD COLUMN "${column}" ${definition}
  `);
}

/* =========================================================
   UNIQUE INDEX HELPERS
========================================================= */

async function indexExists(indexName) {
  const result = await db.execute({
    sql: `
      SELECT name
      FROM sqlite_master
      WHERE type = 'index'
        AND name = ?
      LIMIT 1
    `,
    args: [indexName]
  });

  return result.rows.length > 0;
}

/*
 * Удаляем дубликаты сообщений.
 *
 * Для каждой пары:
 * business_connection_id + chat_id + message_id
 *
 * оставляем самую новую запись.
 */
async function removeDuplicateMessages() {
  if (!(await tableExists("messages"))) {
    return;
  }

  console.log(
    "[DB] Checking duplicate messages..."
  );

  await db.execute(`
    DELETE FROM messages
    WHERE id NOT IN (
      SELECT MAX(id)
      FROM messages
      GROUP BY
        business_connection_id,
        chat_id,
        message_id
    )
  `);

  console.log(
    "[DB] Duplicate messages cleaned."
  );
}

/*
 * Удаляем дубликаты watches.
 */
async function removeDuplicateWatches() {
  if (!(await tableExists("watches"))) {
    return;
  }

  console.log(
    "[DB] Checking duplicate watches..."
  );

  await db.execute(`
    DELETE FROM watches
    WHERE id NOT IN (
      SELECT MAX(id)
      FROM watches
      GROUP BY
        owner_telegram_id,
        business_connection_id,
        username_normalized
    )
  `);

  console.log(
    "[DB] Duplicate watches cleaned."
  );
}

async function ensureUniqueIndexes() {
  /*
   * messages
   */

  if (await tableExists("messages")) {
    await removeDuplicateMessages();

    if (
      !(await indexExists(
        "uq_messages_business_chat_message"
      ))
    ) {
      console.log(
        "[DB] Creating unique messages index..."
      );

      await db.execute(`
        CREATE UNIQUE INDEX IF NOT EXISTS
        uq_messages_business_chat_message
        ON messages(
          business_connection_id,
          chat_id,
          message_id
        )
      `);

      console.log(
        "[DB] Unique messages index created."
      );
    }
  }

  /*
   * watches
   */

  if (await tableExists("watches")) {
    await removeDuplicateWatches();

    if (
      !(await indexExists(
        "uq_watches_owner_connection_username"
      ))
    ) {
      console.log(
        "[DB] Creating unique watches index..."
      );

      await db.execute(`
        CREATE UNIQUE INDEX IF NOT EXISTS
        uq_watches_owner_connection_username
        ON watches(
          owner_telegram_id,
          business_connection_id,
          username_normalized
        )
      `);

      console.log(
        "[DB] Unique watches index created."
      );
    }
  }
}

/* =========================================================
   USERS
========================================================= */

async function migrateUsers() {
  const exists = await tableExists("users");

  if (!exists) {
    await db.execute(`
      CREATE TABLE users (
        telegram_id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        photo_url TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    console.log("[DB] Created users table.");

    return;
  }

  const oldColumns = await columns("users");

  const correct =
    oldColumns.includes("telegram_id") &&
    oldColumns.includes("created_at") &&
    oldColumns.includes("updated_at");

  if (correct) {
    await addColumn(
      "users",
      "username",
      "TEXT"
    );

    await addColumn(
      "users",
      "first_name",
      "TEXT"
    );

    await addColumn(
      "users",
      "last_name",
      "TEXT"
    );

    await addColumn(
      "users",
      "photo_url",
      "TEXT"
    );

    await db.execute(`
      UPDATE users
      SET
        created_at = COALESCE(created_at, ${now()}),
        updated_at = COALESCE(updated_at, ${now()})
      WHERE created_at IS NULL
         OR updated_at IS NULL
    `);

    return;
  }

  console.log(
    "[DB MIGRATION] Legacy users table detected."
  );

  const possibleIdColumns = [
    "telegram_id",
    "user_id",
    "id",
    "owner_telegram_id",
    "telegramId"
  ];

  const possibleUsernameColumns = [
    "username",
    "user_username",
    "telegram_username"
  ];

  const possibleFirstNameColumns = [
    "first_name",
    "firstname",
    "name"
  ];

  const possibleLastNameColumns = [
    "last_name",
    "lastname"
  ];

  const possiblePhotoColumns = [
    "photo_url",
    "avatar",
    "avatar_url"
  ];

  const findColumn = (list) =>
    list.find((column) =>
      oldColumns.includes(column)
    );

  const oldId = findColumn(
    possibleIdColumns
  );

  const oldUsername = findColumn(
    possibleUsernameColumns
  );

  const oldFirstName = findColumn(
    possibleFirstNameColumns
  );

  const oldLastName = findColumn(
    possibleLastNameColumns
  );

  const oldPhoto = findColumn(
    possiblePhotoColumns
  );

  await db.execute(`
    DROP TABLE IF EXISTS users_migration_new
  `);

  await db.execute(`
    CREATE TABLE users_migration_new (
      telegram_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      photo_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  if (oldId) {
    const usernameSql = oldUsername
      ? `"${oldUsername}"`
      : "NULL";

    const firstNameSql = oldFirstName
      ? `"${oldFirstName}"`
      : "NULL";

    const lastNameSql = oldLastName
      ? `"${oldLastName}"`
      : "NULL";

    const photoSql = oldPhoto
      ? `"${oldPhoto}"`
      : "NULL";

    await db.execute(`
      INSERT OR IGNORE INTO users_migration_new
      (
        telegram_id,
        username,
        first_name,
        last_name,
        photo_url,
        created_at,
        updated_at
      )
      SELECT
        CAST("${oldId}" AS INTEGER),
        ${usernameSql},
        ${firstNameSql},
        ${lastNameSql},
        ${photoSql},
        ${now()},
        ${now()}
      FROM users
      WHERE "${oldId}" IS NOT NULL
        AND CAST("${oldId}" AS INTEGER) > 0
    `);
  }

  const backupExists =
    await tableExists(
      "users_legacy_backup"
    );

  if (!backupExists) {
    await db.execute(`
      ALTER TABLE users
      RENAME TO users_legacy_backup
    `);
  } else {
    await db.execute(`
      DROP TABLE users
    `);
  }

  await db.execute(`
    ALTER TABLE users_migration_new
    RENAME TO users
  `);

  console.log(
    "[DB MIGRATION] users rebuilt."
  );
}

/* =========================================================
   BASE TABLES
========================================================= */

async function createTables() {
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

  await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_connection_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      sender_id INTEGER,
      sender_username TEXT,
      sender_name TEXT,
      direction TEXT NOT NULL DEFAULT 'incoming',
      text TEXT,
      caption TEXT,
      message_date INTEGER,
      edited INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

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

  await db.execute(`
    CREATE TABLE IF NOT EXISTS watches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_telegram_id INTEGER NOT NULL,
      business_connection_id TEXT NOT NULL,
      username TEXT NOT NULL,
      username_normalized TEXT NOT NULL,
      user_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )
  `);

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

async function migrateBusinessConnections() {
  await addColumn(
    "business_connections",
    "owner_telegram_id",
    "INTEGER"
  );

  await addColumn(
    "business_connections",
    "user_id",
    "INTEGER"
  );

  await addColumn(
    "business_connections",
    "username",
    "TEXT"
  );

  await addColumn(
    "business_connections",
    "first_name",
    "TEXT"
  );

  await addColumn(
    "business_connections",
    "last_name",
    "TEXT"
  );

  await addColumn(
    "business_connections",
    "user_chat_id",
    "INTEGER"
  );

  await addColumn(
    "business_connections",
    "date",
    "INTEGER"
  );

  await addColumn(
    "business_connections",
    "is_enabled",
    "INTEGER"
  );

  await addColumn(
    "business_connections",
    "rights_json",
    "TEXT"
  );

  await addColumn(
    "business_connections",
    "updated_at",
    "INTEGER"
  );

  await db.execute(`
    UPDATE business_connections
    SET owner_telegram_id = user_id
    WHERE owner_telegram_id IS NULL
      AND user_id IS NOT NULL
  `);

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
  await addColumn(
    "messages",
    "business_connection_id",
    "TEXT"
  );

  await addColumn(
    "messages",
    "chat_id",
    "TEXT"
  );

  await addColumn(
    "messages",
    "message_id",
    "INTEGER"
  );

  await addColumn(
    "messages",
    "sender_id",
    "INTEGER"
  );

  await addColumn(
    "messages",
    "sender_username",
    "TEXT"
  );

  await addColumn(
    "messages",
    "sender_name",
    "TEXT"
  );

  await addColumn(
    "messages",
    "direction",
    "TEXT"
  );

  await addColumn(
    "messages",
    "text",
    "TEXT"
  );

  await addColumn(
    "messages",
    "caption",
    "TEXT"
  );

  await addColumn(
    "messages",
    "message_date",
    "INTEGER"
  );

  await addColumn(
    "messages",
    "edited",
    "INTEGER"
  );

  await addColumn(
    "messages",
    "deleted",
    "INTEGER"
  );

  await addColumn(
    "messages",
    "raw_json",
    "TEXT"
  );

  await addColumn(
    "messages",
    "created_at",
    "INTEGER"
  );

  await addColumn(
    "messages",
    "updated_at",
    "INTEGER"
  );

  await db.execute(`
    UPDATE messages
    SET
      direction = COALESCE(direction, 'incoming'),
      edited = COALESCE(edited, 0),
      deleted = COALESCE(deleted, 0),
      raw_json = COALESCE(raw_json, '{}'),
      created_at = COALESCE(created_at, ${now()}),
      updated_at = COALESCE(updated_at, ${now()})
    WHERE
      direction IS NULL
      OR edited IS NULL
      OR deleted IS NULL
      OR raw_json IS NULL
      OR created_at IS NULL
      OR updated_at IS NULL
  `);
}

async function migrateEvents() {
  await addColumn(
    "events",
    "owner_telegram_id",
    "INTEGER"
  );

  await addColumn(
    "events",
    "business_connection_id",
    "TEXT"
  );

  await addColumn(
    "events",
    "type",
    "TEXT"
  );

  await addColumn(
    "events",
    "chat_id",
    "TEXT"
  );

  await addColumn(
    "events",
    "message_id",
    "INTEGER"
  );

  await addColumn(
    "events",
    "user_id",
    "INTEGER"
  );

  await addColumn(
    "events",
    "username",
    "TEXT"
  );

  await addColumn(
    "events",
    "payload_json",
    "TEXT"
  );

  await addColumn(
    "events",
    "created_at",
    "INTEGER"
  );

  await db.execute(`
    UPDATE events
    SET
      payload_json = COALESCE(payload_json, '{}'),
      created_at = COALESCE(created_at, ${now()})
    WHERE
      payload_json IS NULL
      OR created_at IS NULL
  `);
}

async function migrateWatches() {
  await addColumn(
    "watches",
    "owner_telegram_id",
    "INTEGER"
  );

  await addColumn(
    "watches",
    "business_connection_id",
    "TEXT"
  );

  await addColumn(
    "watches",
    "username",
    "TEXT"
  );

  await addColumn(
    "watches",
    "username_normalized",
    "TEXT"
  );

  await addColumn(
    "watches",
    "user_id",
    "INTEGER"
  );

  await addColumn(
    "watches",
    "active",
    "INTEGER"
  );

  await addColumn(
    "watches",
    "created_at",
    "INTEGER"
  );

  await db.execute(`
    UPDATE watches
    SET username_normalized =
      LOWER(
        REPLACE(
          TRIM(COALESCE(username, '')),
          '@',
          ''
        )
      )
    WHERE username_normalized IS NULL
       OR username_normalized = ''
  `);

  await db.execute(`
    UPDATE watches
    SET
      active = COALESCE(active, 1),
      created_at = COALESCE(created_at, ${now()})
    WHERE active IS NULL
       OR created_at IS NULL
  `);
}

async function migrateScheduledDeletions() {
  await addColumn(
    "scheduled_deletions",
    "owner_telegram_id",
    "INTEGER"
  );

  await addColumn(
    "scheduled_deletions",
    "business_connection_id",
    "TEXT"
  );

  await addColumn(
    "scheduled_deletions",
    "chat_id",
    "TEXT"
  );

  await addColumn(
    "scheduled_deletions",
    "message_id",
    "INTEGER"
  );

  await addColumn(
    "scheduled_deletions",
    "execute_at",
    "INTEGER"
  );

  await addColumn(
    "scheduled_deletions",
    "status",
    "TEXT"
  );

  await addColumn(
    "scheduled_deletions",
    "created_at",
    "INTEGER"
  );

  await db.execute(`
    UPDATE scheduled_deletions
    SET
      status = COALESCE(status, 'pending'),
      created_at = COALESCE(created_at, ${now()})
    WHERE
      status IS NULL
      OR created_at IS NULL
  `);
}

async function migrateCommands() {
  await addColumn(
    "commands",
    "owner_telegram_id",
    "INTEGER"
  );

  await addColumn(
    "commands",
    "business_connection_id",
    "TEXT"
  );

  await addColumn(
    "commands",
    "command_text",
    "TEXT"
  );

  await addColumn(
    "commands",
    "command_type",
    "TEXT"
  );

  await addColumn(
    "commands",
    "result",
    "TEXT"
  );

  await addColumn(
    "commands",
    "success",
    "INTEGER"
  );

  await addColumn(
    "commands",
    "created_at",
    "INTEGER"
  );

  await db.execute(`
    UPDATE commands
    SET
      success = COALESCE(success, 0),
      created_at = COALESCE(created_at, ${now()})
    WHERE
      success IS NULL
      OR created_at IS NULL
  `);
}

/* =========================================================
   INDEXES
========================================================= */

async function createIndexes() {
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_business_owner
    ON business_connections(owner_telegram_id)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_business_enabled
    ON business_connections(
      owner_telegram_id,
      is_enabled
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_messages_connection
    ON messages(
      business_connection_id,
      created_at DESC
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_messages_chat
    ON messages(
      business_connection_id,
      chat_id,
      message_id
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_events_owner
    ON events(
      owner_telegram_id,
      created_at DESC
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_events_connection
    ON events(
      business_connection_id,
      created_at DESC
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_watches_lookup
    ON watches(
      business_connection_id,
      username_normalized,
      active
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_watches_owner
    ON watches(
      owner_telegram_id,
      business_connection_id,
      active
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_deletions_pending
    ON scheduled_deletions(
      status,
      execute_at
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_commands_owner
    ON commands(
      owner_telegram_id,
      created_at DESC
    )
  `);

  /*
   * ВАЖНО:
   * Эти два индекса должны существовать ДО первого
   * INSERT ... ON CONFLICT(...)
   */
  await ensureUniqueIndexes();
}

/* =========================================================
   INIT
========================================================= */

export async function initDatabase() {
  if (initialized) return;

  console.log(
    "[DB] Starting database initialization..."
  );

  await migrateUsers();

  await createTables();

  await migrateBusinessConnections();

  await migrateMessages();

  await migrateEvents();

  await migrateWatches();

  await migrateScheduledDeletions();

  await migrateCommands();

  console.log(
    "[DB] Schema migrations completed."
  );

  await createIndexes();

  console.log(
    "[DB] Indexes checked."
  );

  initialized = true;

  console.log(
    "[DB] Database initialized successfully."
  );
}

/* =========================================================
   USERS
========================================================= */

export async function upsertUser(user) {
  const telegramId = Number(user?.id);

  if (!Number.isFinite(telegramId)) {
    throw new Error(
      "Invalid Telegram user ID"
    );
  }

  const timestamp = now();

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
    args: [
      Number(telegramId)
    ]
  });

  return objectFromRow(
    result.rows[0]
  );
}

/* =========================================================
   BUSINESS CONNECTIONS
========================================================= */

export async function upsertBusinessConnection(
  connection,
  ownerTelegramId = null
) {
  const timestamp = now();

  const user =
    connection?.user || {};

  const owner =
    ownerTelegramId != null
      ? Number(ownerTelegramId)
      : Number(user.id);

  if (!Number.isFinite(owner)) {
    throw new Error(
      "Unable to determine Business Connection owner"
    );
  }

  const userId =
    user.id != null
      ? Number(user.id)
      : owner;

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
      owner,
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
      json(connection.rights || {}),
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
    args: [
      Number(ownerTelegramId)
    ]
  });

  return result.rows.map(
    objectFromRow
  );
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

  return objectFromRow(
    result.rows[0]
  );
}

/* =========================================================
   MESSAGES
========================================================= */

export async function saveMessage(message) {
  const timestamp = now();

  const businessConnectionId =
    String(
      message.business_connection_id
    );

  const chatId =
    String(message.chat_id);

  const messageId =
    Number(message.message_id);

  /*
   * Дополнительная защита.
   *
   * Даже если старый сервер стартовал без индекса,
   * запись не должна ломать webhook.
   */
  if (
    !businessConnectionId ||
    !chatId ||
    !Number.isFinite(messageId)
  ) {
    throw new Error(
      "Invalid message identity"
    );
  }

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
      businessConnectionId,
      chatId,
      messageId,
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
      json(message.raw || {}),
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
  if (
    !Array.isArray(messageIds) ||
    !messageIds.length
  ) {
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

  return result.rows.map(
    objectFromRow
  );
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

  return objectFromRow(
    result.rows[0]
  );
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
      Number(
        event.owner_telegram_id
      ),
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
      json(event.payload || {}),
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

  return result.rows.map(
    objectFromRow
  );
}

/* =========================================================
   WATCHES
========================================================= */

export async function addWatch({
  ownerTelegramId,
  connectionId,
  username,
  userId = null
}) {
  const normalized =
    normalizeUsername(username);

  if (!normalized) {
    throw new Error(
      "Username is required"
    );
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
  const normalized =
    normalizeUsername(username);

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

  return result.rows.map(
    objectFromRow
  );
}

export async function findWatch(
  connectionId,
  username
) {
  const normalized =
    normalizeUsername(username);

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

  return objectFromRow(
    result.rows[0]
  );
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

  return result.rows.map(
    objectFromRow
  );
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
  const owner =
    Number(ownerTelegramId);

  const connection =
    String(connectionId);

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

  const count = (result) =>
    Number(
      result.rows[0]?.count || 0
    );

  return {
    messages: count(messages),
    sent: count(sent),
    deleted: count(deleted),
    events: count(events),
    watches: count(watches),
    commands: count(commands),
    connections: count(connections)
  };
}

/* =========================================================
   DEBUG
========================================================= */

export async function getDatabaseInfo() {
  const result = await db.execute(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
    ORDER BY name
  `);

  const info = {};

  for (const row of result.rows) {
    const table = String(row.name);

    info[table] = await columns(table);
  }

  return info;
}