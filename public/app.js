"use strict";

const tg = window.Telegram?.WebApp || null;

const state = {
  initData: "",
  user: null,
  connections: [],
  connection: null,
  screen: "dashboard",
  initialized: false
};

const $ = (selector) =>
  document.querySelector(selector);

const $$ = (selector) =>
  [...document.querySelectorAll(selector)];

function showToast(message, error = false) {
  const toast = $("#toast");

  if (!toast) return;

  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.classList.toggle("error", error);

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 3000);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/*
 * Telegram Mini App authorization
 *
 * ВАЖНО:
 * Используем именно tg.initData.
 * Не используем tg.initDataUnsafe для авторизации.
 */
function getTelegramInitData() {
  if (!tg) {
    return "";
  }

  const initData = tg.initData;

  if (
    typeof initData !== "string" ||
    !initData.trim()
  ) {
    return "";
  }

  return initData;
}

async function api(url, options = {}) {
  if (!state.initData) {
    throw new Error(
      "Telegram Mini App authorization data отсутствует"
    );
  }

  const requestOptions = {
    ...options
  };

  const headers = {
    ...(requestOptions.headers || {}),
    "X-Telegram-Init-Data": state.initData
  };

  if (
    requestOptions.body &&
    typeof requestOptions.body !== "string"
  ) {
    headers["Content-Type"] =
      "application/json";

    requestOptions.body =
      JSON.stringify(
        requestOptions.body
      );
  }

  requestOptions.headers = headers;

  const response = await fetch(
    url,
    requestOptions
  );

  let data = null;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `STMA server returned HTTP ${response.status}`
    );
  }

  if (
    response.status === 401
  ) {
    throw new Error(
      data?.error ||
        "Telegram Mini App authorization failed"
    );
  }

  if (
    !response.ok ||
    data?.ok === false
  ) {
    throw new Error(
      data?.error ||
        "STMA request failed"
    );
  }

  return data;
}

function setScreen(screen) {
  state.screen = screen;

  $$(".screen").forEach((element) => {
    element.classList.toggle(
      "active",
      element.id === screen
    );
  });

  $$(".nav-button").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.screen === screen
    );
  });

  if (tg?.BackButton) {
    if (screen !== "dashboard") {
      tg.BackButton.show();
    } else {
      tg.BackButton.hide();
    }
  }

  if (screen === "messages") {
    loadMessages();
  }

  if (screen === "watches") {
    loadWatches();
  }

  if (screen === "events") {
    loadEvents();
  }

  if (screen === "stats") {
    loadStats();
  }
}

function renderConnections() {
  const container = $("#connections");

  if (!container) return;

  if (!state.connections.length) {
    container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🔗</div>
        <b>Нет Business Connection</b>
        <p>
          Подключите бота к Telegram Business,
          затем откройте STMA снова.
        </p>
      </div>
    `;

    state.connection = null;
    return;
  }

  container.innerHTML =
    state.connections
      .map(
        (connection) => `
          <button
            class="connection-card ${
              state.connection?.id === connection.id
                ? "selected"
                : ""
            }"
            data-connection="${escapeHtml(
              connection.id
            )}"
            type="button"
          >
            <div class="connection-icon">
              ${
                connection.is_enabled
                  ? "●"
                  : "○"
              }
            </div>

            <div class="connection-content">
              <strong>
                ${
                  escapeHtml(
                    connection.username
                      ? `@${connection.username}`
                      : connection.first_name ||
                        "Business"
                  )
                }
              </strong>

              <span>
                ${
                  connection.is_enabled
                    ? "Подключено"
                    : "Отключено"
                }
              </span>
            </div>

            <div class="arrow">
              ›
            </div>
          </button>
        `
      )
      .join("");

  $$(".connection-card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.dataset.connection;

      state.connection =
        state.connections.find(
          (item) =>
            String(item.id) === String(id)
        ) || null;

      renderConnections();

      showToast(
        "Business Connection выбрано"
      );
    });
  });
}

async function loadConnections() {
  const data =
    await api("/api/connections");

  state.connections =
    Array.isArray(data.connections)
      ? data.connections
      : [];

  if (state.connection) {
    state.connection =
      state.connections.find(
        (connection) =>
          String(connection.id) ===
          String(state.connection.id)
      ) || null;
  }

  if (
    !state.connection &&
    state.connections.length
  ) {
    state.connection =
      state.connections[0];
  }

  renderConnections();
}

async function loadMessages() {
  const container =
    $("#messageHistory");

  if (!container) return;

  if (!state.connection) {
    container.innerHTML = `
      <div class="empty">
        Сначала выберите Business Connection.
      </div>
    `;

    return;
  }

  const selected =
    $("#selectedConnectionMessage");

  if (selected) {
    selected.textContent =
      state.connection.username
        ? `@${state.connection.username}`
        : state.connection.first_name ||
          state.connection.id;
  }

  try {
    const data =
      await api(
        `/api/connections/${encodeURIComponent(
          state.connection.id
        )}/messages?limit=100`
      );

    const messages =
      data.messages || [];

    if (!messages.length) {
      container.innerHTML = `
        <div class="empty">
          История пока пустая.
        </div>
      `;

      return;
    }

    container.innerHTML =
      messages
        .map((message) => {
          const date =
            message.message_date
              ? new Date(
                  Number(
                    message.message_date
                  ) * 1000
                ).toLocaleString("ru-RU")
              : "";

          return `
            <div class="message-card">
              <div class="message-top">
                <strong>
                  ${
                    escapeHtml(
                      message.sender_username
                        ? `@${message.sender_username}`
                        : message.sender_name ||
                          "Telegram"
                    )
                  }
                </strong>

                <span>
                  ${escapeHtml(date)}
                </span>
              </div>

              <div class="message-text">
                ${
                  escapeHtml(
                    message.text ||
                      message.caption ||
                      "[медиа]"
                  )
                }
              </div>

              <div class="message-bottom">
                <span>
                  chat:
                  ${escapeHtml(
                    message.chat_id
                  )}
                </span>

                <span>
                  #${escapeHtml(
                    message.message_id
                  )}
                </span>

                ${
                  message.deleted
                    ? `
                      <span class="danger-text">
                        удалено
                      </span>
                    `
                    : ""
                }
              </div>
            </div>
          `;
        })
        .join("");
  } catch (error) {
    container.innerHTML = `
      <div class="empty">
        Не удалось загрузить историю.
      </div>
    `;

    showToast(
      error.message,
      true
    );
  }
}

async function sendMessage() {
  if (!state.connection) {
    showToast(
      "Выберите Business Connection",
      true
    );

    return;
  }

  const chatElement = $("#chatId");
  const textElement = $("#messageText");
  const deleteElement = $("#deleteAfter");

  const chatId =
    chatElement?.value.trim() || "";

  const text =
    textElement?.value.trim() || "";

  const deleteAfter =
    Number(
      deleteElement?.value || 0
    ) || 0;

  if (!chatId || !text) {
    showToast(
      "Заполните Chat ID и сообщение",
      true
    );

    return;
  }

  const button =
    $("#sendMessageButton");

  if (button) {
    button.disabled = true;
  }

  try {
    await api(
      `/api/connections/${encodeURIComponent(
        state.connection.id
      )}/messages`,
      {
        method: "POST",
        body: {
          chatId,
          text,
          deleteAfter
        }
      }
    );

    if (textElement) {
      textElement.value = "";
    }

    showToast(
      "Сообщение отправлено"
    );

    await loadMessages();
  } catch (error) {
    showToast(
      error.message,
      true
    );
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function executeCommand() {
  if (!state.connection) {
    showToast(
      "Выберите Business Connection",
      true
    );

    return;
  }

  const commandElement =
    $("#commandInput");

  const chatElement =
    $("#commandChatId");

  const command =
    commandElement?.value.trim() || "";

  const chatId =
    chatElement?.value.trim() || "";

  if (!command) {
    showToast(
      "Введите команду",
      true
    );

    return;
  }

  const button =
    $("#executeCommandButton");

  if (button) {
    button.disabled = true;
  }

  try {
    const data =
      await api(
        `/api/connections/${encodeURIComponent(
          state.connection.id
        )}/command`,
        {
          method: "POST",
          body: {
            command,
            chatId
          }
        }
      );

    const result =
      $("#commandResult");

    if (result) {
      result.classList.remove("hidden");

      result.innerHTML = `
        <div class="success-icon">✓</div>
        <div>
          ${escapeHtml(
            data.result ||
              "Команда выполнена"
          )}
        </div>
      `;
    }

    if (commandElement) {
      commandElement.value = "";
    }
  } catch (error) {
    const result =
      $("#commandResult");

    if (result) {
      result.classList.remove("hidden");

      result.innerHTML = `
        <div class="danger-text">
          ${escapeHtml(
            error.message
          )}
        </div>
      `;
    }
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function loadWatches() {
  const container =
    $("#watchList");

  if (!container) return;

  if (!state.connection) {
    container.innerHTML = `
      <div class="empty">
        Выберите Business Connection.
      </div>
    `;

    return;
  }

  try {
    const data =
      await api(
        `/api/connections/${encodeURIComponent(
          state.connection.id
        )}/watches`
      );

    const watches =
      data.watches || [];

    if (!watches.length) {
      container.innerHTML = `
        <div class="empty">
          Активных слежений нет.
        </div>
      `;

      return;
    }

    container.innerHTML =
      watches
        .map(
          (watch) => `
            <div class="watch-card">
              <div>
                <strong>
                  ${escapeHtml(
                    watch.username
                  )}
                </strong>

                <span>
                  активно
                </span>
              </div>

              <button
                class="danger-button"
                data-remove-watch="${escapeHtml(
                  watch.username
                )}"
                type="button"
              >
                Удалить
              </button>
            </div>
          `
        )
        .join("");

    $$("[data-remove-watch]").forEach(
      (button) => {
        button.addEventListener(
          "click",
          async () => {
            const username =
              button.dataset.removeWatch;

            try {
              await api(
                `/api/connections/${encodeURIComponent(
                  state.connection.id
                )}/watches/${encodeURIComponent(
                  username
                )}`,
                {
                  method: "DELETE"
                }
              );

              showToast(
                "Слежение удалено"
              );

              await loadWatches();
            } catch (error) {
              showToast(
                error.message,
                true
              );
            }
          }
        );
      }
    );
  } catch (error) {
    showToast(
      error.message,
      true
    );
  }
}

async function addWatch() {
  if (!state.connection) {
    showToast(
      "Выберите Business Connection",
      true
    );

    return;
  }

  const element =
    $("#watchUsername");

  const username =
    element?.value.trim() || "";

  if (!username) {
    showToast(
      "Введите username",
      true
    );

    return;
  }

  try {
    await api(
      `/api/connections/${encodeURIComponent(
        state.connection.id
      )}/watches`,
      {
        method: "POST",
        body: {
          username
        }
      }
    );

    if (element) {
      element.value = "";
    }

    showToast(
      "Слежение включено"
    );

    await loadWatches();
  } catch (error) {
    showToast(
      error.message,
      true
    );
  }
}

async function loadEvents() {
  const container =
    $("#eventList");

  if (!container) return;

  if (!state.connection) {
    container.innerHTML = `
      <div class="empty">
        Выберите Business Connection.
      </div>
    `;

    return;
  }

  try {
    const data =
      await api(
        `/api/connections/${encodeURIComponent(
          state.connection.id
        )}/events?limit=100`
      );

    const events =
      data.events || [];

    if (!events.length) {
      container.innerHTML = `
        <div class="empty">
          Событий пока нет.
        </div>
      `;

      return;
    }

    container.innerHTML =
      events
        .map(
          (event) => `
            <div class="event-card">
              <div>
                <strong>
                  ${escapeHtml(
                    event.type
                  )}
                </strong>

                <span>
                  ${
                    new Date(
                      Number(
                        event.created_at
                      ) * 1000
                    ).toLocaleString(
                      "ru-RU"
                    )
                  }
                </span>
              </div>

              <div class="event-meta">
                ${
                  event.username
                    ? `@${escapeHtml(
                        event.username
                      )}`
                    : ""
                }

                ${
                  event.chat_id
                    ? ` · chat ${escapeHtml(
                        event.chat_id
                      )}`
                    : ""
                }
              </div>
            </div>
          `
        )
        .join("");
  } catch (error) {
    showToast(
      error.message,
      true
    );
  }
}

async function loadStats() {
  const container =
    $("#statsGrid");

  if (!container) return;

  if (!state.connection) {
    container.innerHTML = `
      <div class="empty">
        Выберите Business Connection.
      </div>
    `;

    return;
  }

  try {
    const data =
      await api(
        `/api/connections/${encodeURIComponent(
          state.connection.id
        )}/stats`
      );

    const stats =
      data.stats || {};

    const cards = [
      ["Сообщения", stats.messages],
      ["Отправлено", stats.sent],
      ["Удалено", stats.deleted],
      ["События", stats.events],
      ["Слежения", stats.watches],
      ["Команды", stats.commands],
      ["Connections", stats.connections]
    ];

    container.innerHTML =
      cards
        .map(
          ([title, value]) => `
            <div class="stat-card">
              <span>
                ${escapeHtml(title)}
              </span>

              <strong>
                ${Number(value || 0)}
              </strong>
            </div>
          `
        )
        .join("");
  } catch (error) {
    showToast(
      error.message,
      true
    );
  }
}

/*
 * Инициализация Mini App
 */
async function init() {
  const loading =
    $("#loading");

  /*
   * STMA должен открываться именно
   * внутри Telegram.
   */
  if (!tg) {
    if (loading) {
      loading.innerHTML = `
        <div>
          <b>STMA</b>
          <p>
            Откройте STMA внутри Telegram Mini App.
          </p>
        </div>
      `;
    }

    return;
  }

  try {
    /*
     * Сообщаем Telegram,
     * что Mini App готов.
     */
    tg.ready();

    /*
     * Раскрываем Mini App
     * на весь доступный экран.
     */
    if (
      typeof tg.expand === "function"
    ) {
      tg.expand();
    }

    /*
     * Получаем ОРИГИНАЛЬНЫЙ
     * Telegram initData.
     */
    state.initData =
      getTelegramInitData();

    console.log(
      "[STMA] Telegram WebApp:",
      tg.version
    );

    console.log(
      "[STMA] initData received:",
      Boolean(state.initData)
    );

    /*
     * Без initData сервер не сможет
     * проверить пользователя.
     */
    if (!state.initData) {
      if (loading) {
        loading.innerHTML = `
          <div>
            <b>Ошибка Telegram</b>
            <p>
              Telegram не передал данные авторизации.
            </p>

            <small>
              Закройте Mini App и откройте его
              заново через кнопку бота.
            </small>
          </div>
        `;
      }

      return;
    }

    /*
     * Авторизация через backend.
     */
    const me =
      await api("/api/me");

    state.user =
      me.user || null;

    if (!state.user) {
      throw new Error(
        "Telegram user не получен"
      );
    }

    const userName =
      $("#userName");

    if (userName) {
      userName.textContent =
        state.user.username
          ? `@${state.user.username}`
          : state.user.first_name ||
            "Telegram Business Manager";
    }

    /*
     * Загружаем Business Connections.
     */
    await loadConnections();

    /*
     * Всё успешно.
     */
    state.initialized = true;

    if (loading) {
      loading.classList.add("hidden");
    }

    const application =
      $("#app");

    if (application) {
      application.classList.remove(
        "hidden"
      );
    }

    /*
     * Telegram Back Button.
     */
    if (tg.BackButton) {
      tg.BackButton.onClick(() => {
        if (
          state.screen !==
          "dashboard"
        ) {
          setScreen("dashboard");
        } else {
          tg.close();
        }
      });

      tg.BackButton.hide();
    }

    /*
     * Main button можно использовать
     * дальше для действий STMA.
     */
    if (
      tg.MainButton &&
      typeof tg.MainButton.hide ===
        "function"
    ) {
      tg.MainButton.hide();
    }

    console.log(
      "[STMA] Mini App initialized successfully"
    );
  } catch (error) {
    console.error(
      "[STMA] Initialization error:",
      error
    );

    if (loading) {
      loading.innerHTML = `
        <div>
          <b>STMA не запустился</b>

          <p>
            ${escapeHtml(
              error.message
            )}
          </p>

          <small>
            Закройте Mini App и откройте его
            заново через Telegram.
          </small>
        </div>
      `;
    }
  }
}

/*
 * Navigation
 */
$$(".nav-button").forEach(
  (button) => {
    button.addEventListener(
      "click",
      () => {
        if (!state.initialized) {
          return;
        }

        setScreen(
          button.dataset.screen
        );
      }
    );
  }
);

/*
 * Refresh
 */
$("#refreshButton")
  ?.addEventListener(
    "click",
    async () => {
      if (!state.initialized) {
        return;
      }

      try {
        await loadConnections();

        if (
          state.screen ===
          "messages"
        ) {
          await loadMessages();
        }

        if (
          state.screen ===
          "watches"
        ) {
          await loadWatches();
        }

        if (
          state.screen ===
          "events"
        ) {
          await loadEvents();
        }

        if (
          state.screen ===
          "stats"
        ) {
          await loadStats();
        }

        showToast(
          "Обновлено"
        );
      } catch (error) {
        showToast(
          error.message,
          true
        );
      }
    }
  );

/*
 * Send message
 */
$("#sendMessageButton")
  ?.addEventListener(
    "click",
    sendMessage
  );

/*
 * AI command
 */
$("#executeCommandButton")
  ?.addEventListener(
    "click",
    executeCommand
  );

/*
 * Watch
 */
$("#addWatchButton")
  ?.addEventListener(
    "click",
    addWatch
  );

/*
 * Enter для отправки команды
 */
$("#commandInput")
  ?.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey
      ) {
        event.preventDefault();

        executeCommand();
      }
    }
  );

/*
 * Запускаем приложение.
 */
init();