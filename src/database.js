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

/*
==================================================
TIME
==================================================
*/

function now() {
  return Math.floor(Date.now() / 1000);
}

/*
==================================================
SAFE COLUMN MIGRATION
==================================================
*/

async function addColumnIfMissing(
  table,
  column,
  definition
) {
  const result = await db.execute(`
    PRAGMA table_info(${table})
  `);

  const exists = result.rows.some(
    row => row.name === column
  );

  if (!exists) {
    console.log(
      `🛠️ Adding column ${table}.${column}`
    );

    await db.execute(`
      ALTER TABLE ${table}
      ADD COLUMN ${column} ${definition}
    `);
  }
}

/*
==================================================
DATABASE INIT
==================================================
*/

async function initDatabase() {

  /*
  -----------------------------------------------
  BUSINESS CONNECTIONS
  -----------------------------------------------
  */

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

  /*
  -----------------------------------------------
  MESSAGES
  -----------------------------------------------
  */

  await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id TEXT NOT NULL,
      chat_id TEXT,
      message_id TEXT,
      sender_id TEXT,
      sender_username TEXT,
      sender_name TEXT,
      text TEXT,
      message_type TEXT,
      raw_json TEXT,
      created_at INTEGER
    )
  `);

  /*
  IMPORTANT:
  Старые таблицы уже существуют в Turso.
  Поэтому CREATE TABLE IF NOT EXISTS
  недостаточно.
  */

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
    "message_type",
    "TEXT"
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

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_messages_connection
    ON messages(connection_id)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_messages_chat
    ON messages(connection_id, chat_id)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_messages_sender
    ON messages(connection_id, sender_id)
  `);

  /*
  -----------------------------------------------
  MESSAGE EDITS
  -----------------------------------------------
  */

  await db.execute(`
    CREATE TABLE IF NOT EXISTS message_edits (
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

  await addColumnIfMissing(
    "message_edits",
    "sender_id",
    "TEXT"
  );

  await addColumnIfMissing(
    "message_edits",
    "text",
    "TEXT"
  );

  await addColumnIfMissing(
    "message_edits",
    "raw_json",
    "TEXT"
  );

  await addColumnIfMissing(
    "message_edits",
    "created_at",
    "INTEGER"
  );

  /*
  -----------------------------------------------
  DELETED MESSAGES
  -----------------------------------------------
  */

  await db.execute(`
    CREATE TABLE IF NOT EXISTS deleted_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id TEXT NOT NULL,
      chat_id TEXT,
      message_id TEXT,
      raw_json TEXT,
      created_at INTEGER
    )
  `);

  await addColumnIfMissing(
    "deleted_messages",
    "chat_id",
    "TEXT"
  );

  await addColumnIfMissing(
    "deleted_messages",
    "message_id",
    "TEXT"
  );

  await addColumnIfMissing(
    "deleted_messages",
    "raw_json",
    "TEXT"
  );

  await addColumnIfMissing(
    "deleted_messages",
    "created_at",
    "INTEGER"
  );

  /*
  -----------------------------------------------
  EVENTS
  -----------------------------------------------
  */

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

  await addColumnIfMissing(
    "events",
    "chat_id",
    "TEXT"
  );

  await addColumnIfMissing(
    "events",
    "message_id",
    "TEXT"
  );

  await addColumnIfMissing(
    "events",
    "data",
    "TEXT"
  );

  await addColumnIfMissing(
    "events",
    "created_at",
    "INTEGER"
  );

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_events_connection
    ON events(connection_id)
  `);

  /*
  -----------------------------------------------
  IGNORED USERS
  -----------------------------------------------
  */

  await db.execute(`
    CREATE TABLE IF NOT EXISTS ignored_users (
      connection_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at INTEGER,
      PRIMARY KEY(connection_id, user_id)
    )
  `);

  await addColumnIfMissing(
    "ignored_users",
    "created_at",
    "INTEGER"
  );

  /*
  -----------------------------------------------
  WATCH SETTINGS
  -----------------------------------------------
  */

  await db.execute(`
    CREATE TABLE IF NOT EXISTS watch_settings (
      connection_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      new_messages INTEGER DEFAULT 1,
      edited_messages INTEGER DEFAULT 1,
      deleted_messages INTEGER DEFAULT 1,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);

  /*
  -----------------------------------------------
  SETTINGS
  -----------------------------------------------
  */

  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      connection_id TEXT PRIMARY KEY,
      prefix TEXT DEFAULT '.',
      updated_at INTEGER
    )
  `);

  console.log(
    "🗄️ Database initialized"
  );
}

/*
==================================================
BUSINESS CONNECTION
==================================================
*/

async function saveBusinessConnection(
  connection
) {
  const timestamp = now();

  await db.execute({
    sql: `
      INSERT INTO business_connections (
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
      String(connection.id),

      String(
        connection.user?.id || ""
      ),

      String(
        connection.user_chat_id || ""
      ),

      connection.is_enabled ? 1 : 0,

      JSON.stringify(
        connection.rights || {}
      ),

      connection.date ||
        timestamp,

      timestamp
    ]
  });

  await db.execute({
    sql: `
      INSERT OR IGNORE INTO watch_settings (
        connection_id,
        enabled,
        new_messages,
        edited_messages,
        deleted_messages,
        created_at,
        updated_at
      )
      VALUES (?, 1, 1, 1, 1, ?, ?)
    `,
    args: [
      String(connection.id),
      timestamp,
      timestamp
    ]
  });

  await db.execute({
    sql: `
      INSERT OR IGNORE INTO settings (
        connection_id,
        prefix,
        updated_at
      )
      VALUES (?, '.', ?)
    `,
    args: [
      String(connection.id),
      timestamp
    ]
  });
}

/*
==================================================
GET BUSINESS CONNECTION
==================================================
*/

async function getBusinessConnection(
  connectionId
) {
  const result =
    await db.execute({
      sql: `
        SELECT *
        FROM business_connections
        WHERE connection_id = ?
        LIMIT 1
      `,
      args: [
        String(connectionId)
      ]
    });

  return result.rows[0] || null;
}

/*
==================================================
SAVE MESSAGE
==================================================
*/

async function saveMessage(
  message,
  connectionId
) {
  const sender =
    message.from || {};

  const text =
    message.text ||
    message.caption ||
    "";

  let messageType = "text";

  if (message.photo) {
    messageType = "photo";
  } else if (message.video) {
    messageType = "video";
  } else if (message.document) {
    messageType = "document";
  } else if (message.audio) {
    messageType = "audio";
  } else if (message.voice) {
    messageType = "voice";
  } else if (message.sticker) {
    messageType = "sticker";
  } else if (message.animation) {
    messageType = "animation";
  } else if (message.contact) {
    messageType = "contact";
  } else if (message.location) {
    messageType = "location";
  }

  await db.execute({
    sql: `
      INSERT INTO messages (
        connection_id,
        chat_id,
        message_id,
        sender_id,
        sender_username,
        sender_name,
        text,
        message_type,
        raw_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      String(connectionId),

      String(
        message.chat?.id || ""
      ),

      String(
        message.message_id || ""
      ),

      String(
        sender.id || ""
      ),

      sender.username
        ? String(sender.username)
        : null,

      [
        sender.first_name,
        sender.last_name
      ]
        .filter(Boolean)
        .join(" ") || null,

      text,

      messageType,

      JSON.stringify(message),

      message.date || now()
    ]
  });
}

/*
==================================================
SAVE EDIT
==================================================
*/

async function saveMessageEdit(
  message,
  connectionId
) {
  const sender =
    message.from || {};

  const text =
    message.text ||
    message.caption ||
    "";

  await db.execute({
    sql: `
      INSERT INTO message_edits (
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
      String(connectionId),

      String(
        message.chat?.id || ""
      ),

      String(
        message.message_id || ""
      ),

      String(
        sender.id || ""
      ),

      text,

      JSON.stringify(message),

      message.edit_date ||
        now()
    ]
  });
}

/*
==================================================
SAVE DELETED MESSAGES
==================================================
*/

async function saveDeletedMessages(
  deleted,
  connectionId
) {
  const messageIds =
    deleted.message_ids || [];

  for (
    const messageId
    of messageIds
  ) {
    await db.execute({
      sql: `
        INSERT INTO deleted_messages (
          connection_id,
          chat_id,
          message_id,
          raw_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      args: [
        String(connectionId),

        String(
          deleted.chat?.id || ""
        ),

        String(messageId),

        JSON.stringify(deleted),

        now()
      ]
    });
  }
}

/*
==================================================
EVENT
==================================================
*/

async function saveEvent({
  connectionId,
  type,
  chatId,
  messageId,
  data
}) {
  await db.execute({
    sql: `
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
    args: [
      connectionId
        ? String(connectionId)
        : null,

      type,

      chatId !== undefined &&
      chatId !== null
        ? String(chatId)
        : null,

      messageId !== undefined &&
      messageId !== null
        ? String(messageId)
        : null,

      JSON.stringify(
        data || {}
      ),

      now()
    ]
  });
}

/*
==================================================
STATS
==================================================
*/

async function getUserStats(
  connectionId
) {
  const messages =
    await db.execute({
      sql: `
        SELECT COUNT(*) AS count
        FROM messages
        WHERE connection_id = ?
      `,
      args: [
        String(connectionId)
      ]
    });

  const events =
    await db.execute({
      sql: `
        SELECT COUNT(*) AS count
        FROM events
        WHERE connection_id = ?
      `,
      args: [
        String(connectionId)
      ]
    });

  const edits =
    await db.execute({
      sql: `
        SELECT COUNT(*) AS count
        FROM message_edits
        WHERE connection_id = ?
      `,
      args: [
        String(connectionId)
      ]
    });

  const deleted =
    await db.execute({
      sql: `
        SELECT COUNT(*) AS count
        FROM deleted_messages
        WHERE connection_id = ?
      `,
      args: [
        String(connectionId)
      ]
    });

  return {
    messages:
      Number(
        messages.rows[0]?.count || 0
      ),

    events:
      Number(
        events.rows[0]?.count || 0
      ),

    edits:
      Number(
        edits.rows[0]?.count || 0
      ),

    deleted:
      Number(
        deleted.rows[0]?.count || 0
      )
  };
}

/*
==================================================
IGNORE
==================================================
*/

async function addIgnore(
  connectionId,
  userId
) {
  await db.execute({
    sql: `
      INSERT OR IGNORE INTO ignored_users (
        connection_id,
        user_id,
        created_at
      )
      VALUES (?, ?, ?)
    `,
    args: [
      String(connectionId),
      String(userId),
      now()
    ]
  });
}

async function removeIgnore(
  connectionId,
  userId
) {
  await db.execute({
    sql: `
      DELETE FROM ignored_users
      WHERE connection_id = ?
      AND user_id = ?
    `,
    args: [
      String(connectionId),
      String(userId)
    ]
  });
}

async function isIgnored(
  connectionId,
  userId
) {
  const result =
    await db.execute({
      sql: `
        SELECT 1
        FROM ignored_users
        WHERE connection_id = ?
        AND user_id = ?
        LIMIT 1
      `,
      args: [
        String(connectionId),
        String(userId)
      ]
    });

  return result.rows.length > 0;
}

async function getIgnoredUsers(
  connectionId
) {
  const result =
    await db.execute({
      sql: `
        SELECT user_id
        FROM ignored_users
        WHERE connection_id = ?
        ORDER BY created_at DESC
      `,
      args: [
        String(connectionId)
      ]
    });

  return result.rows.map(
    row => String(row.user_id)
  );
}

/*
==================================================
WATCH SETTINGS
==================================================
*/

async function setWatchSettings(
  connectionId,
  settings
) {
  const current =
    await getWatchSettings(
      connectionId
    );

  const merged = {
    ...current,
    ...settings
  };

  await db.execute({
    sql: `
      INSERT INTO watch_settings (
        connection_id,
        enabled,
        new_messages,
        edited_messages,
        deleted_messages,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)

      ON CONFLICT(connection_id)
      DO UPDATE SET
        enabled = excluded.enabled,
        new_messages = excluded.new_messages,
        edited_messages = excluded.edited_messages,
        deleted_messages = excluded.deleted_messages,
        updated_at = excluded.updated_at
    `,
    args: [
      String(connectionId),

      merged.enabled ? 1 : 0,

      merged.new_messages
        ? 1
        : 0,

      merged.edited_messages
        ? 1
        : 0,

      merged.deleted_messages
        ? 1
        : 0,

      current.created_at ||
        now(),

      now()
    ]
  });
}

async function getWatchSettings(
  connectionId
) {
  const result =
    await db.execute({
      sql: `
        SELECT *
        FROM watch_settings
        WHERE connection_id = ?
        LIMIT 1
      `,
      args: [
        String(connectionId)
      ]
    });

  if (!result.rows[0]) {
    return {
      enabled: true,
      new_messages: true,
      edited_messages: true,
      deleted_messages: true
    };
  }

  const row =
    result.rows[0];

  return {
    enabled:
      Boolean(row.enabled),

    new_messages:
      Boolean(row.new_messages),

    edited_messages:
      Boolean(
        row.edited_messages
      ),

    deleted_messages:
      Boolean(
        row.deleted_messages
      ),

    created_at:
      row.created_at
  };
}

/*
==================================================
RECENT MESSAGES
==================================================
*/

async function getRecentMessages(
  connectionId,
  limit = 10
) {
  const safeLimit =
    Math.max(
      1,
      Math.min(
        100,
        Number(limit) || 10
      )
    );

  const result =
    await db.execute({
      sql: `
        SELECT *
        FROM messages
        WHERE connection_id = ?
        ORDER BY created_at DESC
        LIMIT ${safeLimit}
      `,
      args: [
        String(connectionId)
      ]
    });

  return result.rows;
}

/*
==================================================
RECENT EVENTS
==================================================
*/

async function getRecentEvents(
  connectionId,
  limit = 10
) {
  const safeLimit =
    Math.max(
      1,
      Math.min(
        100,
        Number(limit) || 10
      )
    );

  const result =
    await db.execute({
      sql: `
        SELECT *
        FROM events
        WHERE connection_id = ?
        ORDER BY created_at DESC
        LIMIT ${safeLimit}
      `,
      args: [
        String(connectionId)
      ]
    });

  return result.rows;
}

/*
==================================================
EXPORT
==================================================
*/

module.exports = {
  db,

  initDatabase,

  saveBusinessConnection,
  getBusinessConnection,

  saveMessage,
  saveMessageEdit,
  saveDeletedMessages,

  saveEvent,

  getUserStats,

  addIgnore,
  removeIgnore,
  isIgnored,
  getIgnoredUsers,

  setWatchSettings,
  getWatchSettings,

  getRecentMessages,
  getRecentEvents
};