const tg = window.Telegram?.WebApp;

const state = {
  initData: "",
  connections: [],
  connectionId: null
};

const $ = (selector) =>
  document.querySelector(selector);

const $$ = (selector) =>
  [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat(
    "ru-RU",
    {
      dateStyle: "short",
      timeStyle: "short"
    }
  ).format(date);
}

function showScreen(id) {
  $$(".screen").forEach(
    (screen) =>
      screen.classList.remove("active")
  );

  const screen = document.getElementById(id);

  if (screen) {
    screen.classList.add("active");
  }

  $$(".nav-button").forEach(
    (button) => {
      button.classList.toggle(
        "active",
        button.dataset.screen === id
      );
    }
  );

  if (id === "editedScreen") {
    loadMessages();
  }

  if (id === "deletedScreen") {
    loadMessages();
  }

  if (id === "watchScreen") {
    loadWatches();
  }

  if (id === "statsScreen") {
    loadStats();
  }
}

async function api(
  url,
  options = {}
) {
  const headers = {
    ...(options.headers || {}),
    "X-Telegram-Init-Data":
      state.initData
  };

  if (
    options.body &&
    typeof options.body !== "string"
  ) {
    headers["Content-Type"] =
      "application/json";

    options.body =
      JSON.stringify(options.body);
  }

  const response = await fetch(
    url,
    {
      ...options,
      headers
    }
  );

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Server returned ${response.status}`
    );
  }

  if (!response.ok || data.ok === false) {
    throw new Error(
      data.error ||
      "Ошибка сервера"
    );
  }

  return data;
}

function setStatus(
  connected,
  text
) {
  $("#statusDot").classList.toggle(
    "online",
    connected
  );

  $("#statusText").textContent =
    text;
}

async function loadConnections() {
  const data =
    await api(
      "/api/connections"
    );

  state.connections =
    data.connections || [];

  const select =
    $("#connectionSelect");

  select.innerHTML = "";

  if (!state.connections.length) {
    select.innerHTML =
      `<option value="">Нет Business Connection</option>`;

    $("#connectionInfo").textContent =
      "Подключи Telegram Business к боту.";

    return;
  }

  for (
    const connection of state.connections
  ) {
    const option =
      document.createElement("option");

    option.value =
      connection.id;

    option.textContent =
      connection.username
        ? `@${connection.username}`
        : `Business ${connection.id}`;

    select.appendChild(option);
  }

  state.connectionId =
    state.connections[0].id;

  select.value =
    state.connectionId;

  updateConnectionInfo();
}

function updateConnectionInfo() {
  const connection =
    state.connections.find(
      (item) =>
        item.id ===
        state.connectionId
    );

  if (!connection) {
    $("#connectionInfo").textContent =
      "Нет подключения";

    return;
  }

  $("#connectionInfo").innerHTML =
    connection.is_enabled
      ? `<span class="online-text">● Подключено</span>`
      : `<span class="offline-text">● Отключено</span>`;
}

async function loadMessages() {
  if (!state.connectionId) {
    return;
  }

  try {
    const data =
      await api(
        `/api/connections/${encodeURIComponent(
          state.connectionId
        )}/messages`
      );

    const messages =
      data.messages || [];

    const edited =
      messages.filter(
        (message) =>
          Number(message.edited) === 1
      );

    const deleted =
      messages.filter(
        (message) =>
          Number(message.deleted) === 1
      );

    $("#editedCount").textContent =
      edited.length;

    $("#deletedCount").textContent =
      deleted.length;

    $("#editedList").innerHTML =
      edited.length
        ? edited.map(renderEdited).join("")
        : emptyState(
            "✏️",
            "Изменений пока нет"
          );

    $("#deletedList").innerHTML =
      deleted.length
        ? deleted.map(renderDeleted).join("")
        : emptyState(
            "🗑",
            "Удалённых сообщений пока нет"
          );
  } catch (error) {
    console.error(error);
  }
}

function renderEdited(message) {
  const username =
    message.username
      ? `@${escapeHtml(message.username)}`
      : "Пользователь";

  const text =
    message.text ||
    message.caption ||
    "Без текста";

  return `
    <article class="message-card edited-card">

      <div class="message-top">
        <strong>${username}</strong>
        <span>${formatDate(message.updated_at)}</span>
      </div>

      <div class="change-label">
        ✏️ Сообщение изменено
      </div>

      <div class="message-text">
        ${escapeHtml(text)}
      </div>

      <div class="message-meta">
        Chat ID: ${escapeHtml(message.chat_id)}
        <br>
        Message ID: ${escapeHtml(message.message_id)}
      </div>

      ${
        message.chat_id &&
        message.message_id
          ? `
          <a
            class="message-link"
            target="_blank"
            href="${createMessageLink(message)}"
          >
            Открыть сообщение ↗
          </a>
        `
          : ""
      }

    </article>
  `;
}

function renderDeleted(message) {
  const username =
    message.username
      ? `@${escapeHtml(message.username)}`
      : "Пользователь";

  const text =
    message.text ||
    message.caption ||
    "Без текста";

  return `
    <article class="message-card deleted-card">

      <div class="message-top">
        <strong>${username}</strong>
        <span>${formatDate(message.deleted_at)}</span>
      </div>

      <div class="change-label">
        🗑 Сообщение удалено
      </div>

      <div class="message-text deleted-text">
        ${escapeHtml(text)}
      </div>

      <div class="message-meta">
        Отправлено:
        ${formatDate(message.date)}
        <br>
        Удалено:
        ${formatDate(message.deleted_at)}
        <br>
        Chat ID:
        ${escapeHtml(message.chat_id)}
        <br>
        Message ID:
        ${escapeHtml(message.message_id)}
      </div>

    </article>
  `;
}

function createMessageLink(
  message
) {
  const chatId =
    String(message.chat_id);

  const messageId =
    String(message.message_id);

  if (
    chatId.startsWith("-100")
  ) {
    const publicId =
      chatId.substring(4);

    return `https://t.me/c/${publicId}/${messageId}`;
  }

  return "#";
}

function emptyState(
  icon,
  text
) {
  return `
    <div class="empty">
      <div class="empty-icon">${icon}</div>
      <div>${text}</div>
    </div>
  `;
}

async function executeCommand() {
  const input =
    $("#commandInput");

  const command =
    input.value.trim();

  if (!command) {
    return;
  }

  if (!state.connectionId) {
    showResult(
      "Сначала подключи Business Connection.",
      true
    );

    return;
  }

  const button =
    $("#executeButton");

  button.disabled = true;
  button.textContent =
    "Выполняю...";

  try {
    const data =
      await api(
        `/api/connections/${encodeURIComponent(
          state.connectionId
        )}/command`,
        {
          method: "POST",
          body: {
            command
          }
        }
      );

    showResult(
      data.message ||
      "Готово.",
      !data.ok
    );

    await refreshAll();
  } catch (error) {
    showResult(
      error.message,
      true
    );
  } finally {
    button.disabled = false;
    button.textContent =
      "Выполнить";
  }
}

function showResult(
  text,
  error = false
) {
  const box =
    $("#commandResult");

  box.textContent = text;

  box.classList.remove(
    "hidden",
    "error"
  );

  if (error) {
    box.classList.add("error");
  }
}

async function loadWatches() {
  if (!state.connectionId) {
    return;
  }

  try {
    const data =
      await api(
        `/api/connections/${encodeURIComponent(
          state.connectionId
        )}/watches`
      );

    const watches =
      data.watches || [];

    $("#watchCount").textContent =
      watches.length;

    $("#watchList").innerHTML =
      watches.length
        ? watches
            .map(
              (watch) => `
                <div class="watch-item">

                  <div>
                    <strong>
                      @${escapeHtml(
                        watch.username
                      )}
                    </strong>

                    <small>
                      ● Активно
                    </small>
                  </div>

                  <button
                    class="danger-small"
                    data-remove-watch="${escapeHtml(
                      watch.username
                    )}"
                  >
                    Удалить
                  </button>

                </div>
              `
            )
            .join("")
        : emptyState(
            "👁",
            "Нет активных слежений"
          );
  } catch (error) {
    console.error(error);
  }
}

async function addWatch() {
  const input =
    $("#watchInput");

  let username =
    input.value.trim();

  username =
    username.replace(
      /^@/,
      ""
    );

  if (!username) {
    return;
  }

  try {
    await api(
      `/api/connections/${encodeURIComponent(
        state.connectionId
      )}/watches`,
      {
        method: "POST",
        body: {
          username
        }
      }
    );

    input.value = "";

    await loadWatches();
  } catch (error) {
    alert(error.message);
  }
}

async function removeWatch(
  username
) {
  try {
    await api(
      `/api/connections/${encodeURIComponent(
        state.connectionId
      )}/watches/${encodeURIComponent(
        username
      )}`,
      {
        method: "DELETE"
      }
    );

    await loadWatches();
  } catch (error) {
    alert(error.message);
  }
}

async function loadStats() {
  if (!state.connectionId) {
    return;
  }

  try {
    const data =
      await api(
        `/api/connections/${encodeURIComponent(
          state.connectionId
        )}/stats`
      );

    const stats =
      data.stats || {};

    $("#eventCount").textContent =
      stats.events || 0;

    $("#statsGrid").innerHTML = `
      ${statBox(
        "📥",
        stats.received,
        "Получено"
      )}

      ${statBox(
        "📤",
        stats.sent,
        "Отправлено"
      )}

      ${statBox(
        "✏️",
        stats.edited,
        "Изменено"
      )}

      ${statBox(
        "🗑",
        stats.deleted,
        "Удалено"
      )}

      ${statBox(
        "⚡",
        stats.events,
        "События"
      )}

      ${statBox(
        "🤖",
        stats.commands,
        "Команды"
      )}

      ${statBox(
        "👁",
        stats.watches,
        "Слежение"
      )}
    `;
  } catch (error) {
    console.error(error);
  }
}

function statBox(
  icon,
  value,
  label
) {
  return `
    <div class="big-stat">
      <span>${icon}</span>
      <strong>${value || 0}</strong>
      <small>${label}</small>
    </div>
  `;
}

async function refreshAll() {
  await loadMessages();
  await loadWatches();
  await loadStats();
}

$("#connectionSelect")
  .addEventListener(
    "change",
    async (event) => {
      state.connectionId =
        event.target.value;

      updateConnectionInfo();

      await refreshAll();
    }
  );

$("#executeButton")
  .addEventListener(
    "click",
    executeCommand
  );

$("#commandInput")
  .addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Enter" &&
        (event.metaKey ||
          event.ctrlKey)
      ) {
        executeCommand();
      }
    }
  );

$("#watchAddButton")
  .addEventListener(
    "click",
    addWatch
  );

document.addEventListener(
  "click",
  async (event) => {
    const nav =
      event.target.closest(
        "[data-screen]"
      );

    if (nav) {
      showScreen(
        nav.dataset.screen
      );
    }

    const back =
      event.target.closest(
        ".back"
      );

    if (back) {
      showScreen(
        "homeScreen"
      );
    }

    const example =
      event.target.closest(
        ".example"
      );

    if (example) {
      $("#commandInput").value =
        example.dataset.command;

      showScreen(
        "homeScreen"
      );

      $("#commandInput").focus();
    }

    const remove =
      event.target.closest(
        "[data-remove-watch]"
      );

    if (remove) {
      await removeWatch(
        remove.dataset.removeWatch
      );
    }
  }
);

async function init() {
  try {
    if (!tg) {
      setStatus(
        false,
        "Откройте через Telegram"
      );

      return;
    }

    tg.ready();
    tg.expand();

    state.initData =
      tg.initData;

    if (!state.initData) {
      setStatus(
        false,
        "Нет initData"
      );

      return;
    }

    setStatus(
      true,
      "Подключено"
    );

    await loadConnections();

    if (state.connectionId) {
      await refreshAll();
    }
  } catch (error) {
    console.error(error);

    setStatus(
      false,
      "Ошибка подключения"
    );
  }
}

init();