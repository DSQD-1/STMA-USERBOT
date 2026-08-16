const { createClient } = require("@libsql/client");

/*
==================================================
TURSO
==================================================
*/

const TURSO_DATABASE_URL =
  process.env.TURSO_DATABASE_URL;

const TURSO_AUTH_TOKEN =
  process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DATABASE_URL) {
  throw new Error(
    "TURSO_DATABASE_URL не задан"
  );
}

if (!TURSO_AUTH_TOKEN) {
  throw new Error(
    "TURSO_AUTH_TOKEN не задан"
  );
}

const client = createClient({
  url: TURSO_DATABASE_URL,
  authToken: TURSO_AUTH_TOKEN
});

/*
==================================================
HELPERS
==================================================
*/

function now() {
  return Math.floor(Date.now() / 1000);
}

function json(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return JSON.stringify(value);
}

function parseJSON(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function execute(sql, args = []) {
  await ready();

  return client.execute({
    sql,
    args
  });
}

/*
==================================================
DATABASE INIT
==================================================
*/

let initialized = false;
let initPromise = null;

async function initDatabase() {
  if (initialized) {
    return;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    console.log(
      "Initializing Turso database..."
    );

    /*
    ================================================
    CREATE TABLES
    ================================================
    */

    await client.batch(
      [
        {
          sql: `
            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY,
              value TEXT
            )
          `
        },

        {
          sql: `
            CREATE TABLE IF NOT EXISTS business_connections (
              id TEXT PRIMARY KEY,
              user_id INTEGER,
              username TEXT,
              first_name TEXT,
              last_name TEXT,
              is_enabled INTEGER NOT NULL DEFAULT 1,
              rights TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            )
          `
        },

        {
          sql: `
            CREATE TABLE IF NOT EXISTS messages (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              connection_id TEXT NOT NULL,
              chat_id INTEGER NOT NULL,
              message_id INTEGER NOT NULL,
              sender_id INTEGER,
              sender_username TEXT,
              sender_name TEXT,
              text TEXT,
              created_at INTEGER NOT NULL,
              edited_at INTEGER,
              deleted_at INTEGER,
              UNIQUE(
                connection_id,
                chat_id,
                message_id
              )
            )
          `
        },

        {
          sql: `
            CREATE TABLE IF NOT EXISTS mutes (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              connection_id TEXT NOT NULL,
              user_id INTEGER,
              username TEXT,
              expires_at INTEGER,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            )
          `
        },

        {
          sql: `
            CREATE TABLE IF NOT EXISTS watches (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              connection_id TEXT NOT NULL,
              target TEXT NOT NULL,
              enabled INTEGER NOT NULL DEFAULT 1,
              last_data TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            )
          `
        },

        {
          sql: `
            CREATE TABLE IF NOT EXISTS events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              connection_id TEXT NOT NULL,
              type TEXT NOT NULL,
              chat_id INTEGER,
              message_id INTEGER,
              data TEXT,
              created_at INTEGER NOT NULL
            )
          `
        },

        {
          sql: `
            CREATE TABLE IF NOT EXISTS scheduled_deletes (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              connection_id TEXT NOT NULL,
              chat_id INTEGER NOT NULL,
              message_id INTEGER NOT NULL,
              delete_at INTEGER NOT NULL,
              done INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL,
              completed_at INTEGER,
              error TEXT
            )
          `
        }
      ],
      "write"
    );

    /*
    ================================================
    MIGRATION
    ================================================
    */

    console.log(
      "Checking database schema..."
    );

    /*
    BUSINESS CONNECTIONS
    */

    const connectionInfo =
      await client.execute(`
        PRAGMA table_info(business_connections)
      `);

    const connectionColumns =
      connectionInfo.rows.map(
        row => String(row.name)
      );

    /*
    Если старая база использовала
    connection_id вместо id —
    переносим данные.
    */

    if (
      !connectionColumns.includes("id")
    ) {
      console.log(
        "Old business_connections schema detected."
      );

      /*
      Добавляем id.
      */

      await client.execute(`
        ALTER TABLE business_connections
        ADD COLUMN id TEXT
      `);

      /*
      Если была connection_id —
      переносим её в id.
      */

      if (
        connectionColumns.includes(
          "connection_id"
        )
      ) {
        await client.execute(`
          UPDATE business_connections
          SET id = connection_id
          WHERE id IS NULL
        `);
      }

      /*
      Если была business_connection_id —
      переносим её в id.
      */

      if (
        connectionColumns.includes(
          "business_connection_id"
        )
      ) {
        await client.execute(`
          UPDATE business_connections
          SET id = business_connection_id
          WHERE id IS NULL
        `);
      }

      /*
      Если старые записи вообще
      не имеют идентификатора,
      генерируем его.
      */

      const missingIds =
        await client.execute(`
          SELECT rowid
          FROM business_connections
          WHERE id IS NULL
        `);

      for (
        const row of missingIds.rows
      ) {
        await client.execute({
          sql: `
            UPDATE business_connections
            SET id = ?
            WHERE rowid = ?
          `,
          args: [
            `legacy_${row.rowid}`,
            row.rowid
          ]
        });
      }

      /*
      Уникальный индекс.
      */

      await client.execute(`
        CREATE UNIQUE INDEX IF NOT EXISTS
        idx_business_connections_id
        ON business_connections(id)
      `);

      console.log(
        "business_connections migration completed."
      );
    }

    /*
    ================================================
    ADD MISSING COLUMNS
    ================================================
    */

    async function ensureColumn(
      table,
      column,
      definition
    ) {
      const info =
        await client.execute(
          `PRAGMA table_info(${table})`
        );

      const exists =
        info.rows.some(
          row =>
            String(row.name) ===
            column
        );

      if (!exists) {
        console.log(
          `Adding ${table}.${column}...`
        );

        await client.execute(
          `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
        );
      }
    }

    /*
    BUSINESS CONNECTIONS
    */

    await ensureColumn(
      "business_connections",
      "user_id",
      "INTEGER"
    );

    await ensureColumn(
      "business_connections",
      "username",
      "TEXT"
    );

    await ensureColumn(
      "business_connections",
      "first_name",
      "TEXT"
    );

    await ensureColumn(
      "business_connections",
      "last_name",
      "TEXT"
    );

    await ensureColumn(
      "business_connections",
      "is_enabled",
      "INTEGER DEFAULT 1"
    );

    await ensureColumn(
      "business_connections",
      "rights",
      "TEXT"
    );

    await ensureColumn(
      "business_connections",
      "created_at",
      "INTEGER"
    );

    await ensureColumn(
      "business_connections",
      "updated_at",
      "INTEGER"
    );

    /*
    MESSAGES
    */

    await ensureColumn(
      "messages",
      "connection_id",
      "TEXT"
    );

    await ensureColumn(
      "messages",
      "chat_id",
      "INTEGER"
    );

    await ensureColumn(
      "messages",
      "message_id",
      "INTEGER"
    );

    await ensureColumn(
      "messages",
      "sender_id",
      "INTEGER"
    );

    await ensureColumn(
      "messages",
      "sender_username",
      "TEXT"
    );

    await ensureColumn(
      "messages",
      "sender_name",
      "TEXT"
    );

    await ensureColumn(
      "messages",
      "text",
      "TEXT"
    );

    await ensureColumn(
      "messages",
      "created_at",
      "INTEGER"
    );

    await ensureColumn(
      "messages",
      "edited_at",
      "INTEGER"
    );

    await ensureColumn(
      "messages",
      "deleted_at",
      "INTEGER"
    );

    /*
    MUTES
    */

    await ensureColumn(
      "mutes",
      "connection_id",
      "TEXT"
    );

    await ensureColumn(
      "mutes",
      "user_id",
      "INTEGER"
    );

    await ensureColumn(
      "mutes",
      "username",
      "TEXT"
    );

    await ensureColumn(
      "mutes",
      "expires_at",
      "INTEGER"
    );

    await ensureColumn(
      "mutes",
      "created_at",
      "INTEGER"
    );

    await ensureColumn(
      "mutes",
      "updated_at",
      "INTEGER"
    );

    /*
    WATCHES
    */

    await ensureColumn(
      "watches",
      "connection_id",
      "TEXT"
    );

    await ensureColumn(
      "watches",
      "target",
      "TEXT"
    );

    await ensureColumn(
      "watches",
      "enabled",
      "INTEGER DEFAULT 1"
    );

    await ensureColumn(
      "watches",
      "last_data",
      "TEXT"
    );

    await ensureColumn(
      "watches",
      "created_at",
      "INTEGER"
    );

    await ensureColumn(
      "watches",
      "updated_at",
      "INTEGER"
    );

    /*
    EVENTS
    */

    await ensureColumn(
      "events",
      "connection_id",
      "TEXT"
    );

    await ensureColumn(
      "events",
      "type",
      "TEXT"
    );

    await ensureColumn(
      "events",
      "chat_id",
      "INTEGER"
    );

    await ensureColumn(
      "events",
      "message_id",
      "INTEGER"
    );

    await ensureColumn(
      "events",
      "data",
      "TEXT"
    );

    await ensureColumn(
      "events",
      "created_at",
      "INTEGER"
    );

    /*
    SCHEDULED DELETES
    */

    await ensureColumn(
      "scheduled_deletes",
      "connection_id",
      "TEXT"
    );

    await ensureColumn(
      "scheduled_deletes",
      "chat_id",
      "INTEGER"
    );

    await ensureColumn(
      "scheduled_deletes",
      "message_id",
      "INTEGER"
    );

    await ensureColumn(
      "scheduled_deletes",
      "delete_at",
      "INTEGER"
    );

    await ensureColumn(
      "scheduled_deletes",
      "done",
      "INTEGER DEFAULT 0"
    );

    await ensureColumn(
      "scheduled_deletes",
      "created_at",
      "INTEGER"
    );

    await ensureColumn(
      "scheduled_deletes",
      "completed_at",
      "INTEGER"
    );

    await ensureColumn(
      "scheduled_deletes",
      "error",
      "TEXT"
    );

    /*
    ================================================
    INDEXES
    ================================================
    */

    await client.batch(
      [
        {
          sql: `
            CREATE INDEX IF NOT EXISTS
            idx_connections_user
            ON business_connections(user_id)
          `
        },

        {
          sql: `
            CREATE INDEX IF NOT EXISTS
            idx_connections_enabled
            ON business_connections(is_enabled)
          `
        },

        {
          sql: `
            CREATE INDEX IF NOT EXISTS
            idx_messages_connection
            ON messages(connection_id)
          `
        },

        {
          sql: `
            CREATE INDEX IF NOT EXISTS
            idx_mutes_connection
            ON mutes(connection_id)
          `
        },

        {
          sql: `
            CREATE INDEX IF NOT EXISTS
            idx_watches_connection
            ON watches(connection_id)
          `
        },

        {
          sql: `
            CREATE INDEX IF NOT EXISTS
            idx_events_connection
            ON events(connection_id)
          `
        },

        {
          sql: `
            CREATE INDEX IF NOT EXISTS
            idx_deletes_due
            ON scheduled_deletes(done, delete_at)
          `
        }
      ],
      "write"
    );

    /*
    ================================================
    FILL NULL TIMESTAMPS
    ================================================
    */

    const timestamp = now();

    await client.execute({
      sql: `
        UPDATE business_connections
        SET created_at = ?
        WHERE created_at IS NULL
      `,
      args: [timestamp]
    });

    await client.execute({
      sql: `
        UPDATE business_connections
        SET updated_at = ?
        WHERE updated_at IS NULL
      `,
      args: [timestamp]
    });

    await client.execute({
      sql: `
        UPDATE messages
        SET created_at = ?
        WHERE created_at IS NULL
      `,
      args: [timestamp]
    });

    await client.execute({
      sql: `
        UPDATE mutes
        SET created_at = ?
        WHERE created_at IS NULL
      `,
      args: [timestamp]
    });

    await client.execute({
      sql: `
        UPDATE mutes
        SET updated_at = ?
        WHERE updated_at IS NULL
      `,
      args: [timestamp]
    });

    await client.execute({
      sql: `
        UPDATE watches
        SET created_at = ?
        WHERE created_at IS NULL
      `,
      args: [timestamp]
    });

    await client.execute({
      sql: `
        UPDATE watches
        SET updated_at = ?
        WHERE updated_at IS NULL
      `,
      args: [timestamp]
    });

    await client.execute({
      sql: `
        UPDATE events
        SET created_at = ?
        WHERE created_at IS NULL
      `,
      args: [timestamp]
    });

    await client.execute({
      sql: `
        UPDATE scheduled_deletes
        SET created_at = ?
        WHERE created_at IS NULL
      `,
      args: [timestamp]
    });

    /*
    ================================================
    DONE
    ================================================
    */

    initialized = true;

    console.log(
      "Turso database initialized"
    );
  })();

  try {
    await initPromise;
  } catch (error) {
    initPromise = null;

    console.error(
      "TURSO INIT ERROR:",
      error
    );

    throw error;
  }
}

async function ready() {
  await initDatabase();
}

/*
==================================================
SETTINGS
==================================================
*/

async function getSetting(key) {
  const result = await execute(
    `
      SELECT value
      FROM settings
      WHERE key = ?
      LIMIT 1
    `,
    [String(key)]
  );

  return result.rows[0]?.value ?? null;
}

async function setSetting(key, value) {
  await execute(
    `
      INSERT INTO settings(key, value)
      VALUES (?, ?)
      ON CONFLICT(key)
      DO UPDATE SET
        value = excluded.value
    `,
    [
      String(key),
      String(value)
    ]
  );

  return value;
}

/*
==================================================
BUSINESS CONNECTIONS
==================================================
*/

async function saveBusinessConnection(
  connection
) {
  if (!connection?.id) {
    throw new Error(
      "Business connection ID отсутствует"
    );
  }

  const existing =
    await getBusinessConnection(
      connection.id
    );

  const user =
    connection.user || {};

  const timestamp = now();

  const record = {
    id: String(connection.id),

    user_id:
      user.id ??
      existing?.user_id ??
      null,

    username:
      user.username ??
      existing?.username ??
      null,

    first_name:
      user.first_name ??
      existing?.first_name ??
      null,

    last_name:
      user.last_name ??
      existing?.last_name ??
      null,

    is_enabled:
      connection.is_enabled === false
        ? 0
        : 1,

    rights:
      connection.rights
        ? json(connection.rights)
        : existing?.rights
          ? json(existing.rights)
          : null,

    created_at:
      existing?.created_at ||
      timestamp,

    updated_at:
      timestamp
  };

  await execute(
    `
      INSERT INTO business_connections (
        id,
        user_id,
        username,
        first_name,
        last_name,
        is_enabled,
        rights,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)

      ON CONFLICT(id)
      DO UPDATE SET
        user_id = excluded.user_id,
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        is_enabled = excluded.is_enabled,
        rights = excluded.rights,
        updated_at = excluded.updated_at
    `,
    [
      record.id,
      record.user_id,
      record.username,
      record.first_name,
      record.last_name,
      record.is_enabled,
      record.rights,
      record.created_at,
      record.updated_at
    ]
  );

  return record;
}

async function getBusinessConnection(id) {
  const result = await execute(
    `
      SELECT *
      FROM business_connections
      WHERE id = ?
      LIMIT 1
    `,
    [String(id)]
  );

  if (!result.rows[0]) {
    return null;
  }

  return {
    ...result.rows[0],
    rights:
      parseJSON(
        result.rows[0].rights
      )
  };
}

async function getConnectionsForUser(
  userId
) {
  const result = await execute(
    `
      SELECT *
      FROM business_connections
      WHERE user_id = ?
        AND is_enabled = 1
      ORDER BY updated_at DESC
    `,
    [Number(userId)]
  );

  return result.rows.map(row => ({
    ...row,
    rights:
      parseJSON(row.rights)
  }));
}

async function getActiveConnectionForUser(
  userId
) {
  const rows =
    await getConnectionsForUser(
      userId
    );

  return rows[0] || null;
}

async function getActiveConnection() {
  const result = await execute(
    `
      SELECT *
      FROM business_connections
      WHERE is_enabled = 1
      ORDER BY updated_at DESC
      LIMIT 1
    `
  );

  return result.rows[0] || null;
}

async function disableBusinessConnection(
  id
) {
  const result = await execute(
    `
      UPDATE business_connections
      SET
        is_enabled = 0,
        updated_at = ?
      WHERE id = ?
    `,
    [
      now(),
      String(id)
    ]
  );

  return Number(
    result.rowsAffected || 0
  ) > 0;
}

async function enableBusinessConnection(
  id
) {
  const result = await execute(
    `
      UPDATE business_connections
      SET
        is_enabled = 1,
        updated_at = ?
      WHERE id = ?
    `,
    [
      now(),
      String(id)
    ]
  );

  return Number(
    result.rowsAffected || 0
  ) > 0;
}

/*
==================================================
MESSAGES
==================================================
*/

async function saveMessage(
  message,
  connectionId
) {
  if (!message) {
    return null;
  }

  const chatId =
    message?.chat?.id;

  const messageId =
    message?.message_id;

  if (
    chatId === undefined ||
    messageId === undefined
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
      .join(" ") || null;

  await execute(
    `
      INSERT INTO messages (
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

      ON CONFLICT(
        connection_id,
        chat_id,
        message_id
      )
      DO UPDATE SET
        sender_id = excluded.sender_id,
        sender_username =
          excluded.sender_username,
        sender_name =
          excluded.sender_name,
        text =
          excluded.text
    `,
    [
      String(connectionId),
      Number(chatId),
      Number(messageId),
      senderId,
      senderUsername,
      senderName,
      text,
      now()
    ]
  );

  return true;
}

async function markEdited(
  message,
  connectionId
) {
  const chatId =
    message?.chat?.id;

  const messageId =
    message?.message_id;

  const text =
    message?.text ||
    message?.caption ||
    "";

  const result =
    await execute(
      `
        UPDATE messages
        SET
          text = ?,
          edited_at = ?
        WHERE connection_id = ?
          AND chat_id = ?
          AND message_id = ?
      `,
      [
        text,
        now(),
        String(connectionId),
        Number(chatId),
        Number(messageId)
      ]
    );

  if (
    Number(
      result.rowsAffected || 0
    ) === 0
  ) {
    await saveMessage(
      message,
      connectionId
    );
  }

  return true;
}

async function markDeleted(
  connectionId,
  chatId,
  messageIds
) {
  if (
    !Array.isArray(messageIds) ||
    !messageIds.length
  ) {
    return 0;
  }

  let changed = 0;

  for (
    const messageId of messageIds
  ) {
    const result =
      await execute(
        `
          UPDATE messages
          SET deleted_at = ?
          WHERE connection_id = ?
            AND chat_id = ?
            AND message_id = ?
            AND deleted_at IS NULL
        `,
        [
          now(),
          String(connectionId),
          Number(chatId),
          Number(messageId)
        ]
      );

    changed += Number(
      result.rowsAffected || 0
    );
  }

  return changed;
}

async function getHistory(
  connectionId,
  limit = 100
) {
  const result =
    await execute(
      `
        SELECT *
        FROM messages
        WHERE connection_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
      [
        String(connectionId),
        Math.max(
          1,
          Number(limit) || 100
        )
      ]
    );

  return result.rows;
}

/*
==================================================
MUTES
==================================================
*/

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

async function addMute(
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
      ? normalizeUsername(username)
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

  let existing = null;

  if (numericUserId !== null) {
    const result =
      await execute(
        `
          SELECT *
          FROM mutes
          WHERE connection_id = ?
            AND user_id = ?
          LIMIT 1
        `,
        [
          String(connectionId),
          numericUserId
        ]
      );

    existing =
      result.rows[0] || null;
  }

  if (
    !existing &&
    cleanUsername
  ) {
    const result =
      await execute(
        `
          SELECT *
          FROM mutes
          WHERE connection_id = ?
            AND lower(username) = ?
          LIMIT 1
        `,
        [
          String(connectionId),
          cleanUsername
        ]
      );

    existing =
      result.rows[0] || null;
  }

  const timestamp = now();

  if (existing) {
    await execute(
      `
        UPDATE mutes
        SET
          user_id = ?,
          username = ?,
          expires_at = ?,
          updated_at = ?
        WHERE id = ?
      `,
      [
        numericUserId ??
          existing.user_id ??
          null,

        cleanUsername ??
          existing.username ??
          null,

        expiresAt,

        timestamp,

        existing.id
      ]
    );

    return true;
  }

  await execute(
    `
      INSERT INTO mutes (
        connection_id,
        user_id,
        username,
        expires_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      String(connectionId),
      numericUserId,
      cleanUsername,
      expiresAt,
      timestamp,
      timestamp
    ]
  );

  return true;
}

async function removeMute(
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
      ? normalizeUsername(username)
      : null;

  if (numericUserId !== null) {
    const result =
      await execute(
        `
          DELETE FROM mutes
          WHERE connection_id = ?
            AND user_id = ?
        `,
        [
          String(connectionId),
          numericUserId
        ]
      );

    return Number(
      result.rowsAffected || 0
    );
  }

  if (cleanUsername) {
    const result =
      await execute(
        `
          DELETE FROM mutes
          WHERE connection_id = ?
            AND lower(username) = ?
        `,
        [
          String(connectionId),
          cleanUsername
        ]
      );

    return Number(
      result.rowsAffected || 0
    );
  }

  return 0;
}

async function isMuted(
  connectionId,
  userId = null,
  username = null
) {
  await execute(
    `
      DELETE FROM mutes
      WHERE expires_at IS NOT NULL
        AND expires_at <= ?
    `,
    [now()]
  );

  const numericUserId =
    userId === null ||
    userId === undefined ||
    userId === ""
      ? null
      : Number(userId);

  const cleanUsername =
    username
      ? normalizeUsername(username)
      : null;

  if (numericUserId !== null) {
    const result =
      await execute(
        `
          SELECT id
          FROM mutes
          WHERE connection_id = ?
            AND user_id = ?
          LIMIT 1
        `,
        [
          String(connectionId),
          numericUserId
        ]
      );

    if (result.rows.length) {
      return true;
    }
  }

  if (cleanUsername) {
    const result =
      await execute(
        `
          SELECT id
          FROM mutes
          WHERE connection_id = ?
            AND lower(username) = ?
          LIMIT 1
        `,
        [
          String(connectionId),
          cleanUsername
        ]
      );

    return result.rows.length > 0;
  }

  return false;
}

async function findMute(
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
      ? normalizeUsername(username)
      : null;

  if (numericUserId !== null) {
    const result =
      await execute(
        `
          SELECT *
          FROM mutes
          WHERE connection_id = ?
            AND user_id = ?
          LIMIT 1
        `,
        [
          String(connectionId),
          numericUserId
        ]
      );

    if (result.rows[0]) {
      return result.rows[0];
    }
  }

  if (cleanUsername) {
    const result =
      await execute(
        `
          SELECT *
          FROM mutes
          WHERE connection_id = ?
            AND lower(username) = ?
          LIMIT 1
        `,
        [
          String(connectionId),
          cleanUsername
        ]
      );

    return result.rows[0] || null;
  }

  return null;
}

async function getMutes(
  connectionId
) {
  await execute(
    `
      DELETE FROM mutes
      WHERE expires_at IS NOT NULL
        AND expires_at <= ?
    `,
    [now()]
  );

  const result =
    await execute(
      `
        SELECT *
        FROM mutes
        WHERE connection_id = ?
        ORDER BY created_at DESC
      `,
      [String(connectionId)]
    );

  return result.rows;
}

/*
==================================================
WATCHES
==================================================
*/

async function addWatch(
  connectionId,
  target
) {
  const cleanTarget =
    String(target || "").trim();

  if (!cleanTarget) {
    throw new Error(
      "Укажи username или Telegram ID"
    );
  }

  const existing =
    await execute(
      `
        SELECT *
        FROM watches
        WHERE connection_id = ?
          AND lower(target) = lower(?)
          AND enabled = 1
        LIMIT 1
      `,
      [
        String(connectionId),
        cleanTarget
      ]
    );

  if (existing.rows.length) {
    return existing.rows[0];
  }

  const count =
    await execute(
      `
        SELECT COUNT(*) AS count
        FROM watches
        WHERE connection_id = ?
          AND enabled = 1
      `,
      [String(connectionId)]
    );

  if (
    Number(
      count.rows[0]?.count || 0
    ) >= 10
  ) {
    throw new Error(
      "Максимум 10 активных слежек"
    );
  }

  const timestamp = now();

  const result =
    await execute(
      `
        INSERT INTO watches (
          connection_id,
          target,
          enabled,
          last_data,
          created_at,
          updated_at
        )
        VALUES (?, ?, 1, NULL, ?, ?)
      `,
      [
        String(connectionId),
        cleanTarget,
        timestamp,
        timestamp
      ]
    );

  return {
    id:
      Number(
        result.lastInsertRowid
      ),

    connection_id:
      String(connectionId),

    target:
      cleanTarget,

    enabled: 1,

    last_data: null,

    created_at:
      timestamp,

    updated_at:
      timestamp
  };
}

async function getWatches(
  connectionId
) {
  const result =
    await execute(
      `
        SELECT *
        FROM watches
        WHERE connection_id = ?
        ORDER BY created_at DESC
      `,
      [String(connectionId)]
    );

  return result.rows.map(
    row => ({
      ...row,
      last_data:
        parseJSON(row.last_data)
    })
  );
}

async function removeWatch(
  connectionId,
  id
) {
  const result =
    await execute(
      `
        DELETE FROM watches
        WHERE connection_id = ?
          AND id = ?
      `,
      [
        String(connectionId),
        Number(id)
      ]
    );

  return Number(
    result.rowsAffected || 0
  ) > 0;
}

async function updateWatch(
  connectionId,
  id,
  data
) {
  const timestamp = now();

  await execute(
    `
      UPDATE watches
      SET
        last_data = ?,
        updated_at = ?
      WHERE connection_id = ?
        AND id = ?
    `,
    [
      json(data),
      timestamp,
      String(connectionId),
      Number(id)
    ]
  );

  return true;
}

/*
==================================================
EVENTS
==================================================
*/

async function addEvent({
  connectionId,
  type,
  chatId = null,
  messageId = null,
  data = {}
}) {
  await execute(
    `
      INSERT INTO events (
        connection_id,
        type,
        chat_id,
        message_id,
        data,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      String(connectionId),
      String(type),

      chatId === null
        ? null
        : Number(chatId),

      messageId === null
        ? null
        : Number(messageId),

      json(data),

      now()
    ]
  );

  return true;
}

async function getEvents(
  connectionId,
  limit = 100
) {
  const result =
    await execute(
      `
        SELECT *
        FROM events
        WHERE connection_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
      [
        String(connectionId),
        Math.max(
          1,
          Number(limit) || 100
        )
      ]
    );

  return result.rows.map(
    row => ({
      ...row,
      data:
        parseJSON(row.data)
    })
  );
}

/*
==================================================
SCHEDULED DELETE
==================================================
*/

async function scheduleDelete(
  connectionId,
  chatId,
  messageId,
  deleteAt
) {
  const timestamp = now();

  const result =
    await execute(
      `
        INSERT INTO scheduled_deletes (
          connection_id,
          chat_id,
          message_id,
          delete_at,
          done,
          created_at
        )
        VALUES (?, ?, ?, ?, 0, ?)
      `,
      [
        String(connectionId),
        Number(chatId),
        Number(messageId),
        Number(deleteAt),
        timestamp
      ]
    );

  return {
    id:
      Number(
        result.lastInsertRowid
      ),

    connection_id:
      String(connectionId),

    chat_id:
      Number(chatId),

    message_id:
      Number(messageId),

    delete_at:
      Number(deleteAt),

    done: 0,

    created_at:
      timestamp
  };
}

async function getDueDeletes() {
  const result =
    await execute(
      `
        SELECT *
        FROM scheduled_deletes
        WHERE done = 0
          AND delete_at <= ?
        ORDER BY delete_at ASC
      `,
      [now()]
    );

  return result.rows;
}

async function markDeleteDone(
  id
) {
  const result =
    await execute(
      `
        UPDATE scheduled_deletes
        SET
          done = 1,
          completed_at = ?
        WHERE id = ?
      `,
      [
        now(),
        Number(id)
      ]
    );

  return Number(
    result.rowsAffected || 0
  ) > 0;
}

async function markDeleteError(
  id,
  error
) {
  const result =
    await execute(
      `
        UPDATE scheduled_deletes
        SET error = ?
        WHERE id = ?
      `,
      [
        String(error || ""),
        Number(id)
      ]
    );

  return Number(
    result.rowsAffected || 0
  ) > 0;
}

/*
==================================================
STATS
==================================================
*/

async function getStats(
  connectionId
) {
  const result =
    await execute(
      `
        SELECT

          (
            SELECT COUNT(*)
            FROM messages
            WHERE connection_id = ?
          ) AS messages,

          (
            SELECT COUNT(*)
            FROM messages
            WHERE connection_id = ?
              AND edited_at IS NOT NULL
          ) AS edits,

          (
            SELECT COUNT(*)
            FROM messages
            WHERE connection_id = ?
              AND deleted_at IS NOT NULL
          ) AS deleted,

          (
            SELECT COUNT(*)
            FROM events
            WHERE connection_id = ?
          ) AS events,

          (
            SELECT COUNT(*)
            FROM mutes
            WHERE connection_id = ?
              AND (
                expires_at IS NULL
                OR expires_at > ?
              )
          ) AS mutes,

          (
            SELECT COUNT(*)
            FROM watches
            WHERE connection_id = ?
              AND enabled = 1
          ) AS watches
      `,
      [
        String(connectionId),
        String(connectionId),
        String(connectionId),
        String(connectionId),
        String(connectionId),
        now(),
        String(connectionId)
      ]
    );

  const row =
    result.rows[0] || {};

  return {
    messages:
      Number(row.messages || 0),

    edits:
      Number(row.edits || 0),

    deleted:
      Number(row.deleted || 0),

    events:
      Number(row.events || 0),

    mutes:
      Number(row.mutes || 0),

    watches:
      Number(row.watches || 0)
  };
}

/*
==================================================
EXPORT
==================================================
*/

module.exports = {
  client,

  initDatabase,
  ready,

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