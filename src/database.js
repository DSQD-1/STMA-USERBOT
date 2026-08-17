const { createClient } = require("@libsql/client");

const url =
  process.env.TURSO_DATABASE_URL ||
  process.env.TURSO_URL;

const authToken =
  process.env.TURSO_AUTH_TOKEN;

if (!url) {
  throw new Error(
    "TURSO_DATABASE_URL is not configured"
  );
}

if (!authToken) {
  throw new Error(
    "TURSO_AUTH_TOKEN is not configured"
  );
}

const db = createClient({
  url,
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

      user_chat_id TEXT,

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

  /*
  Если таблица уже существовала
  в старой версии — добавляем колонку.
  */

  try {
    await run(`
      ALTER TABLE business_connections
      ADD COLUMN user_chat_id TEXT
    `);
  } catch {}

  await run(`
    CREATE INDEX IF NOT EXISTS
    idx_business_connections_user_id
    ON business_connections(user_id)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS
    idx_business_connections_enabled
    ON business_connections(is_enabled)
  `);

  console.log(
    "Turso STMA database initialized"
  );
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

    ON CONFLICT(id)
    DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      updated_at = excluded.updated_at
    `,
    {
      id,

      username:
        user.username || null,

      first_name:
        user.first_name || null,

      last_name:
        user.last_name || null,

      created_at: timestamp,

      updated_at: timestamp
    }
  );
}

async function getUser(id) {
  const result = await run(
    `
    SELECT *
    FROM users
    WHERE id = :id
    `,
    {
      id: String(id)
    }
  );

  return result.rows[0] || null;
}

/*
==================================================
UPSERT BUSINESS CONNECTION
==================================================
*/

async function upsertBusinessConnection(data) {
  if (!data?.id) {
    throw new Error(
      "Business connection ID is missing"
    );
  }

  if (!data?.userId) {
    throw new Error(
      "Business connection owner user ID is missing"
    );
  }

  const timestamp = isoNow();

  await run(
    `
    INSERT INTO business_connections (
      id,
      user_id,
      user_chat_id,
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
      :user_chat_id,
      :username,
      :first_name,
      :last_name,
      :date,
      :rights_json,
      :is_enabled,
      :created_at,
      :updated_at
    )

    ON CONFLICT(id)
    DO UPDATE SET

      user_id =
        excluded.user_id,

      user_chat_id =
        excluded.user_chat_id,

      username =
        excluded.username,

      first_name =
        excluded.first_name,

      last_name =
        excluded.last_name,

      date =
        excluded.date,

      rights_json =
        excluded.rights_json,

      is_enabled =
        excluded.is_enabled,

      updated_at =
        excluded.updated_at
    `,
    {
      id:
        String(data.id),

      user_id:
        String(data.userId),

      user_chat_id:
        data.userChatId != null
          ? String(data.userChatId)
          : null,

      username:
        data.username || null,

      first_name:
        data.firstName || null,

      last_name:
        data.lastName || null,

      date:
        Number(data.date) || null,

      rights_json:
        JSON.stringify(
          data.rights || {}
        ),

      is_enabled:
        data.isEnabled ? 1 : 0,

      created_at:
        timestamp,

      updated_at:
        timestamp
    }
  );
}

function parseConnection(row) {
  let rights = {};

  try {
    rights =
      JSON.parse(
        row.rights_json || "{}"
      );
  } catch {
    rights = {};
  }

  return {
    id: String(row.id),

    user_id:
      String(row.user_id),

    user_chat_id:
      row.user_chat_id
        ? String(row.user_chat_id)
        : null,

    username:
      row.username || "",

    first_name:
      row.first_name || "",

    last_name:
      row.last_name || "",

    date:
      row.date || null,

    rights,

    is_enabled:
      Boolean(row.is_enabled),

    created_at:
      row.created_at,

    updated_at:
      row.updated_at
  };
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

  return result.rows.map(
    parseConnection
  );
}

async function getConnection(id) {
  const result = await run(
    `
    SELECT *
    FROM business_connections
    WHERE id = :id
    LIMIT 1
    `,
    {
      id: String(id)
    }
  );

  if (!result.rows[0]) {
    return null;
  }

  return parseConnection(
    result.rows[0]
  );
}

/*
Получить подключение конкретного
пользователя.

Это дополнительная защита.
*/

async function getConnectionForUser(
  connectionId,
  userId
) {
  const result = await run(
    `
    SELECT *
    FROM business_connections

    WHERE id = :connection_id
      AND user_id = :user_id

    LIMIT 1
    `,
    {
      connection_id:
        String(connectionId),

      user_id:
        String(userId)
    }
  );

  if (!result.rows[0]) {
    return null;
  }

  return parseConnection(
    result.rows[0]
  );
}

module.exports = {
  run,

  initDatabase,

  upsertUser,

  getUser,

  upsertBusinessConnection,

  getConnections,

  getConnection,

  getConnectionForUser
};