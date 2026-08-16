const { createClient } = require("@libsql/client");

/*
==================================================
TURSO CONFIG
==================================================
*/

const TURSO_DATABASE_URL =
  process.env.TURSO_DATABASE_URL;

const TURSO_AUTH_TOKEN =
  process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DATABASE_URL) {
  console.warn(
    "WARNING: TURSO_DATABASE_URL не задан"
  );
}

const client = createClient({
  url: TURSO_DATABASE_URL,
  authToken: TURSO_AUTH_TOKEN
});

/*
==================================================
 TIME
==================================================
*/

function now() {
  return Math.floor(
    Date.now() / 1000
  );
}

/*
==================================================
 INIT
==================================================
*/

let initialized = false;
let initializationPromise = null;

async function initDatabase() {
  if (initialized) {
    return;
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    console.log(
      "Initializing Turso database..."
    );

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

              UNIQUE (
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
        },

        {
          sql: `
            CREATE INDEX IF NOT EXISTS idx_messages_connection
            ON messages(connection_id)
          `
        },

        {
          sql: `
            CREATE INDEX IF NOT EXISTS idx_mutes_connection
            ON mutes(connection_id)
          `
        },

        {
          sql: `
            CREATE INDEX IF NOT EXISTS idx_watches_connection
            ON watches(connection_id)
          `
        },

        {
          sql: `
            CREATE INDEX IF NOT EXISTS idx_events_connection
            ON events(connection_id)
          `
        },

        {
          sql: `
            CREATE INDEX IF NOT EXISTS idx_scheduled_deletes_due
            ON scheduled_deletes(done, delete_at)
          `
        }
      ],
      "write"
    );

    initialized = true;

    console.log(
      "Turso database initialized"
    );
  })();

  try {
    await initializationPromise;
  } catch (error) {
    initializationPromise = null;

    console.error(
      "TURSO INIT ERROR:",
      error
    );

    throw error;
  }
}

/*
==================================================
 READY
==================================================
*/

async function ready() {
  await initDatabase();
}

/*
==================================================
 SETTINGS
==================================================
*/

async function getSetting(key) {
  await ready();

  const result =
    await client.execute({
      sql: `
        SELECT value
        FROM settings
        WHERE key = ?
        LIMIT 1
      `,
      args: [String(key)]
    });

  return (
    result.rows[0]?.value ??
    null
  );
}

async function setSetting(
  key,
  value
) {
  await ready();

  await client.execute({
    sql: `
      INSERT INTO settings (
        key,
        value
      )
      VALUES (?, ?)
      ON CONFLICT(key)
      DO UPDATE SET value = excluded.value
    `,
    args: [
      String(key),
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
  await ready();

  if (!connection?.id) {
    throw new Error(
      "Business connection ID отсутствует"
    );
  }

  const user =
    connection.user || {};

  const timestamp =
    now();

  const existing =
    await getBusinessConnection(
      connection.id
    );

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
        ? JSON.stringify(
            connection.rights
          )
        : existing?.rights ??
          null,

    created_at:
      existing?.created_at ||
      timestamp,

    updated_at:
      timestamp
  };

  await client.execute({
    sql: `
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
    args: [
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
  });

  return record;
}

async function getBusinessConnection(
  id
) {
  await ready();

  const result =
    await client.execute({
      sql: `
        SELECT *
        FROM business_connections
        WHERE id = ?
        LIMIT 1
      `,
      args: [String(id)]
    });

  return result.rows[0]
    ? {
        ...result.rows[0],
        rights: parseJSON(
          result.rows[0].rights
        )
      }
    : null;
}

async function getConnectionsForUser(
  userId
) {
  await ready();

  const result =
    await client.execute({
      sql: `
        SELECT *
        FROM business_connections
        WHERE user_id = ?
          AND is_enabled = 1
        ORDER BY updated_at DESC
      `,
      args: [Number(userId)]
    });

  return result.rows.map(
    row => ({
      ...row,
      rights: parseJSON(
        row.rights
      )
    })
  );
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
  await ready();

  const result =
    await client.execute({
      sql: `
        SELECT *
        FROM business_connections
        WHERE is_enabled = 1
        ORDER BY updated_at DESC
        LIMIT 1
      `
    });

  return result.rows[0] || null;
}

async function disableBusinessConnection(
  connectionId
) {
  await ready();

  const result =
    await client.execute({
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

  return result.rowsAffected > 0;
}

async function enableBusinessConnection(
  connectionId
) {
  await ready();

  const result =
    await client.execute({
      sql: `
        UPDATE business_connections
        SET
          is_enabled = 1,
          updated_at = ?
        WHERE id = ?
      `,
      args: [
        now(),
        String(connectionId)
      ]
    });

  return result.rowsAffected > 0;
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
  await ready();

  if (!message) {
    return null;
  }

  const chatId =
    message?.chat?.id ?? null;

  const messageId =
    message?.message_id ?? null;

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
      .join(" ") || null;

  const existing =
    await client.execute({
      sql: `
        SELECT *
        FROM messages
        WHERE connection_id = ?
          AND chat_id = ?
          AND message_id = ?
        LIMIT 1
      `,
      args: [
        String(connectionId),
        Number(chatId),
        Number(messageId)
      ]
    });

  if (existing.rows.length) {
    const row =
      existing.rows[0];

    await client.execute({
      sql: `
        UPDATE messages
        SET
          text = ?,
          sender_id = ?,
          sender_username = ?,
          sender_name = ?
        WHERE id = ?
      `,
      args: [
        text,
        senderId,
        senderUsername,
        senderName,
        row.id
      ]
    });

    return {
      ...row,
      text,
      sender_id: senderId,
      sender_username:
        senderUsername,
      sender_name:
        senderName
    };
  }

  const result =
    await client.execute({
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
      `,
      args: [
        String(connectionId),
        Number(chatId),
        Number(messageId),
        senderId,
        senderUsername,
        senderName,
        text,
        now()
      ]
    });

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

    sender_id:
      senderId,

    sender_username:
      senderUsername,

    sender_name:
      senderName,

    text,

    created_at:
      now(),

    edited_at: null,
    deleted_at: null
  };
}

async function markEdited(
  message,
  connectionId
) {
  await ready();

  const chatId =
    message?.chat?.id;

  const messageId =
    message?.message_id;

  const text =
    message?.text ||
    message?.caption ||
    "";

  const result =
    await client.execute({
      sql: `
        UPDATE messages
        SET
          text = ?,
          edited_at = ?
        WHERE connection_id = ?
          AND chat_id = ?
          AND message_id = ?
      `,
      args: [
        text,
        now(),
        String(connectionId),
        Number(chatId),
        Number(messageId)
      ]
    });

  if (
    result.rowsAffected === 0
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
  await ready();

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
      await client.execute({
        sql: `
          UPDATE messages
          SET deleted_at = ?
          WHERE connection_id = ?
            AND chat_id = ?
            AND message_id = ?
            AND deleted_at IS NULL
        `,
        args: [
          now(),
          String(connectionId),
          Number(chatId),
          Number(messageId)
        ]
      });

    changed +=
      Number(
        result.rowsAffected || 0
      );
  }

  return changed;
}

async function getHistory(
  connectionId,
  limit = 100
) {
  await ready();

  const result =
    await client.execute({
      sql: `
        SELECT *
        FROM messages
        WHERE connection_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
      args: [
        String(connectionId),
        Number(limit) || 100
      ]
    });

  return result.rows;
}

/*
==================================================
 MUTES
==================================================
*/

function normalizeUsername(
  value
) {
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
  await ready();

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

  if (
    numericUserId !== null
  ) {
    const result =
      await client.execute({
        sql: `
          SELECT *
          FROM mutes
          WHERE connection_id = ?
            AND user_id = ?
          LIMIT 1
        `,
        args: [
          String(connectionId),
          numericUserId
        ]
      });

    existing =
      result.rows[0] || null;
  }

  if (
    !existing &&
    cleanUsername
  ) {
    const result =
      await client.execute({
        sql: `
          SELECT *
          FROM mutes
          WHERE connection_id = ?
            AND lower(username) = ?
          LIMIT 1
        `,
        args: [
          String(connectionId),
          cleanUsername
        ]
      });

    existing =
      result.rows[0] || null;
  }

  if (existing) {
    await client.execute({
      sql: `
        UPDATE mutes
        SET
          user_id = ?,
          username = ?,
          expires_at = ?,
          updated_at = ?
        WHERE id = ?
      `,
      args: [
        numericUserId ??
          existing.user_id ??
          null,

        cleanUsername ??
          existing.username ??
          null,

        expiresAt,

        now(),

        existing.id
      ]
    });

    return {
      ...existing,

      user_id:
        numericUserId ??
        existing.user_id ??
        null,

      username:
        cleanUsername ??
        existing.username ??
        null,

      expires_at:
        expiresAt,

      updated_at:
        now()
    };
  }

  const timestamp =
    now();

  const result =
    await client.execute({
      sql: `
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
      args: [
        String(connectionId),
        numericUserId,
        cleanUsername,
        expiresAt,
        timestamp,
        timestamp
      ]
    });

  return {
    id:
      Number(
        result.lastInsertRowid
      ),

    connection_id:
      String(connectionId),

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
}

async function removeMute(
  connectionId,
  userId = null,
  username = null
) {
  await ready();

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

  let result;

  if (
    numericUserId !== null
  ) {
    result =
      await client.execute({
        sql: `
          DELETE FROM mutes
          WHERE connection_id = ?
            AND user_id = ?
        `,
        args: [
          String(connectionId),
          numericUserId
        ]
      });
  } else if (
    cleanUsername
  ) {
    result =
      await client.execute({
        sql: `
          DELETE FROM mutes
          WHERE connection_id = ?
            AND lower(username) = ?
        `,
        args: [
          String(connectionId),
          cleanUsername
        ]
      });
  } else {
    return 0;
  }

  return Number(
    result.rowsAffected || 0
  );
}

async function isMuted(
  connectionId,
  userId = null,
  username = null
) {
  await ready();

  await client.execute({
    sql: `
      DELETE FROM mutes
      WHERE expires_at IS NOT NULL
        AND expires_at <= ?
    `,
    args: [now()]
  });

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
    numericUserId !== null
  ) {
    const result =
      await client.execute({
        sql: `
          SELECT id
          FROM mutes
          WHERE connection_id = ?
            AND user_id = ?
          LIMIT 1
        `,
        args: [
          String(connectionId),
          numericUserId
        ]
      });

    if (result.rows.length) {
      return true;
    }
  }

  if (cleanUsername) {
    const result =
      await client.execute({
        sql: `
          SELECT id
          FROM mutes
          WHERE connection_id = ?
            AND lower(username) = ?
          LIMIT 1
        `,
        args: [
          String(connectionId),
          cleanUsername
        ]
      });

    return result.rows.length > 0;
  }

  return false;
}

async function getMutes(
  connectionId
) {
  await ready();

  await client.execute({
    sql: `
      DELETE FROM mutes
      WHERE expires_at IS NOT NULL
        AND expires_at <= ?
    `,
    args: [now()]
  });

  const result =
    await client.execute({
      sql: `
        SELECT *
        FROM mutes
        WHERE connection_id = ?
        ORDER BY created_at DESC
      `,
      args: [
        String(connectionId)
      ]
    });

  return result.rows;
}

async function findMute(
  connectionId,
  userId = null,
  username = null
) {
  await ready();

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
    numericUserId !== null
  ) {
    const result =
      await client.execute({
        sql: `
          SELECT *
          FROM mutes
          WHERE connection_id = ?
            AND user_id = ?
          LIMIT 1
        `,
        args: [
          String(connectionId),
          numericUserId
        ]
      });

    if (result.rows.length) {
      return result.rows[0];
    }
  }

  if (cleanUsername) {
    const result =
      await client.execute({
        sql: `
          SELECT *
          FROM mutes
          WHERE connection_id = ?
            AND lower(username) = ?
          LIMIT 1
        `,
        args: [
          String(connectionId),
          cleanUsername
        ]
      });

    return result.rows[0] || null;
  }

  return null;
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
  await ready();

  const cleanTarget =
    String(target || "").trim();

  if (!cleanTarget) {
    throw new Error(
      "Укажи username или Telegram ID"
    );
  }

  const existing =
    await client.execute({
      sql: `
        SELECT *
        FROM watches
        WHERE connection_id = ?
          AND lower(target) = lower(?)
          AND enabled = 1
        LIMIT 1
      `,
      args: [
        String(connectionId),
        cleanTarget
      ]
    });

  if (existing.rows.length) {
    return existing.rows[0];
  }

  const count =
    await client.execute({
      sql: `
        SELECT COUNT(*) AS count
        FROM watches
        WHERE connection_id = ?
          AND enabled = 1
      `,
      args: [
        String(connectionId)
      ]
    });

  if (
    Number(count.rows[0].count) >=
    10
  ) {
    throw new Error(
      "Максимум 10 активных слежек"
    );
  }

  const timestamp =
    now();

  const result =
    await client.execute({
      sql: `
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
      args: [
        String(connectionId),
        cleanTarget,
        timestamp,
        timestamp
      ]
    });

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
      timestamp,

    lastInsertRowid:
      Number(
        result.lastInsertRowid
      )
  };
}

async function getWatches(
  connectionId
) {
  await ready();

  const result =
    await client.execute({
      sql: `
        SELECT *
        FROM watches
        WHERE connection_id = ?
        ORDER BY created_at DESC
      `,
      args: [
        String(connectionId)
      ]
    });

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
  await ready();

  const result =
    await client.execute({
      sql: `
        DELETE FROM watches
        WHERE connection_id = ?
          AND id = ?
      `,
      args: [
        String(connectionId),
        Number(id)
      ]
    });

  return Number(
    result.rowsAffected || 0
  );
}

async function updateWatch(
  connectionId,
  id,
  values = {}
) {
  await ready();

  const current =
    await client.execute({
      sql: `
        SELECT *
        FROM watches
        WHERE connection_id = ?
          AND id = ?
        LIMIT 1
      `,
      args: [
        String(connectionId),
        Number(id)
      ]
    });

  if (!current.rows.length) {
    return null;
  }

  const row =
    current.rows[0];

  const target =
    values.target !== undefined
      ? String(
          values.target
        ).trim()
      : row.target;

  const enabled =
    values.enabled !== undefined
      ? values.enabled
        ? 1
        : 0
      : row.enabled;

  const lastData =
    values.last_data !== undefined
      ? JSON.stringify(
          values.last_data
        )
      : row.last_data;

  await client.execute({
    sql: `
      UPDATE watches
      SET
        target = ?,
        enabled = ?,
        last_data = ?,
        updated_at = ?
      WHERE connection_id = ?
        AND id = ?
    `,
    args: [
      target,
      enabled,
      lastData,
      now(),
      String(connectionId),
      Number(id)
    ]
  });

  return {
    ...row,
    target,
    enabled,
    last_data:
      parseJSON(lastData),
    updated_at:
      now()
  };
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
  data: eventData = {}
}) {
  await ready();

  const result =
    await client.execute({
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
        String(connectionId),
        String(type),
        chatId,
        messageId,
        JSON.stringify(
          eventData
        ),
        now()
      ]
    });

  return {
    id:
      Number(
        result.lastInsertRowid
      ),

    connection_id:
      String(connectionId),

    type,

    chat_id:
      chatId,

    message_id:
      messageId,

    data:
      eventData,

    created_at:
      now()
  };
}

async function getEvents(
  connectionId,
  limit = 100
) {
  await ready();

  const result =
    await client.execute({
      sql: `
        SELECT *
        FROM events
        WHERE connection_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
      args: [
        String(connectionId),
        Number(limit) || 100
      ]
    });

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
  await ready();

  const result =
    await client.execute({
      sql: `
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
      args: [
        String(connectionId),
        Number(chatId),
        Number(messageId),
        Number(deleteAt),
        now()
      ]
    });

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
      now(),

    error: null
  };
}

async function getDueDeletes() {
  await ready();

  const result =
    await client.execute({
      sql: `
        SELECT *
        FROM scheduled_deletes
        WHERE done = 0
          AND delete_at <= ?
        ORDER BY delete_at ASC
      `,
      args: [now()]
    });

  return result.rows;
}

async function markDeleteDone(
  id
) {
  await ready();

  const result =
    await client.execute({
      sql: `
        UPDATE scheduled_deletes
        SET
          done = 1,
          completed_at = ?
        WHERE id = ?
      `,
      args: [
        now(),
        Number(id)
      ]
    });

  return result.rowsAffected > 0;
}

async function markDeleteError(
  id,
  error
) {
  await ready();

  const result =
    await client.execute({
      sql: `
        UPDATE scheduled_deletes
        SET
          error = ?
        WHERE id = ?
      `,
      args: [
        String(error || ""),
        Number(id)
      ]
    });

  return result.rowsAffected > 0;
}

/*
==================================================
 STATS
==================================================
*/

async function getStats(
  connectionId
) {
  await ready();

  const result =
    await client.execute({
      sql: `
        SELECT
          (SELECT COUNT(*)
           FROM messages
           WHERE connection_id = ?) AS messages,

          (SELECT COUNT(*)
           FROM messages
           WHERE connection_id = ?
             AND edited_at IS NOT NULL) AS edits,

          (SELECT COUNT(*)
           FROM messages
           WHERE connection_id = ?
             AND deleted_at IS NOT NULL) AS deleted,

          (SELECT COUNT(*)
           FROM events
           WHERE connection_id = ?) AS events,

          (SELECT COUNT(*)
           FROM mutes
           WHERE connection_id = ?
             AND (
               expires_at IS NULL
               OR expires_at > ?
             )) AS mutes,

          (SELECT COUNT(*)
           FROM watches
           WHERE connection_id = ?
             AND enabled = 1) AS watches
      `,
      args: [
        String(connectionId),
        String(connectionId),
        String(connectionId),
        String(connectionId),
        String(connectionId),
        now(),
        String(connectionId)
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
      Number(row.events || 0),

    mutes:
      Number(row.mutes || 0),

    watches:
      Number(row.watches || 0)
  };
}

/*
==================================================
 HELPERS
==================================================
*/

function parseJSON(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value === "object"
  ) {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/*
==================================================
 DB COMPATIBILITY
==================================================

ВАЖНО:
старый db.prepare() больше
не является настоящим SQLite API.

Новый код должен использовать
функции выше с await.
==================================================
*/

const db = {
  client,

  async prepare() {
    throw new Error(
      "db.prepare() больше не поддерживается. Используй функции database.js с await."
    );
  }
};

/*
==================================================
 EXPORT
==================================================
*/

module.exports = {
  client,

  initDatabase,
  ready,

  db,

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