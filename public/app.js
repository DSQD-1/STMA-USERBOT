const tg =
  window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();

  if (
    typeof tg.disableVerticalSwipes ===
    "function"
  ) {
    tg.disableVerticalSwipes();
  }
}

const state = {
  initData:
    tg?.initData || "",

  connections: [],

  connection: null,

  tab: "messages",

  loading: false
};

const $ = id =>
  document.getElementById(id);

function escapeHtml(
  value
) {
  return String(
    value ?? ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}

function formatDate(
  value
) {
  if (!value) {
    return "—";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return String(value);
  }

  return date.toLocaleString(
    "ru-RU",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }
  );
}

function show(
  element
) {
  element.classList.remove(
    "hidden"
  );
}

function hide(
  element
) {
  element.classList.add(
    "hidden"
  );
}

function toast(
  message,
  type = "normal"
) {
  const element =
    $("toast");

  element.textContent =
    message;

  element.className =
    `toast ${type}`;

  show(element);

  clearTimeout(
    toast.timer
  );

  toast.timer =
    setTimeout(
      () =>
        hide(element),
      3000
    );
}

function apiHeaders() {
  return {
    "Content-Type":
      "application/json",

    "X-Telegram-Init-Data":
      state.initData
  };
}

async function api(
  url,
  options = {}
) {
  const response =
    await fetch(
      url,
      {
        ...options,

        headers: {
          ...apiHeaders(),
          ...(options.headers || {})
        }
      }
    );

  let data;

  try {
    data =
      await response.json();
  } catch {
    throw new Error(
      `HTTP ${response.status}`
    );
  }

  if (
    !response.ok ||
    data.ok === false
  ) {
    throw new Error(
      data.error ||
      `HTTP ${response.status}`
    );
  }

  return data;
}

/*
==================================================
CONNECTION
==================================================
*/

async function loadConnections() {
  const data =
    await api(
      "/api/connections"
    );

  state.connections =
    data.connections || [];

  if (
    !state.connections.length
  ) {
    state.connection =
      null;

    renderConnection();

    return;
  }

  /*
  Берём первое активное
  подключение.
  */

  state.connection =
    state.connections.find(
      item =>
        item.is_enabled
    ) ||
    state.connections[0];

  renderConnection();

  await loadDashboard();
}

function renderConnection() {
  const status =
    $("connection-status");

  const name =
    $("connection-name");

  const stateElement =
    $("connection-state");

  const dot =
    $("connection-dot");

  if (
    !state.connection
  ) {
    status.textContent =
      "Business не подключён";

    name.textContent =
      "Нет Business Connection";

    stateElement.textContent =
      "Отключено";

    dot.classList.remove(
      "online"
    );

    return;
  }

  const connection =
    state.connection;

  const username =
    connection.username
      ? `@${connection.username}`
      : "";

  const fullName =
    [
      connection.first_name,
      connection.last_name
    ]
      .filter(Boolean)
      .join(" ");

  name.textContent =
    username ||
    fullName ||
    String(
      connection.user_id
    );

  if (
    connection.is_enabled
  ) {
    status.textContent =
      "Business подключён";

    stateElement.textContent =
      "Подключено";

    dot.classList.add(
      "online"
    );
  } else {
    status.textContent =
      "Business отключён";

    stateElement.textContent =
      "Отключено";

    dot.classList.remove(
      "online"
    );
  }
}

/*
==================================================
DASHBOARD
==================================================
*/

async function loadDashboard() {
  if (
    !state.connection
  ) {
    renderEmptyConnection();
    return;
  }

  await Promise.all([
    loadStats(),
    loadMessages(),
    loadWatches(),
    loadEvents()
  ]);
}

async function loadStats() {
  if (
    !state.connection
  ) {
    return;
  }

  const data =
    await api(
      `/api/connections/${encodeURIComponent(
        state.connection.id
      )}/stats`
    );

  const stats =
    data.stats || {};

  $("stat-received")
    .textContent =
    stats.received || 0;

  $("stat-sent")
    .textContent =
    stats.sent || 0;

  $("stat-edited")
    .textContent =
    stats.edited || 0;

  $("stat-deleted")
    .textContent =
    stats.deleted || 0;
}

/*
==================================================
MESSAGES
==================================================
*/

async function loadMessages() {
  if (
    !state.connection
  ) {
    return;
  }

  const data =
    await api(
      `/api/connections/${encodeURIComponent(
        state.connection.id
      )}/messages`
    );

  renderMessages(
    $("messages-list"),
    data.messages || [],
    "messages"
  );
}

async function loadEdited() {
  if (
    !state.connection
  ) {
    return;
  }

  const data =
    await api(
      `/api/connections/${encodeURIComponent(
        state.connection.id
      )}/edits`
    );

  renderMessages(
    $("edited-list"),
    data.messages || [],
    "edited"
  );
}

async function loadDeleted() {
  if (
    !state.connection
  ) {
    return;
  }

  const data =
    await api(
      `/api/connections/${encodeURIComponent(
        state.connection.id
      )}/deleted`
    );

  renderMessages(
    $("deleted-list"),
    data.messages || [],
    "deleted"
  );
}

function renderMessages(
  container,
  messages,
  mode
) {
  if (
    !messages.length
  ) {
    container.innerHTML =
      emptyState(
        mode === "deleted"
          ? "Удалённых сообщений пока нет"
          : mode === "edited"
            ? "Изменённых сообщений пока нет"
            : "Сообщений пока нет"
      );

    return;
  }

  container.innerHTML =
    messages
      .map(
        message =>
          messageCard(
            message,
            mode
          )
      )
      .join("");
}

function messageCard(
  message,
  mode
) {
  const username =
    message.username
      ? `@${escapeHtml(
          message.username
        )}`
      : "Без username";

  const text =
    message.text ||
    message.caption ||
    "Медиа / сообщение без текста";

  let status =
    "Получено";

  if (
    message.direction ===
    "outgoing"
  ) {
    status =
      "Отправлено";
  }

  if (
    message.edited
  ) {
    status =
      "Изменено";
  }

  if (
    message.deleted
  ) {
    status =
      "Удалено";
  }

  const link =
    message.message_link
      ? `
        <a
          class="message-link"
          href="${escapeHtml(
            message.message_link
          )}"
          target="_blank"
          rel="noopener"
        >
          Открыть сообщение
        </a>
      `
      : "";

  const deletedAt =
    message.deleted_at
      ? `
        <div class="meta-line danger-text">
          Удалено:
          ${escapeHtml(
            formatDate(
              message.deleted_at
            )
          )}
        </div>
      `
      : "";

  return `
    <article class="message-card">

      <div class="message-top">

        <strong>
          ${username}
        </strong>

        <span class="status-pill ${mode}">
          ${status}
        </span>

      </div>

      <div class="message-text">
        ${escapeHtml(text)}
      </div>

      <div class="message-meta">

        <div class="meta-line">
          Chat ID:
          ${escapeHtml(
            message.chat_id
          )}
        </div>

        <div class="meta-line">
          Message ID:
          ${escapeHtml(
            message.message_id
          )}
        </div>

        <div class="meta-line">
          ${escapeHtml(
            formatDate(
              message.date ||
              message.created_at
            )
          )}
        </div>

        ${deletedAt}

      </div>

      ${link}

    </article>
  `;
}

/*
==================================================
WATCHES
==================================================
*/

async function loadWatches() {
  if (
    !state.connection
  ) {
    return;
  }

  const data =
    await api(
      `/api/connections/${encodeURIComponent(
        state.connection.id
      )}/watches`
    );

  renderWatches(
    data.watches || []
  );
}

function renderWatches(
  watches
) {
  const container =
    $("watches-list");

  if (
    !watches.length
  ) {
    container.innerHTML =
      emptyState(
        "Активных слежений нет"
      );

    return;
  }

  container.innerHTML =
    watches
      .map(
        watch => `
          <article class="watch-card">

            <div>

              <strong>
                @${escapeHtml(
                  watch.username
                )}
              </strong>

              <div class="muted">
                Слежка активна
              </div>

            </div>

            <button
              class="danger-button"
              data-remove-watch="${escapeHtml(
                watch.username
              )}"
            >
              Удалить
            </button>

          </article>
        `
      )
      .join("");

  container
    .querySelectorAll(
      "[data-remove-watch]"
    )
    .forEach(
      button => {
        button.addEventListener(
          "click",
          async () => {
            await removeWatch(
              button.dataset
                .removeWatch
            );
          }
        );
      }
    );
}

async function removeWatch(
  username
) {
  try {
    await api(
      `/api/connections/${encodeURIComponent(
        state.connection.id
      )}/watches/${encodeURIComponent(
        username
      )}`,
      {
        method:
          "DELETE"
      }
    );

    toast(
      `Слежка за @${username} удалена`,
      "success"
    );

    await loadWatches();
  } catch (error) {
    toast(
      error.message,
      "error"
    );
  }
}

/*
==================================================
EVENTS
==================================================
*/

async function loadEvents() {
  if (
    !state.connection
  ) {
    return;
  }

  const data =
    await api(
      `/api/connections/${encodeURIComponent(
        state.connection.id
      )}/events`
    );

  renderEvents(
    data.events || []
  );
}

function renderEvents(
  events
) {
  const container =
    $("events-list");

  if (
    !events.length
  ) {
    container.innerHTML =
      emptyState(
        "Событий пока нет"
      );

    return;
  }

  container.innerHTML =
    events
      .map(
        event => {
          let payload = "";

          try {
            payload =
              event.payload_json
                ? JSON.stringify(
                    JSON.parse(
                      event.payload_json
                    ),
                    null,
                    2
                  )
                : "";
          } catch {
            payload =
              event.payload_json ||
              "";
          }

          return `
            <article class="event-card">

              <div class="event-top">

                <strong>
                  ${escapeHtml(
                    event.type
                  )}
                </strong>

                <span>
                  ${escapeHtml(
                    formatDate(
                      event.created_at
                    )
                  )}
                </span>

              </div>

              <div class="event-info">

                ${
                  event.username
                    ? `
                      <div>
                        @${escapeHtml(
                          event.username
                        )}
                      </div>
                    `
                    : ""
                }

                ${
                  event.chat_id
                    ? `
                      <div>
                        Chat:
                        ${escapeHtml(
                          event.chat_id
                        )}
                      </div>
                    `
                    : ""
                }

                ${
                  event.message_id
                    ? `
                      <div>
                        Message:
                        ${escapeHtml(
                          event.message_id
                        )}
                      </div>
                    `
                    : ""
                }

              </div>

              ${
                payload
                  ? `
                    <details>
                      <summary>
                        JSON
                      </summary>

                      <pre>${escapeHtml(
                        payload
                      )}</pre>
                    </details>
                  `
                  : ""
              }

            </article>
          `;
        }
      )
      .join("");
}

/*
==================================================
COMMAND
==================================================
*/

async function executeAICommand() {
  if (
    !state.connection
  ) {
    toast(
      "Сначала подключи Telegram Business",
      "error"
    );

    return;
  }

  const input =
    $("command-input");

  const button =
    $("command-button");

  const command =
    input.value.trim();

  if (!command) {
    toast(
      "Введите команду",
      "error"
    );

    return;
  }

  button.disabled =
    true;

  button.textContent =
    "Выполняю...";

  try {
    const data =
      await api(
        `/api/connections/${encodeURIComponent(
          state.connection.id
        )}/command`,
        {
          method:
            "POST",

          body:
            JSON.stringify({
              command
            })
        }
      );

    showCommandResult(
      data
    );

    input.value =
      "";

    await loadDashboard();

    if (
      state.tab ===
      "edited"
    ) {
      await loadEdited();
    }

    if (
      state.tab ===
      "deleted"
    ) {
      await loadDeleted();
    }

    if (
      data.message
    ) {
      toast(
        data.message,
        "success"
      );
    }
  } catch (error) {
    showCommandResult({
      ok: false,
      error:
        error.message
    });

    toast(
      error.message,
      "error"
    );
  } finally {
    button.disabled =
      false;

    button.textContent =
      "Выполнить";
  }
}

function showCommandResult(
  data
) {
  const box =
    $("command-result");

  show(box);

  if (
    data.ok
  ) {
    box.className =
      "command-result success";

    box.textContent =
      data.message ||
      "Готово";
  } else {
    box.className =
      "command-result error";

    box.textContent =
      data.error ||
      data.message ||
      "Ошибка";
  }
}

/*
==================================================
TABS
==================================================
*/

function switchTab(
  tab
) {
  state.tab =
    tab;

  document
    .querySelectorAll(
      ".tab"
    )
    .forEach(
      button => {
        button.classList.toggle(
          "active",
          button.dataset.tab ===
            tab
        );
      }
    );

  document
    .querySelectorAll(
      ".tab-content"
    )
    .forEach(
      section => {
        section.classList.toggle(
          "hidden",
          section.id !==
            `tab-${tab}`
        );
      }
    );

  if (
    tab === "edited"
  ) {
    loadEdited();
  }

  if (
    tab === "deleted"
  ) {
    loadDeleted();
  }

  if (
    tab === "messages"
  ) {
    loadMessages();
  }

  if (
    tab === "watches"
  ) {
    loadWatches();
  }

  if (
    tab === "events"
  ) {
    loadEvents();
  }
}

/*
==================================================
EMPTY
==================================================
*/

function emptyState(
  text
) {
  return `
    <div class="empty-state">
      <div class="empty-icon">
        —
      </div>

      <div>
        ${escapeHtml(text)}
      </div>
    </div>
  `;
}

function renderEmptyConnection() {
  $("messages-list").innerHTML =
    emptyState(
      "Подключи Telegram Business к STMA"
    );

  $("edited-list").innerHTML =
    emptyState(
      "Нет Business Connection"
    );

  $("deleted-list").innerHTML =
    emptyState(
      "Нет Business Connection"
    );

  $("watches-list").innerHTML =
    emptyState(
      "Нет Business Connection"
    );

  $("events-list").innerHTML =
    emptyState(
      "Нет Business Connection"
    );
}

/*
==================================================
START
==================================================
*/

async function loadApp() {
  hide(
    $("error-screen")
  );

  hide(
    $("main-screen")
  );

  show(
    $("loading-screen")
  );

  if (!state.initData) {
    throw new Error(
      "Mini App открыт вне Telegram или Telegram initData отсутствует."
    );
  }

  await api(
    "/api/me"
  );

  await loadConnections();

  hide(
    $("loading-screen")
  );

  show(
    $("main-screen")
  );
}

async function boot() {
  try {
    await loadApp();
  } catch (error) {
    console.error(
      error
    );

    hide(
      $("loading-screen")
    );

    show(
      $("error-screen")
    );

    $("error-text")
      .textContent =
      error.message;
  }
}

/*
==================================================
EVENT LISTENERS
==================================================
*/

$("command-button")
  .addEventListener(
    "click",
    executeAICommand
  );

$("command-input")
  .addEventListener(
    "keydown",
    event => {
      if (
        event.key ===
          "Enter" &&
        !event.shiftKey
      ) {
        event.preventDefault();

        executeAICommand();
      }
    }
  );

document
  .querySelectorAll(
    ".example"
  )
  .forEach(
    button => {
      button.addEventListener(
        "click",
        () => {
          $("command-input")
            .value =
            button.dataset.command;

          $("command-input")
            .focus();
        }
      );
    }
  );

document
  .querySelectorAll(
    ".tab"
  )
  .forEach(
    button => {
      button.addEventListener(
        "click",
        () =>
          switchTab(
            button.dataset.tab
          )
      );
    }
  );

document
  .querySelectorAll(
    "[data-refresh-tab]"
  )
  .forEach(
    button => {
      button.addEventListener(
        "click",
        async () => {
          if (
            button.dataset
              .refreshTab ===
            "messages"
          ) {
            await loadMessages();
          }
        }
      );
    }
  );

$("refresh-button")
  .addEventListener(
    "click",
    async () => {
      try {
        await loadApp();

        toast(
          "Обновлено",
          "success"
        );
      } catch (error) {
        toast(
          error.message,
          "error"
        );
      }
    }
  );

$("retry-button")
  .addEventListener(
    "click",
    boot
  );

boot();