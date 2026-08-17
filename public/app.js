"use strict";

const tg =
  window.Telegram?.WebApp || null;

if (tg) {
  tg.ready();
  tg.expand();

  try {
    tg.setHeaderColor("#0b0d12");
    tg.setBackgroundColor("#0b0d12");
  } catch {}
}

const state = {
  user: null,
  connections: [],
  connection: null
};

const $ = selector =>
  document.querySelector(selector);

const $$ = selector =>
  Array.from(
    document.querySelectorAll(selector)
  );

function initData() {
  return tg?.initData || "";
}

async function api(
  url,
  options = {}
) {
  const headers = {
    ...(options.headers || {})
  };

  headers[
    "X-Telegram-Init-Data"
  ] = initData();

  if (
    options.body &&
    !headers["Content-Type"]
  ) {
    headers["Content-Type"] =
      "application/json";
  }

  const response =
    await fetch(url, {
      ...options,
      headers
    });

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
      data.message ||
      data.error ||
      "Request failed"
    );
  }

  return data;
}

function showToast(
  message,
  type = "normal"
) {
  const toast =
    $("#toast");

  toast.textContent =
    message;

  toast.className =
    `toast visible ${type}`;

  clearTimeout(
    showToast.timer
  );

  showToast.timer =
    setTimeout(() => {
      toast.className =
        "toast";
    }, 3000);
}

function escapeHtml(value) {
  return String(
    value ?? ""
  )
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) {
    return "—";
  }

  const date =
    new Date(
      typeof value === "number"
        ? value * 1000
        : value
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "ru-RU",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }
  ).format(date);
}

function currentConnectionId() {
  return state.connection?.id || null;
}

function setConnectionUI() {
  const badge =
    $("#connectionBadge");

  const title =
    $("#connectionTitle");

  const description =
    $("#connectionDescription");

  if (!state.connection) {
    badge.className =
      "connection-badge offline";

    badge.innerHTML =
      "<span></span> Нет связи";

    title.textContent =
      "Business не подключён";

    description.textContent =
      "Открой Telegram Business и подключи этого бота к аккаунту.";

    return;
  }

  badge.className =
    state.connection.is_enabled
      ? "connection-badge online"
      : "connection-badge offline";

  badge.innerHTML =
    state.connection.is_enabled
      ? "<span></span> Подключено"
      : "<span></span> Отключено";

  const username =
    state.connection.username
      ? `@${state.connection.username}`
      : state.connection.first_name ||
        "Business account";

  title.textContent =
    username;

  description.textContent =
    state.connection.is_enabled
      ? "Business Connection работает."
      : "Business Connection отключён.";
}

async function loadMe() {
  const data =
    await api("/api/me");

  state.user =
    data.user;

  return data;
}

async function loadConnections() {
  const data =
    await api(
      "/api/connections"
    );

  state.connections =
    data.connections || [];

  state.connection =
    state.connections.find(
      item =>
        item.is_enabled
    ) ||
    state.connections[0] ||
    null;

  setConnectionUI();

  return data;
}

async function loadStats() {
  if (!currentConnectionId()) {
    return;
  }

  const data =
    await api(
      `/api/connections/${encodeURIComponent(
        currentConnectionId()
      )}/stats`
    );

  const stats =
    data.stats || {};

  $("#statReceived")
    .textContent =
    stats.received || 0;

  $("#statSent")
    .textContent =
    stats.sent || 0;

  $("#statDeleted")
    .textContent =
    stats.deleted || 0;

  $("#statEvents")
    .textContent =
    stats.events || 0;
}

function showPage(page) {
  $$(".page").forEach(
    element => {
      element.classList.toggle(
        "active",
        element.id ===
          `page-${page}`
      );
    }
  );

  $$(".nav-button").forEach(
    button => {
      button.classList.toggle(
        "active",
        button.dataset.page ===
          page
      );
    }
  );

  $("#pageSubtitle")
    .textContent =
    page === "home"
      ? "Telegram Business Manager"
      : page === "messages"
        ? "История и отправка"
        : page === "edited"
          ? "Изменения сообщений"
          : page === "deleted"
            ? "Удалённые сообщения"
            : page === "commands"
              ? "Управление через AI"
              : page === "watch"
                ? "Отслеживание аккаунтов"
                : "Журнал STMA";

  if (page === "messages") {
    loadMessages();
  }

  if (page === "edited") {
    loadEdited();
  }

  if (page === "deleted") {
    loadDeleted();
  }

  if (page === "watch") {
    loadWatches();
  }

  if (page === "events") {
    loadEvents();
  }
}

$$("[data-page]").forEach(
  button => {
    button.addEventListener(
      "click",
      () => {
        showPage(
          button.dataset.page
        );
      }
    );
  }
);

async function loadMessages() {
  const list =
    $("#messagesList");

  if (!currentConnectionId()) {
    list.innerHTML =
      emptyState(
        "Business Connection не подключён."
      );

    return;
  }

  list.innerHTML =
    loadingState();

  try {
    const data =
      await api(
        `/api/connections/${encodeURIComponent(
          currentConnectionId()
        )}/messages?limit=150`
      );

    const messages =
      data.messages || [];

    if (!messages.length) {
      list.innerHTML =
        emptyState(
          "История сообщений пока пустая."
        );

      return;
    }

    list.innerHTML =
      messages
        .map(
          message =>
            messageCard(
              message
            )
        )
        .join("");
  } catch (error) {
    list.innerHTML =
      errorState(
        error.message
      );
  }
}

function messageCard(message) {
  const username =
    message.from_username
      ? `@${escapeHtml(
          message.from_username
        )}`
      : escapeHtml(
          message.from_first_name ||
          message.from_user_id ||
          "Unknown"
        );

  const body =
    escapeHtml(
      message.text ||
      message.caption ||
      "[медиа]"
    );

  let status =
    message.deleted
      ? `<span class="status deleted">Удалено</span>`
      : message.edited
        ? `<span class="status edited">Изменено</span>`
        : `<span class="status">Сохранено</span>`;

  const link =
    message.link
      ? `<a class="mini-link" href="${escapeHtml(
          message.link
        )}" target="_blank">Открыть</a>`
      : "";

  const deleteButton =
    !message.deleted
      ? `
        <button
          class="danger-small"
          onclick="deleteMessage('${escapeHtml(
            message.chat_id
          )}', ${Number(
            message.message_id
          )})"
        >
          Удалить
        </button>
      `
      : "";

  return `
    <article class="message-card">

      <div class="message-top">
        <strong>${username}</strong>
        ${status}
      </div>

      <div class="message-body">
        ${body}
      </div>

      <div class="message-meta">
        <span>
          ${formatDate(message.date)}
        </span>

        <span>
          Chat ${escapeHtml(
            message.chat_id
          )}
        </span>

        <span>
          #${Number(
            message.message_id
          )}
        </span>
      </div>

      <div class="message-actions">
        ${link}
        ${deleteButton}
      </div>

    </article>
  `;
}

window.deleteMessage =
  async function(
    chatId,
    messageId
  ) {
    if (
      !confirm(
        "Удалить это сообщение?"
      )
    ) {
      return;
    }

    try {
      await api(
        `/api/connections/${encodeURIComponent(
          currentConnectionId()
        )}/messages/${encodeURIComponent(
          chatId
        )}/${messageId}`,
        {
          method: "DELETE"
        }
      );

      showToast(
        "Сообщение удалено",
        "success"
      );

      await loadMessages();
      await loadStats();
    } catch (error) {
      showToast(
        error.message,
        "error"
      );
    }
  };

async function loadEdited() {
  const list =
    $("#editedList");

  if (!currentConnectionId()) {
    list.innerHTML =
      emptyState(
        "Business Connection не подключён."
      );

    return;
  }

  try {
    const data =
      await api(
        `/api/connections/${encodeURIComponent(
          currentConnectionId()
        )}/messages?limit=200`
      );

    const messages =
      (data.messages || [])
        .filter(
          message =>
            message.edited
        );

    if (!messages.length) {
      list.innerHTML =
        emptyState(
          "Изменённых сообщений пока нет."
        );

      return;
    }

    list.innerHTML =
      messages
        .map(
          message =>
            messageCard(
              message
            )
        )
        .join("");
  } catch (error) {
    list.innerHTML =
      errorState(
        error.message
      );
  }
}

async function loadDeleted() {
  const list =
    $("#deletedList");

  if (!currentConnectionId()) {
    list.innerHTML =
      emptyState(
        "Business Connection не подключён."
      );

    return;
  }

  try {
    const data =
      await api(
        `/api/connections/${encodeURIComponent(
          currentConnectionId()
        )}/messages?limit=200`
      );

    const messages =
      (data.messages || [])
        .filter(
          message =>
            message.deleted
        );

    if (!messages.length) {
      list.innerHTML =
        emptyState(
          "Удалённых сообщений пока нет."
        );

      return;
    }

    list.innerHTML =
      messages
        .map(
          message =>
            messageCard(
              message
            )
        )
        .join("");
  } catch (error) {
    list.innerHTML =
      errorState(
        error.message
      );
  }
}

$("#sendMessageButton")
  .addEventListener(
    "click",
    async () => {
      const chatId =
        $("#messageChatId")
          .value
          .trim();

      const text =
        $("#messageText")
          .value
          .trim();

      const deleteAfter =
        Number(
          $("#messageDeleteAfter")
            .value || 0
        );

      if (!chatId) {
        showToast(
          "Укажи Chat ID",
          "error"
        );

        return;
      }

      if (!text) {
        showToast(
          "Напиши текст сообщения",
          "error"
        );

        return;
      }

      try {
        const data =
          await api(
            `/api/connections/${encodeURIComponent(
              currentConnectionId()
            )}/messages`,
            {
              method: "POST",

              body:
                JSON.stringify({
                  chatId,
                  text,
                  deleteAfter
                })
            }
          );

        $("#messageText")
          .value = "";

        showToast(
          deleteAfter > 0
            ? "Отправлено. Таймер удаления запущен."
            : "Сообщение отправлено.",
          "success"
        );

        await loadMessages();
        await loadStats();
      } catch (error) {
        showToast(
          error.message,
          "error"
        );
      }
    }
  );

$$(".example").forEach(
  button => {
    button.addEventListener(
      "click",
      () => {
        $("#commandInput")
          .value =
          button.dataset.command;
      }
    );
  }
);

$("#executeCommandButton")
  .addEventListener(
    "click",
    async () => {
      const command =
        $("#commandInput")
          .value
          .trim();

      const chatId =
        $("#commandChatId")
          .value
          .trim();

      if (!command) {
        showToast(
          "Введи команду",
          "error"
        );

        return;
      }

      try {
        const data =
          await api(
            `/api/connections/${encodeURIComponent(
              currentConnectionId()
            )}/command`,
            {
              method: "POST",

              body:
                JSON.stringify({
                  command,
                  chatId:
                    chatId || null
                })
            }
          );

        const result =
          data.result || {};

        const box =
          $("#commandResult");

        box.className =
          `result-box ${
            result.ok
              ? "success"
              : "error"
          }`;

        box.textContent =
          result.message ||
          "Команда выполнена.";

        await loadStats();

        if (
          result.type ===
            "watch" ||
          result.type ===
            "unwatch"
        ) {
          await loadWatches();
        }
      } catch (error) {
        const box =
          $("#commandResult");

        box.className =
          "result-box error";

        box.textContent =
          error.message;
      }
    }
  );

$("#addWatchButton")
  .addEventListener(
    "click",
    async () => {
      const username =
        $("#watchUsername")
          .value
          .trim()
          .replace(/^@/, "");

      if (!username) {
        showToast(
          "Укажи username",
          "error"
        );

        return;
      }

      try {
        await api(
          `/api/connections/${encodeURIComponent(
            currentConnectionId()
          )}/watches`,
          {
            method: "POST",

            body:
              JSON.stringify({
                username
              })
          }
        );

        $("#watchUsername")
          .value = "";

        showToast(
          `Слежение за @${username} включено`,
          "success"
        );

        await loadWatches();
        await loadStats();
      } catch (error) {
        showToast(
          error.message,
          "error"
        );
      }
    }
  );

async function loadWatches() {
  const list =
    $("#watchesList");

  if (!currentConnectionId()) {
    list.innerHTML =
      emptyState(
        "Business Connection не подключён."
      );

    return;
  }

  try {
    const data =
      await api(
        `/api/connections/${encodeURIComponent(
          currentConnectionId()
        )}/watches`
      );

    const watches =
      data.watches || [];

    if (!watches.length) {
      list.innerHTML =
        emptyState(
          "Активных слежений нет."
        );

      return;
    }

    list.innerHTML =
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

                <small>
                  ${
                    watch.user_id
                      ? `ID ${escapeHtml(
                          watch.user_id
                        )}`
                      : "Ожидание сообщения"
                  }
                </small>
              </div>

              <button
                class="danger-small"
                onclick="removeWatch('${escapeHtml(
                  watch.username
                )}')"
              >
                Удалить
              </button>

            </article>
          `
        )
        .join("");
  } catch (error) {
    list.innerHTML =
      errorState(
        error.message
      );
  }
}

window.removeWatch =
  async function(username) {
    try {
      await api(
        `/api/connections/${encodeURIComponent(
          currentConnectionId()
        )}/watches/${encodeURIComponent(
          username
        )}`,
        {
          method: "DELETE"
        }
      );

      showToast(
        "Слежение удалено",
        "success"
      );

      await loadWatches();
      await loadStats();
    } catch (error) {
      showToast(
        error.message,
        "error"
      );
    }
  };

async function loadEvents() {
  const list =
    $("#eventsList");

  if (!currentConnectionId()) {
    list.innerHTML =
      emptyState(
        "Business Connection не подключён."
      );

    return;
  }

  try {
    const data =
      await api(
        `/api/connections/${encodeURIComponent(
          currentConnectionId()
        )}/events?limit=150`
      );

    const events =
      data.events || [];

    if (!events.length) {
      list.innerHTML =
        emptyState(
          "Событий пока нет."
        );

      return;
    }

    list.innerHTML =
      events
        .map(
          event => `
            <details class="event-card">

              <summary>

                <div>
                  <strong>
                    ${escapeHtml(
                      event.type
                    )}
                  </strong>

                  <small>
                    ${formatDate(
                      event.created_at
                    )}
                  </small>
                </div>

                <span>
                  ›
                </span>

              </summary>

              <pre>${escapeHtml(
                JSON.stringify(
                  event,
                  null,
                  2
                )
              )}</pre>

            </details>
          `
        )
        .join("");
  } catch (error) {
    list.innerHTML =
      errorState(
        error.message
      );
  }
}

function loadingState() {
  return `
    <div class="state">
      Загрузка…
    </div>
  `;
}

function emptyState(message) {
  return `
    <div class="state">
      ${escapeHtml(message)}
    </div>
  `;
}

function errorState(message) {
  return `
    <div class="state error-state">
      ${escapeHtml(message)}
    </div>
  `;
}

async function bootstrap() {
  if (!tg) {
    showToast(
      "STMA должен открываться внутри Telegram.",
      "error"
    );
  }

  if (!initData()) {
    $("#connectionTitle")
      .textContent =
      "Открой STMA внутри Telegram";

    $("#connectionDescription")
      .textContent =
      "Telegram Web App initData отсутствует.";

    return;
  }

  try {
    await loadMe();
    await loadConnections();
    await loadStats();
  } catch (error) {
    console.error(error);

    $("#connectionTitle")
      .textContent =
      "Ошибка авторизации";

    $("#connectionDescription")
      .textContent =
      error.message;

    showToast(
      error.message,
      "error"
    );
  }
}

bootstrap();

setInterval(
  async () => {
    try {
      await loadConnections();
      await loadStats();
    } catch {}
  },
  30000
);