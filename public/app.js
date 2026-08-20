const tg =
  window.Telegram?.WebApp;

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

function showToast(
  message,
  error = false
) {
  const toast = $("#toast");

  toast.textContent = message;
  toast.classList.remove("hidden");
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
      JSON.stringify(
        options.body
      );
  }

  const response =
    await fetch(
      url,
      {
        ...options,
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
    data.ok === false
  ) {
    throw new Error(
      data.error ||
      "Request failed"
    );
  }

  return data;
}

function setScreen(
  screen
) {
  state.screen = screen;

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
    typeof tg.BackButton !==
      "undefined"
  ) {
    if (
      screen !== "dashboard"
    ) {
      tg.BackButton.show();
    } else {
      tg.BackButton.hide();
    }
  }

  if (
    screen === "messages"
  ) {
    loadMessages();
  }

  if (
    screen === "watches"
  ) {
    loadWatches();
  }

  if (
    screen === "events"
  ) {
    loadEvents();
  }

  if (
    screen === "stats"
  ) {
    loadStats();
  }
}

function renderConnections() {
  const container =
    $("#connections");

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

    state.connection = null;

    return;
  }

  container.innerHTML =
    state.connections
      .map(
        (connection) => `
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
              ${connection.is_enabled
                ? "●"
                : "○"}
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
            card.dataset.connection;

          state.connection =
            state.connections.find(
              (item) =>
                item.id === id
            );

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
    data.connections || [];

  if (
    state.connection
  ) {
    state.connection =
      state.connections.find(
        (connection) =>
          connection.id ===
          state.connection.id
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

  $("#selectedConnectionMessage")
    .textContent =
      state.connection.username
        ? `@${state.connection.username}`
        : state.connection.first_name ||
          state.connection.id;

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
        .map(
          (message) => {
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
                      ? `<span class="danger-text">
                          удалено
                         </span>`
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

  const chatId =
    $("#chatId").value.trim();

  const text =
    $("#messageText").value.trim();

  const deleteAfter =
    Number(
      $("#deleteAfter").value
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

  button.disabled = true;

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

    $("#messageText")
      .value = "";

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
    button.disabled = false;
  }
}

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
      .value.trim();

  const chatId =
    $("#commandChatId")
      .value.trim();

  if (!command) {
    showToast(
      "Введите команду",
      true
    );

    return;
  }

  const button =
    $("#executeCommandButton");

  button.disabled = true;

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

    result.classList.remove(
      "hidden"
    );

    result.innerHTML = `
      <div class="success-icon">✓</div>
      <div>
        ${escapeHtml(
          data.result ||
          "Команда выполнена"
        )}
      </div>
    `;

    $("#commandInput")
      .value = "";
  } catch (error) {
    const result =
      $("#commandResult");

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
  } finally {
    button.disabled = false;
  }
}

async function loadWatches() {
  const container =
    $("#watchList");

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

    $$(
      "[data-remove-watch]"
    ).forEach(
      (button) => {
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
  if (
    !state.connection
  ) {
    showToast(
      "Выберите Business Connection",
      true
    );

    return;
  }

  const username =
    $("#watchUsername")
      .value.trim();

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

    $("#watchUsername")
      .value = "";

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

async function init() {
  if (!tg) {
    $("#loading")
      .innerHTML = `
        <div>
          <b>STMA</b>
          <p>
            Откройте STMA внутри Telegram Mini App.
          </p>
        </div>
      `;

    return;
  }

  tg.ready();
  tg.expand();

  state.initData =
    tg.initData || "";

  if (!state.initData) {
    $("#loading")
      .innerHTML = `
        <div>
          <b>Ошибка авторизации</b>
          <p>
            Mini App не передал initData.
          </p>
        </div>
      `;

    return;
  }

  try {
    const me =
      await api("/api/me");

    state.user =
      me.user;

    $("#userName")
      .textContent =
      state.user.username
        ? `@${state.user.username}`
        : state.user.first_name ||
          "Telegram Business Manager";

    await loadConnections();

    $("#loading")
      .classList.add(
        "hidden"
      );

    $("#app")
      .classList.remove(
        "hidden"
      );

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
  } catch (error) {
    $("#loading")
      .innerHTML = `
        <div>
          <b>STMA не запустился</b>
          <p>
            ${escapeHtml(
              error.message
            )}
          </p>
        </div>
      `;
  }
}

$$(".nav-button").forEach(
  (button) => {
    button.addEventListener(
      "click",
      () => {
        setScreen(
          button.dataset.screen
        );
      }
    );
  }
);

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

init();