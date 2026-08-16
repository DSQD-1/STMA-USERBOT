const { createClient } = require("@libsql/client");

/*
==================================================
DATABASE
==================================================
*/

const url =
  process.env.TURSO_DATABASE_URL ||
  "file:stma.db";

const authToken =
  process.env.TURSO_AUTH_TOKEN || undefined;

const db = createClient({
  url,
  ...(authToken
    ? { authToken }
    : {})
});

/*
==================================================
INIT
==================================================
*/

let initialized = false;

async function init() {
  if (initialized) {
    return;
  }

  await db.batch(
    [
      {
        sql: `
          CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
          )
        `,
        args: []
      },

      {
        sql: `
          CREATE TABLE IF NOT EXISTS business_connections (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            username TEXT,
            first_name TEXT,
            is_enabled INTEGER DEFAULT 1,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `,
        args: []
      },

      {
        sql: `
          CREATE INDEX IF NOT EXISTS
          idx_business_connections_user
          ON business_connections(user_id)
        `,
        args: []
      },

      {
        sql: `
          CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            connection_id TEXT NOT NULL,
            chat_id INTEGER,
            message_id INTEGER,
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
        `,
        args: []
      },

      {
        sql: `
          CREATE INDEX IF NOT EXISTS
          idx_messages_connection
          ON messages(connection_id)
        `,
        args: []
      },

      {
        sql: `
          CREATE TABLE IF NOT EXISTS mutes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            connection_id TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            username TEXT,
            expires_at INTEGER,
            created_at INTEGER NOT NULL,

            UNIQUE(
              connection_id,
              user_id
            )
          )
        `,
        args: []
      },

      {
        sql: `
          CREATE TABLE IF NOT EXISTS watches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            connection_id TEXT NOT NULL,
            target TEXT NOT NULL,
            enabled INTEGER DEFAULT 1,
            last_data TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `,
        args: []
      },

      {
        sql: `
          CREATE INDEX IF NOT EXISTS
          idx_watches_connection
          ON watches(connection_id)
        `,
        args: []
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
        `,
        args: []
      },

      {
        sql: `
          CREATE INDEX IF NOT EXISTS
          idx_events_connection
          ON events(connection_id)
        `,
        args: []
      },

      {
        sql: `
          CREATE TABLE IF NOT EXISTS scheduled_deletes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            connection_id TEXT NOT NULL,
            chat_id INTEGER NOT NULL,
            message_id INTEGER NOT NULL,
            delete_at INTEGER NOT NULL,
            done INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL
          )
        `,
        args: []
      }
    ],
    "write"
  );

  initialized = true;

  console.log("DATABASE: initialized");
}

/*
==================================================
HELPERS
==================================================
*/

function now() {
  return Math.floor(
    Date.now() / 1000
  );
}

function safeJSON(value) {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/*
==================================================
SETTINGS
==================================================
*/

async function getSetting(key) {
  await init();

  const result =
    await db.execute({
      sql: `
        SELECT value
        FROM settings
        WHERE key = ?
      `,
      args: [key]
    });

  return result.rows[0]?.value ?? null;
}

async function setSetting(
  key,
  value
) {
  await init();

  await db.execute({
    sql: `
      INSERT INTO settings (
        key,
        value
      )
      VALUES (?, ?)

      ON CONFLICT(key)
      DO UPDATE SET
        value = excluded.value
    `,
    args: [
      key,
      String(value)
    ]
  });

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
  await init();

  const timestamp = now();

  const userId =
    Number(
      connection?.user?.id ||
      connection?.user_id ||
      0
    );

  if (!connection?.id) {
    throw new Error(
      "Business Connection ID отсутствует"
    );
  }

  if (!userId) {
    throw new Error(
      "Telegram User ID отсутствует"
    );
  }

  await db.execute({
    sql: `
      INSERT INTO business_connections (
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
    `,
    args: [
      connection.id,
      userId,
      connection?.user?.username ||
        connection?.username ||
        null,
      connection?.user?.first_name ||
        connection?.first_name ||
        null,
      connection?.is_enabled === false
        ? 0
        : 1,
      timestamp,
      timestamp
    ]
  });
}

async function getBusinessConnection(
  connectionId
) {
  await init();

  const result =
    await db.execute({
      sql: `
        SELECT *
        FROM business_connections
        WHERE id = ?
        LIMIT 1
      `,
      args: [connectionId]
    });

  return result.rows[0] || null;
}

/*
==================================================
USER → CONNECTION
==================================================
*/

async function getConnectionsForUser(
  userId
) {
  await init();

  const result =
    await db.execute({
      sql: `
        SELECT *
        FROM business_connections

        WHERE
          user_id = ?
          AND is_enabled = 1

        ORDER BY
          updated_at DESC
      `,
      args: [
        Number(userId)
      ]
    });

  return result.rows;
}

async function getConnectionForUser(
  userId,
  connectionId = null
) {
  await init();

  if (connectionId) {
    const result =
      await db.execute({
        sql: `
          SELECT *
          FROM business_connections

          WHERE
            id = ?
            AND user_id = ?
            AND is_enabled = 1

          LIMIT 1
        `,
        args: [
          connectionId,
          Number(userId)
        ]
      });

    return result.rows[0] || null;
  }

  const result =
    await db.execute({
      sql: `
        SELECT *
        FROM business_connections

        WHERE
          user_id = ?
          AND is_enabled = 1

        ORDER BY
          updated_at DESC

        LIMIT 1
      `,
      args: [
        Number(userId)
      ]
    });

  return result.rows[0] || null;
}

async function getActiveConnection() {
  await init();

  const result =
    await db.execute({
      sql: `
        SELECT *
        FROM business_connections

        WHERE is_enabled = 1

        ORDER BY
          updated_at DESC

        LIMIT 1
      `,
      args: []
    });

  return result.rows[0] || null;
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
  await init();

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
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)

      ON CONFLICT(
        connection_id,
        chat_id,
        message_id
      )
      DO UPDATE SET
        sender_id =
          excluded.sender_id,

        sender_username =
          excluded.sender_username,

        sender_name =
          excluded.sender_name,

        text =
          excluded.text
    `,
    args: [
      connectionId,
      message?.chat?.id || null,
      message?.message_id || null,
      senderId,
      senderUsername,
      senderName,
      text,
      now()
    ]
  });
}

async function markEdited(
  message,
  connectionId
) {
  await init();

  const text =
    message?.text ||
    message?.caption ||
    "";

  await db.execute({
    sql: `
      UPDATE messages

      SET
        text = ?,
        edited_at = ?

      WHERE
        connection_id = ?
        AND chat_id = ?
        AND message_id = ?
    `,
    args: [
      text,
      now(),
      connectionId,
      message?.chat?.id,
      message?.message_id
    ]
  });
}

async function markDeleted(
  connectionId,
  chatId,
  messageIds
) {
  await init();

  if (
    !Array.isArray(messageIds) ||
    messageIds.length === 0
  ) {
    return;
  }

  const timestamp = now();

  const statements =
    messageIds.map(
      messageId => ({
        sql: `
          UPDATE messages

          SET deleted_at = ?

          WHERE
            connection_id = ?
            AND chat_id = ?
            AND message_id = ?
        `,
        args: [
          timestamp,
          connectionId,
          chatId,
          messageId
        ]
      })
    );

  await db.batch(
    statements,
    "write"
  );
}

/*
==================================================
MUTES
==================================================
*/

async function addMute(
  connectionId,
  userId,
  username = null,
  expiresAt = null
) {
  await init();

  await db.execute({
    sql: `
      INSERT INTO mutes (
        connection_id,
        user_id,
        username,
        expires_at,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)

      ON CONFLICT(
        connection_id,
        user_id
      )
      DO UPDATE SET
        username =
          excluded.username,

        expires_at =
          excluded.expires_at
    `,
    args: [
      connectionId,
      Number(userId),
      username,
      expiresAt,
      now()
    ]
  });
}

async function removeMute(
  connectionId,
  userId
) {
  await init();

  await db.execute({
    sql: `
      DELETE FROM mutes

      WHERE
        connection_id = ?
        AND user_id = ?
    `,
    args: [
      connectionId,
      Number(userId)
    ]
  });
}

async function isMuted(
  connectionId,
  userId
) {
  await init();

  const result =
    await db.execute({
      sql: `
        SELECT *
        FROM mutes

        WHERE
          connection_id = ?
          AND user_id = ?

        LIMIT 1
      `,
      args: [
        connectionId,
        Number(userId)
      ]
    });

  const row =
    result.rows[0];

  if (!row) {
    return false;
  }

  if (
    row.expires_at !== null &&
    Number(row.expires_at) <= now()
  ) {
    await removeMute(
      connectionId,
      userId
    );

    return false;
  }

  return true;
}

async function getMutes(
  connectionId
) {
  await init();

  await db.execute({
    sql: `
      DELETE FROM mutes

      WHERE
        expires_at IS NOT NULL
        AND expires_at <= ?
    `,
    args: [now()]
  });

  const result =
    await db.execute({
      sql: `
        SELECT
          user_id,
          username,
          expires_at,
          created_at

        FROM mutes

        WHERE
          connection_id = ?

        ORDER BY
          created_at DESC
      `,
      args: [
        connectionId
      ]
    });

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
  await init();

  const countResult =
    await db.execute({
      sql: `
        SELECT COUNT(*) AS count
        FROM watches

        WHERE
          connection_id = ?
          AND enabled = 1
      `,
      args: [
        connectionId
      ]
    });

  const count =
    Number(
      countResult.rows[0]?.count || 0
    );

  if (count >= 10) {
    throw new Error(
      "Максимум 10 активных слежек"
    );
  }

  const timestamp = now();

  return db.execute({
    sql: `
      INSERT INTO watches (
        connection_id,
        target,
        enabled,
        created_at,
        updated_at
      )
      VALUES (?, ?, 1, ?, ?)
    `,
    args: [
      connectionId,
      String(target),
      timestamp,
      timestamp
    ]
  });
}

async function getWatches(
  connectionId
) {
  await init();

  const result =
    await db.execute({
      sql: `
        SELECT *
        FROM watches

        WHERE
          connection_id = ?

        ORDER BY
          created_at DESC
      `,
      args: [
        connectionId
      ]
    });

  return result.rows;
}

async function removeWatch(
  connectionId,
  id
) {
  await init();

  await db.execute({
    sql: `
      DELETE FROM watches

      WHERE
        connection_id = ?
        AND id = ?
    `,
    args: [
      connectionId,
      Number(id)
    ]
  });
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
  await init();

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
      connectionId,
      type,
      chatId,
      messageId,
      JSON.stringify(data),
      now()
    ]
  });
}

async function getEvents(
  connectionId,
  limit = 100
) {
  await init();

  const result =
    await db.execute({
      sql: `
        SELECT *
        FROM events

        WHERE
          connection_id = ?

        ORDER BY
          created_at DESC

        LIMIT ?
      `,
      args: [
        connectionId,
        Number(limit)
      ]
    });

  return result.rows.map(
    row => ({
      ...row,
      data:
        safeJSON(row.data)
    })
  );
}

/*
==================================================
SCHEDULED DELETES
==================================================
*/

async function scheduleDelete(
  connectionId,
  chatId,
  messageId,
  deleteAt
) {
  await init();

  await db.execute({
    sql: `
      INSERT INTO scheduled_deletes (
        connection_id,
        chat_id,
        message_id,
        delete_at,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `,
    args: [
      connectionId,
      chatId,
      messageId,
      deleteAt,
      now()
    ]
  });
}

async function getDueDeletes() {
  await init();

  const result =
    await db.execute({
      sql: `
        SELECT *
        FROM scheduled_deletes

        WHERE
          done = 0
          AND delete_at <= ?

        ORDER BY
          delete_at ASC
      `,
      args: [
        now()
      ]
    });

  return result.rows;
}

async function markDeleteDone(
  id
) {
  await init();

  await db.execute({
    sql: `
      UPDATE scheduled_deletes

      SET
        done = 1

      WHERE
        id = ?
    `,
    args: [
      Number(id)
    ]
  });
}

/*
==================================================
HISTORY
==================================================
*/

async function getHistory(
  connectionId,
  limit = 100
) {
  await init();

  const result =
    await db.execute({
      sql: `
        SELECT *
        FROM messages

        WHERE
          connection_id = ?

        ORDER BY
          created_at DESC

        LIMIT ?
      `,
      args: [
        connectionId,
        Number(limit)
      ]
    });

  return result.rows;
}

/*
==================================================
STATS
==================================================
*/

async function getStats(
  connectionId
) {
  await init();

  const result =
    await db.execute({
      sql: `
        SELECT

          (
            SELECT COUNT(*)
            FROM messages
            WHERE connection_id = ?
          ) AS messages,

          (
            SELECT COUNT(*)
            FROM messages
            WHERE
              connection_id = ?
              AND edited_at IS NOT NULL
          ) AS edits,

          (
            SELECT COUNT(*)
            FROM messages
            WHERE
              connection_id = ?
              AND deleted_at IS NOT NULL
          ) AS deleted,

          (
            SELECT COUNT(*)
            FROM events
            WHERE connection_id = ?
          ) AS events
      `,
      args: [
        connectionId,
        connectionId,
        connectionId,
        connectionId
      ]
    });

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
      Number(row.events || 0)
  };
}

/*
==================================================
EXPORT
==================================================
*/

module.exports = {
  db,
  init,

  getSetting,
  setSetting,

  saveBusinessConnection,
  getBusinessConnection,

  getConnectionsForUser,
  getConnectionForUser,
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