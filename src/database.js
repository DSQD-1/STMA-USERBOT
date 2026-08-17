const { createClient } = require("@libsql/client");

const url =
  process.env.TURSO_DATABASE_URL ||
  process.env.TURSO_URL;

const authToken =
  process.env.TURSO_AUTH_TOKEN ||
  process.env.TURSO_AUTH_TOKEN;

if (!url) {
  console.warn(
    "WARNING: TURSO_DATABASE_URL is not configured."
  );
}

const db = createClient({
  url: url || "file:stma.db",
  authToken
});

async function run(sql, args = {}) {
  return db.execute({
    sql,
    args
  });
}

async function initDatabase() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS business_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      date INTEGER,
      rights_json TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_connection_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      from_id TEXT,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      text TEXT,
      caption TEXT,
      date TEXT,
      direction TEXT,
      edited INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (
        business_connection_id,
        chat_id,
        message_id
      )
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS message_edits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_connection_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      username TEXT,
      old_text TEXT,
      new_text TEXT,
      edited_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS watches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      user_id TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE(connection_id, username)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      user_id TEXT,
      connection_id TEXT,
      chat_id TEXT,
      message_id TEXT,
      target_user_id TEXT,
      username TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      input TEXT NOT NULL,
      result_json TEXT,
      created_at TEXT NOT NULL
    )
  `);

  console.log("Turso database initialized");
}

function isoNow() {
  return new Date().toISOString();
}

async function upsertUser(user) {
  const id = String(user.id);
  const timestamp = isoNow();

  await run(
    `
    INSERT INTO users (
      id,
      username,
      first_name,
      last_name,
      created_at,
      updated_at
    )
    VALUES (
      :id,
      :username,
      :first_name,
      :last_name,
      :created_at,
      :updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      updated_at = excluded.updated_at
    `,
    {
      id,
      username: user.username || null,
      first_name: user.first_name || null,
      last_name: user.last_name || null,
      created_at: timestamp,
      updated_at: timestamp
    }
  );
}

async function getUser(id) {
  const result = await run(
    `SELECT * FROM users WHERE id = :id`,
    {
      id: String(id)
    }
  );

  return result.rows[0] || null;
}

async function upsertBusinessConnection(data) {
  const timestamp = isoNow();

  await run(
    `
    INSERT INTO business_connections (
      id,
      user_id,
      username,
      first_name,
      last_name,
      date,
      rights_json,
      is_enabled,
      created_at,
      updated_at
    )
    VALUES (
      :id,
      :user_id,
      :username,
      :first_name,
      :last_name,
      :date,
      :rights_json,
      :is_enabled,
      :created_at,
      :updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      date = excluded.date,
      rights_json = excluded.rights_json,
      is_enabled = excluded.is_enabled,
      updated_at = excluded.updated_at
    `,
    {
      id: String(data.id),
      user_id: String(data.userId),
      username: data.username || null,
      first_name: data.firstName || null,
      last_name: data.lastName || null,
      date: data.date || null,
      rights_json: JSON.stringify(data.rights || {}),
      is_enabled: data.isEnabled ? 1 : 0,
      created_at: timestamp,
      updated_at: timestamp
    }
  );
}

async function getConnections(userId) {
  const result = await run(
    `
    SELECT *
    FROM business_connections
    WHERE user_id = :user_id
    ORDER BY updated_at DESC
    `,
    {
      user_id: String(userId)
    }
  );

  return result.rows.map(parseConnection);
}

async function getConnection(id) {
  const result = await run(
    `
    SELECT *
    FROM business_connections
    WHERE id = :id
    `,
    {
      id: String(id)
    }
  );

  if (!result.rows[0]) return null;

  return parseConnection(result.rows[0]);
}

function parseConnection(row) {
  let rights = {};

  try {
    rights = JSON.parse(
      row.rights_json || "{}"
    );
  } catch {}

  return {
    ...row,
    rights,
    is_enabled: Boolean(row.is_enabled)
  };
}

async function saveIncomingMessage(message) {
  const timestamp = isoNow();

  await run(
    `
    INSERT INTO messages (
      business_connection_id,
      owner_user_id,
      chat_id,
      message_id,
      from_id,
      username,
      first_name,
      last_name,
      text,
      caption,
      date,
      direction,
      edited,
      deleted,
      created_at,
      updated_at
    )
    VALUES (
      :business_connection_id,
      :owner_user_id,
      :chat_id,
      :message_id,
      :from_id,
      :username,
      :first_name,
      :last_name,
      :text,
      :caption,
      :date,
      :direction,
      0,
      0,
      :created_at,
      :updated_at
    )
    ON CONFLICT (
      business_connection_id,
      chat_id,
      message_id
    ) DO UPDATE SET
      text = excluded.text,
      caption = excluded.caption,
      updated_at = excluded.updated_at
    `,
    {
      business_connection_id:
        message.businessConnectionId,
      owner_user_id:
        String(message.ownerUserId),
      chat_id: String(message.chatId),
      message_id: String(message.messageId),
      from_id: message.fromId
        ? String(message.fromId)
        : null,
      username: message.username || null,
      first_name: message.firstName || null,
      last_name: message.lastName || null,
      text: message.text || null,
      caption: message.caption || null,
      date: message.date || timestamp,
      direction:
        message.direction || "incoming",
      created_at: timestamp,
      updated_at: timestamp
    }
  );
}

async function saveSentMessage(data) {
  const message = data.message;

  const timestamp = isoNow();

  await run(
    `
    INSERT INTO messages (
      business_connection_id,
      owner_user_id,
      chat_id,
      message_id,
      from_id,
      username,
      text,
      caption,
      date,
      direction,
      created_at,
      updated_at
    )
    VALUES (
      :connection_id,
      :owner_user_id,
      :chat_id,
      :message_id,
      :from_id,
      :username,
      :text,
      :caption,
      :date,
      'outgoing',
      :created_at,
      :updated_at
    )
    ON CONFLICT (
      business_connection_id,
      chat_id,
      message_id
    ) DO NOTHING
    `,
    {
      connection_id:
        data.connectionId,
      owner_user_id:
        String(data.ownerUserId),
      chat_id:
        String(message.chat?.id),
      message_id:
        String(message.message_id),
      from_id:
        message.from?.id
          ? String(message.from.id)
          : null,
      username:
        message.from?.username || null,
      text:
        message.text || null,
      caption:
        message.caption || null,
      date:
        message.date
          ? new Date(
              message.date * 1000
            ).toISOString()
          : timestamp,
      created_at: timestamp,
      updated_at: timestamp
    }
  );
}

async function getMessages(
  connectionId,
  limit = 100,
  filters = {}
) {
  let sql = `
    SELECT *
    FROM messages
    WHERE business_connection_id = :connection_id
  `;

  const args = {
    connection_id: connectionId
  };

  if (filters.edited) {
    sql += ` AND edited = 1`;
  }

  if (filters.deleted) {
    sql += ` AND deleted = 1`;
  }

  sql += `
    ORDER BY
      COALESCE(date, created_at) DESC
    LIMIT ${Math.min(
      Math.max(Number(limit) || 100, 1),
      500
    )}
  `;

  const result = await run(
    sql,
    args
  );

  return result.rows;
}

async function getMessage(
  connectionId,
  chatId,
  messageId
) {
  const result = await run(
    `
    SELECT *
    FROM messages
    WHERE business_connection_id = :connection_id
      AND chat_id = :chat_id
      AND message_id = :message_id
    LIMIT 1
    `,
    {
      connection_id: connectionId,
      chat_id: String(chatId),
      message_id: String(messageId)
    }
  );

  return result.rows[0] || null;
}

async function markMessageDeleted(
  connectionId,
  chatId,
  messageId
) {
  await run(
    `
    UPDATE messages
    SET
      deleted = 1,
      deleted_at = :deleted_at,
      updated_at = :updated_at
    WHERE business_connection_id = :connection_id
      AND chat_id = :chat_id
      AND message_id = :message_id
    `,
    {
      connection_id: connectionId,
      chat_id: String(chatId),
      message_id: String(messageId),
      deleted_at: isoNow(),
      updated_at: isoNow()
    }
  );
}

async function saveEditedMessage(data) {
  const current =
    await getMessage(
      data.businessConnectionId,
      data.chatId,
      data.messageId
    );

  const oldText =
    current?.text ||
    current?.caption ||
    "";

  const newText =
    data.text ||
    data.caption ||
    "";

  await run(
    `
    INSERT INTO message_edits (
      business_connection_id,
      chat_id,
      message_id,
      username,
      old_text,
      new_text,
      edited_at
    )
    VALUES (
      :connection_id,
      :chat_id,
      :message_id,
      :username,
      :old_text,
      :new_text,
      :edited_at
    )
    `,
    {
      connection_id:
        data.businessConnectionId,
      chat_id:
        String(data.chatId),
      message_id:
        String(data.messageId),
      username:
        data.username || null,
      old_text: oldText,
      new_text: newText,
      edited_at: isoNow()
    }
  );

  await run(
    `
    UPDATE messages
    SET
      text = :text,
      caption = :caption,
      edited = 1,
      updated_at = :updated_at
    WHERE business_connection_id = :connection_id
      AND chat_id = :chat_id
      AND message_id = :message_id
    `,
    {
      connection_id:
        data.businessConnectionId,
      chat_id:
        String(data.chatId),
      message_id:
        String(data.messageId),
      text:
        data.text || null,
      caption:
        data.caption || null,
      updated_at: isoNow()
    }
  );
}

async function addWatch(data) {
  await run(
    `
    INSERT INTO watches (
      connection_id,
      owner_user_id,
      username,
      active,
      created_at
    )
    VALUES (
      :connection_id,
      :owner_user_id,
      :username,
      1,
      :created_at
    )
    ON CONFLICT (
      connection_id,
      username
    ) DO UPDATE SET
      active = 1
    `,
    {
      connection_id:
        data.connectionId,
      owner_user_id:
        String(data.ownerUserId),
      username:
        data.username.toLowerCase(),
      created_at: isoNow()
    }
  );
}

async function getWatches(connectionId) {
  const result = await run(
    `
    SELECT *
    FROM watches
    WHERE connection_id = :connection_id
      AND active = 1
    ORDER BY created_at DESC
    `,
    {
      connection_id: connectionId
    }
  );

  return result.rows;
}

async function removeWatch(
  connectionId,
  username
) {
  await run(
    `
    UPDATE watches
    SET active = 0
    WHERE connection_id = :connection_id
      AND username = :username
    `,
    {
      connection_id: connectionId,
      username: username.toLowerCase()
    }
  );
}

async function getTrackedUsernames(
  connectionId
) {
  const rows =
    await getWatches(connectionId);

  return rows.map(
    (row) => String(row.username).toLowerCase()
  );
}

async function findRecentChatByUsername(
  connectionId,
  username
) {
  const result = await run(
    `
    SELECT
      chat_id,
      from_id AS user_id,
      username
    FROM messages
    WHERE business_connection_id = :connection_id
      AND LOWER(username) = LOWER(:username)
    ORDER BY
      COALESCE(date, created_at) DESC
    LIMIT 1
    `,
    {
      connection_id: connectionId,
      username
    }
  );

  return result.rows[0] || null;
}

async function addEvent(data) {
  await run(
    `
    INSERT INTO events (
      type,
      user_id,
      connection_id,
      chat_id,
      message_id,
      target_user_id,
      username,
      payload_json,
      created_at
    )
    VALUES (
      :type,
      :user_id,
      :connection_id,
      :chat_id,
      :message_id,
      :target_user_id,
      :username,
      :payload_json,
      :created_at
    )
    `,
    {
      type: data.type,
      user_id: data.userId
        ? String(data.userId)
        : null,
      connection_id:
        data.connectionId || null,
      chat_id: data.chatId
        ? String(data.chatId)
        : null,
      message_id: data.messageId
        ? String(data.messageId)
        : null,
      target_user_id:
        data.userIdTarget
          ? String(data.userIdTarget)
          : null,
      username:
        data.username || null,
      payload_json: JSON.stringify(
        data.payload || {}
      ),
      created_at: isoNow()
    }
  );
}

async function getEvents(
  connectionId,
  limit = 100
) {
  const result = await run(
    `
    SELECT *
    FROM events
    WHERE connection_id = :connection_id
    ORDER BY created_at DESC
    LIMIT ${Math.min(
      Math.max(Number(limit) || 100, 1),
      500
    )}
    `,
    {
      connection_id: connectionId
    }
  );

  return result.rows;
}

async function saveCommand(data) {
  await run(
    `
    INSERT INTO commands (
      owner_user_id,
      connection_id,
      input,
      result_json,
      created_at
    )
    VALUES (
      :owner_user_id,
      :connection_id,
      :input,
      :result_json,
      :created_at
    )
    `,
    {
      owner_user_id:
        String(data.ownerUserId),
      connection_id:
        data.connectionId,
      input:
        data.input,
      result_json:
        JSON.stringify(data.result || {}),
      created_at: isoNow()
    }
  );
}

async function getStats(connectionId) {
  const messages =
    await run(
      `
      SELECT
        COUNT(*) AS total,
        SUM(
          CASE WHEN direction = 'incoming'
          THEN 1 ELSE 0 END
        ) AS received,
        SUM(
          CASE WHEN direction = 'outgoing'
          THEN 1 ELSE 0 END
        ) AS sent,
        SUM(
          CASE WHEN edited = 1
          THEN 1 ELSE 0 END
        ) AS edited,
        SUM(
          CASE WHEN deleted = 1
          THEN 1 ELSE 0 END
        ) AS deleted
      FROM messages
      WHERE business_connection_id = :connection_id
      `,
      {
        connection_id: connectionId
      }
    );

  const events =
    await run(
      `
      SELECT COUNT(*) AS count
      FROM events
      WHERE connection_id = :connection_id
      `,
      {
        connection_id: connectionId
      }
    );

  const commands =
    await run(
      `
      SELECT COUNT(*) AS count
      FROM commands
      WHERE connection_id = :connection_id
      `,
      {
        connection_id: connectionId
      }
    );

  const watches =
    await run(
      `
      SELECT COUNT(*) AS count
      FROM watches
      WHERE connection_id = :connection_id
        AND active = 1
      `,
      {
        connection_id: connectionId
      }
    );

  const row = messages.rows[0] || {};

  return {
    received: Number(row.received || 0),
    sent: Number(row.sent || 0),
    edited: Number(row.edited || 0),
    deleted: Number(row.deleted || 0),
    events: Number(events.rows[0]?.count || 0),
    commands: Number(commands.rows[0]?.count || 0),
    watches: Number(watches.rows[0]?.count || 0)
  };
}

module.exports = {
  initDatabase,
  upsertUser,
  getUser,
  upsertBusinessConnection,
  getConnections,
  getConnection,
  saveIncomingMessage,
  saveSentMessage,
  getMessages,
  getMessage,
  markMessageDeleted,
  saveEditedMessage,
  addWatch,
  getWatches,
  removeWatch,
  getTrackedUsernames,
  findRecentChatByUsername,
  addEvent,
  getEvents,
  saveCommand,
  getStats
};