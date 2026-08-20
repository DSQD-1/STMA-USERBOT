const tg =
  window.Telegram?.WebApp || null;

const state = {
  initData: "",
  user: null,
  connections: [],
  connection: null,
  screen: "dashboard"
};

const $ = (selector) =>
  document.querySelector(selector);

const $$ = (selector) =>
  [...document.querySelectorAll(selector)];

/* =========================================================
   TOAST
   ========================================================= */

function showToast(
  message,
  error = false
) {
  const toast =
    $("#toast");

  if (!toast) {
    return;
  }

  toast.textContent =
    message;

  toast.classList.remove(
    "hidden"
  );

  toast.classList.toggle(
    "error",
    error
  );

  clearTimeout(
    showToast.timer
  );

  showToast.timer =
    setTimeout(() => {
      toast.classList.add(
        "hidden"
      );
    }, 3000);
}

/* =========================================================
   HTML ESCAPE
   ========================================================= */

function escapeHtml(value) {
  return String(
    value ?? ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}

/* =========================================================
   API
   ========================================================= */

async function api(
  url,
  options = {}
) {
  const headers = {
    ...(options.headers || {})
  };

  /*
   * Передаём именно Telegram raw initData.
   */
  if (state.initData) {
    headers[
      "X-Telegram-Init-Data"
    ] =
      state.initData;
  }

  let body =
    options.body;

  if (
    body &&
    typeof body !== "string"
  ) {
    headers[
      "Content-Type"
    ] =
      "application/json";

    body =
      JSON.stringify(body);
  }

  const response =
    await fetch(
      url,
      {
        ...options,
        body,
        headers
      }
    );

  let data;

  try {
    data =
      await response.json();
  } catch {
    throw new Error(
      `Server returned ${response.status}`
    );
  }

  if (
    !response.ok ||
    data?.ok === false
  ) {
    throw new Error(
      data?.error ||
        `Request failed (${response.status})`
    );
  }

  return data;
}

/* =========================================================
   SCREEN
   ========================================================= */

function setScreen(
  screen
) {
  state.screen =
    screen;

  $$(".screen").forEach(
    (element) => {
      element.classList.toggle(
        "active",
        element.id === screen
      );
    }
  );

  $$(".nav-button").forEach(
    (button) => {
      button.classList.toggle(
        "active",
        button.dataset.screen ===
          screen
      );
    }
  );

  if (
    tg &&
    tg.BackButton
  ) {
    if (
      screen !==
      "dashboard"
    ) {
      tg.BackButton.show();
    } else {
      tg.BackButton.hide();
    }
  }

  if (
    screen ===
    "messages"
  ) {
    loadMessages();
  }

  if (
    screen ===
    "watches"
  ) {
    loadWatches();
  }

  if (
    screen ===
    "events"
  ) {
    loadEvents();
  }

  if (
    screen ===
    "stats"
  ) {
    loadStats();
  }
}

/* =========================================================
   CONNECTIONS
   ========================================================= */

function renderConnections() {
  const container =
    $("#connections");

  if (!container) {
    return;
  }

  if (
    !state.connections.length
  ) {
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

    state.connection =
      null;

    return;
  }

  container.innerHTML =
    state.connections
      .map(
        (
          connection
        ) => `
          <button
            class="connection-card ${
              state.connection?.id ===
              connection.id
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

  $$(".connection-card").forEach(
    (card) => {
      card.addEventListener(
        "click",
        () => {
          const id =
            card.dataset
              .connection;

          state.connection =
            state.connections.find(
              (
                item
              ) =>
                String(
                  item.id
                ) ===
                String(id)
            ) || null;

          renderConnections();

          showToast(
            "Business Connection выбрано"
          );
        }
      );
    }
  );
}

async function loadConnections() {
  const data =
    await api(
      "/api/connections"
    );

  state.connections =
    Array.isArray(
      data.connections
    )
      ? data.connections
      : [];

  if (
    state.connection
  ) {
    state.connection =
      state.connections.find(
        (
          connection
        ) =>
          String(
            connection.id
          ) ===
          String(
            state.connection.id
          )
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

/* =========================================================
   MESSAGES
   ========================================================= */

async function loadMessages() {
  const container =
    $("#messageHistory");

  if (!container) {
    return;
  }

  if (
    !state.connection
  ) {
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
      Array.isArray(
        data.messages
      )
        ? data.messages
        : [];

    if (
      !messages.length
    ) {
      container.innerHTML = `
        <div class="empty">
          История пока пустая.
        </div>
      `;

      return;
    }

    container.innerHTML =
      messages
        .map(
          (
            message
          ) => {
            const date =
              message.message_date
                ? new Date(
                    Number(
                      message.message_date
                    ) * 1000
                  ).toLocaleString(
                    "ru-RU"
                  )
                : "";

            return `
              <div class="message-card">

                <div class="message-top">

                  <strong>
                    ${escapeHtml(
                      message.sender_username
                        ? `@${message.sender_username}`
                        : message.sender_name ||
                          "Telegram"
                    )}
                  </strong>

                  <span>
                    ${escapeHtml(
                      date
                    )}
                  </span>

                </div>

                <div class="message-text">
                  ${escapeHtml(
                    message.text ||
                      message.caption ||
                      "[медиа]"
                  )}
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
          }
        )
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

/* =========================================================
   SEND MESSAGE
   ========================================================= */

async function sendMessage() {
  if (
    !state.connection
  ) {
    showToast(
      "Выберите Business Connection",
      true
    );

    return;
  }

  const chatInput =
    $("#chatId");

  const textInput =
    $("#messageText");

  const deleteInput =
    $("#deleteAfter");

  const chatId =
    chatInput?.value.trim() ||
    "";

  const text =
    textInput?.value.trim() ||
    "";

  const deleteAfter =
    Number(
      deleteInput?.value
    ) || 0;

  if (
    !chatId ||
    !text
  ) {
    showToast(
      "Заполните Chat ID и сообщение",
      true
    );

    return;
  }

  const button =
    $("#sendMessageButton");

  if (button) {
    button.disabled =
      true;
  }

  try {
    await api(
      `/api/connections/${encodeURIComponent(
        state.connection.id
      )}/messages`,
      {
        method:
          "POST",

        body: {
          chatId,
          text,
          deleteAfter
        }
      }
    );

    if (textInput) {
      textInput.value =
        "";
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
      button.disabled =
        false;
    }
  }
}

/* =========================================================
   COMMANDS
   ========================================================= */

async function executeCommand() {
  if (
    !state.connection
  ) {
    showToast(
      "Выберите Business Connection",
      true
    );

    return;
  }

  const command =
    $("#commandInput")
      ?.value.trim() ||
    "";

  const chatId =
    $("#commandChatId")
      ?.value.trim() ||
    "";

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
    button.disabled =
      true;
  }

  try {
    const data =
      await api(
        `/api/connections/${encodeURIComponent(
          state.connection.id
        )}/command`,
        {
          method:
            "POST",

          body: {
            command,
            chatId
          }
        }
      );

    const result =
      $("#commandResult");

    if (result) {
      result.classList.remove(
        "hidden"
      );

      result.innerHTML = `
        <div class="success-icon">
          ✓
        </div>

        <div>
          ${escapeHtml(
            data.result ||
              "Команда выполнена"
          )}
        </div>
      `;
    }

    const input =
      $("#commandInput");

    if (input) {
      input.value =
        "";
    }
  } catch (error) {
    const result =
      $("#commandResult");

    if (result) {
      result.classList.remove(
        "hidden"
      );

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
      button.disabled =
        false;
    }
  }
}

/* =========================================================
   WATCHES
   ========================================================= */

async function loadWatches() {
  const container =
    $("#watchList");

  if (!container) {
    return;
  }

  if (
    !state.connection
  ) {
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
      Array.isArray(
        data.watches
      )
        ? data.watches
        : [];

    if (
      !watches.length
    ) {
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
          (
            watch
          ) => `
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

    $$(
      "[data-remove-watch]"
    ).forEach(
      (
        button
      ) => {
        button.addEventListener(
          "click",
          async () => {
            const username =
              button.dataset
                .removeWatch;

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

              showToast(
                "Слежение удалено"
              );

              await loadWatches();
            } catch (
              error
            ) {
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
  if (
    !state.connection
  ) {
    showToast(
      "Выберите Business Connection",
      true
    );

    return;
  }

  const input =
    $("#watchUsername");

  const username =
    input?.value.trim() ||
    "";

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
        method:
          "POST",

        body: {
          username
        }
      }
    );

    if (input) {
      input.value =
        "";
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

/* =========================================================
   EVENTS
   ========================================================= */

async function loadEvents() {
  const container =
    $("#eventList");

  if (!container) {
    return;
  }

  if (
    !state.connection
  ) {
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
      Array.isArray(
        data.events
      )
        ? data.events
        : [];

    if (
      !events.length
    ) {
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
          (
            event
          ) => {
            const timestamp =
              Number(
                event.created_at
              );

            const date =
              Number.isFinite(
                timestamp
              )
                ? new Date(
                    timestamp * 1000
                  ).toLocaleString(
                    "ru-RU"
                  )
                : "";

            return `
              <div class="event-card">

                <div>

                  <strong>
                    ${escapeHtml(
                      event.type
                    )}
                  </strong>

                  <span>
                    ${escapeHtml(
                      date
                    )}
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
            `;
          }
        )
        .join("");
  } catch (error) {
    showToast(
      error.message,
      true
    );
  }
}

/* =========================================================
   STATS
   ========================================================= */

async function loadStats() {
  const container =
    $("#statsGrid");

  if (!container) {
    return;
  }

  if (
    !state.connection
  ) {
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
      [
        "Сообщения",
        stats.messages
      ],
      [
        "Отправлено",
        stats.sent
      ],
      [
        "Удалено",
        stats.deleted
      ],
      [
        "События",
        stats.events
      ],
      [
        "Слежения",
        stats.watches
      ],
      [
        "Команды",
        stats.commands
      ],
      [
        "Connections",
        stats.connections
      ]
    ];

    container.innerHTML =
      cards
        .map(
          (
            [title, value]
          ) => `
            <div class="stat-card">

              <span>
                ${escapeHtml(
                  title
                )}
              </span>

              <strong>
                ${Number(
                  value || 0
                )}
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

/* =========================================================
   INITIALIZATION
   ========================================================= */

async function init() {
  if (!tg) {
    const loading =
      $("#loading");

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
    tg.ready();
    tg.expand();

    /*
     * Telegram сам предоставляет
     * оригинальную initData строку.
     */
    state.initData =
      tg.initData || "";

    console.log(
      "[STMA] Telegram WebApp:",
      Boolean(tg)
    );

    console.log(
      "[STMA] initData:",
      Boolean(
        state.initData
      )
    );

    console.log(
      "[STMA] initData length:",
      state.initData.length
    );

    if (
      !state.initData
    ) {
      const loading =
        $("#loading");

      if (loading) {
        loading.innerHTML = `
          <div>

            <b>
              Telegram не передал авторизацию
            </b>

            <p>
              Откройте Mini App именно
              через Telegram.
            </p>

            <p>
              Не через обычный браузер.
            </p>

          </div>
        `;
      }

      return;
    }

    const me =
      await api(
        "/api/me"
      );

    if (
      !me ||
      !me.ok ||
      !me.user
    ) {
      throw new Error(
        me?.error ||
          "Не удалось получить пользователя Telegram"
      );
    }

    state.user =
      me.user;

    const userName =
      $("#userName");

    if (userName) {
      userName.textContent =
        state.user.username
          ? `@${state.user.username}`
          : state.user.first_name ||
            "Telegram Business Manager";
    }

    await loadConnections();

    const loading =
      $("#loading");

    const app =
      $("#app");

    if (loading) {
      loading.classList.add(
        "hidden"
      );
    }

    if (app) {
      app.classList.remove(
        "hidden"
      );
    }

    if (
      tg.BackButton
    ) {
      tg.BackButton.onClick(
        () => {
          setScreen(
            "dashboard"
          );
        }
      );
    }

    setScreen(
      "dashboard"
    );
  } catch (error) {
    console.error(
      "[STMA INIT ERROR]",
      error
    );

    const loading =
      $("#loading");

    if (loading) {
      loading.innerHTML = `
        <div>

          <b>
            STMA не запустился
          </b>

          <p>
            ${escapeHtml(
              error.message ||
                "Ошибка запуска"
            )}
          </p>

          <p>
            Закройте Mini App
            и откройте его заново
            через Telegram.
          </p>

        </div>
      `;
    }
  }
}

/* =========================================================
   NAVIGATION
   ========================================================= */

$$(
  ".nav-button"
).forEach(
  (
    button
  ) => {
    button.addEventListener(
      "click",
      () => {
        setScreen(
          button.dataset
            .screen
        );
      }
    );
  }
);

/* =========================================================
   REFRESH
   ========================================================= */

$("#refreshButton")
  ?.addEventListener(
    "click",
    async () => {
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

/* =========================================================
   BUTTONS
   ========================================================= */

$("#sendMessageButton")
  ?.addEventListener(
    "click",
    sendMessage
  );

$("#executeCommandButton")
  ?.addEventListener(
    "click",
    executeCommand
  );

$("#addWatchButton")
  ?.addEventListener(
    "click",
    addWatch
  );

/* =========================================================
   START
   ========================================================= */

init();