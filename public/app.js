const tg = window.Telegram?.WebApp;

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

function showToast(message, error = false) {

  const toast = $("#toast");

  if (!toast) return;

  toast.textContent = message;

  toast.classList.remove("hidden");

  toast.classList.toggle(
    "error",
    error
  );

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {

    toast.classList.add("hidden");

  }, 3000);
}


/* =========================================================
   HTML ESCAPE
========================================================= */

function escapeHtml(value) {

  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


/* =========================================================
   API
========================================================= */

async function api(url, options = {}) {

  const headers = {
    ...(options.headers || {})
  };

  /*
   * ВАЖНО:
   *
   * Telegram initData передаётся именно так.
   *
   * Сервер должен читать:
   * X-Telegram-Init-Data
   */

  headers["X-Telegram-Init-Data"] =
    state.initData;


  let body = options.body;

  if (
    body &&
    typeof body !== "string"
  ) {

    headers["Content-Type"] =
      "application/json";

    body = JSON.stringify(body);
  }


  const response = await fetch(url, {
    ...options,
    body,
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


  if (
    !response.ok ||
    data.ok === false
  ) {

    throw new Error(
      data.error ||
      data.message ||
      `Request failed (${response.status})`
    );
  }


  return data;
}


/* =========================================================
   SCREEN
========================================================= */

function setScreen(screen) {

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
        button.dataset.screen === screen
      );

    }
  );


  if (
    tg &&
    tg.BackButton
  ) {

    if (screen === "dashboard") {

      tg.BackButton.hide();

    } else {

      tg.BackButton.show();

    }
  }


  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });


  if (screen === "messages") {
    loadMessages();
  }

  if (screen === "commands") {
    clearCommandResult();
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


/* =========================================================
   CONNECTIONS
========================================================= */

function renderConnections() {

  const container =
    $("#connections");

  if (!container) return;


  if (!state.connections.length) {

    container.innerHTML = `
      <div class="empty">

        <div class="empty-icon">
          🔗
        </div>

        <b>
          Нет Business Connection
        </b>

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
      .map((connection) => {

        const selected =
          state.connection?.id ===
          connection.id;


        const title =
          connection.username
            ? `@${connection.username}`
            : connection.first_name ||
              "Business";


        return `
          <button
            class="connection-card ${
              selected ? "selected" : ""
            }"
            data-connection="${escapeHtml(
              connection.id
            )}"
            type="button"
          >

            <div class="connection-icon">
              ${connection.is_enabled ? "●" : "○"}
            </div>

            <div class="connection-content">

              <strong>
                ${escapeHtml(title)}
              </strong>

              <span>
                ${
                  connection.is_enabled
                    ? "Подключено и активно"
                    : "Отключено"
                }
              </span>

            </div>

            <div class="arrow">
              ›
            </div>

          </button>
        `;
      })
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
                String(item.id) ===
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
    await api("/api/connections");


  state.connections =
    data.connections || [];


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


/* =========================================================
   MESSAGES
========================================================= */

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


  const title =
    state.connection.username
      ? `@${state.connection.username}`
      : state.connection.first_name ||
        state.connection.id;


  $("#selectedConnectionMessage")
    .textContent = title;


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
      messages.map((message) => {

        const date =
          message.message_date
            ? new Date(
                Number(
                  message.message_date
                ) * 1000
              ).toLocaleString("ru-RU")
            : "";


        const sender =
          message.sender_username
            ? `@${message.sender_username}`
            : message.sender_name ||
              "Telegram";


        const content =
          message.text ||
          message.caption ||
          "[медиа]";


        return `
          <div class="message-card">

            <div class="message-top">

              <strong>
                ${escapeHtml(sender)}
              </strong>

              <span>
                ${escapeHtml(date)}
              </span>

            </div>

            <div class="message-text">
              ${escapeHtml(content)}
            </div>

            <div class="message-bottom">

              <span>
                chat:
                ${escapeHtml(message.chat_id)}
              </span>

              <span>
                #${escapeHtml(message.message_id)}
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

      }).join("");


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

  if (!state.connection) {

    showToast(
      "Выберите Business Connection",
      true
    );

    return;
  }


  const chatId =
    $("#chatId")
      ?.value
      .trim();


  const text =
    $("#messageText")
      ?.value
      .trim();


  const deleteAfter =
    Number(
      $("#deleteAfter")
        ?.value
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


    $("#messageText").value = "";


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


/* =========================================================
   COMMANDS
========================================================= */

function clearCommandResult() {

  const result =
    $("#commandResult");

  if (!result) return;

  result.classList.add("hidden");

  result.innerHTML = "";
}


async function executeCommand() {

  if (!state.connection) {

    showToast(
      "Выберите Business Connection",
      true
    );

    return;
  }


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
      "Введите команду",
      true
    );

    return;
  }


  const button =
    $("#executeCommandButton");


  const result =
    $("#commandResult");


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


    $("#commandInput").value = "";


    showToast(
      "Команда выполнена"
    );


  } catch (error) {

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


/* =========================================================
   WATCHES
========================================================= */

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

          <div class="empty-icon">
            👁
          </div>

          <b>
            Слежений пока нет
          </b>

          <p>
            Добавьте username выше.
          </p>

        </div>
      `;

      return;
    }


    container.innerHTML =
      watches.map((watch) => `

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

      `).join("");


    $$("[data-remove-watch]")
      .forEach((button) => {

        button.addEventListener(
          "click",
          async () => {

            const username =
              button.dataset.removeWatch;


            button.disabled = true;


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

              button.disabled = false;

              showToast(
                error.message,
                true
              );
            }

          }
        );

      });


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


  const input =
    $("#watchUsername");


  const username =
    input.value.trim();


  if (!username) {

    showToast(
      "Введите username",
      true
    );

    return;
  }


  const button =
    $("#addWatchButton");


  button.disabled = true;


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


    input.value = "";


    showToast(
      "Слежение включено"
    );


    await loadWatches();


  } catch (error) {

    showToast(
      error.message,
      true
    );

  } finally {

    button.disabled = false;

  }
}


/* =========================================================
   EVENTS
========================================================= */

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

          <div class="empty-icon">
            📡
          </div>

          <b>
            Событий пока нет
          </b>

          <p>
            Активность появится здесь автоматически.
          </p>

        </div>
      `;

      return;
    }


    container.innerHTML =
      events.map((event) => {

        const created =
          Number(event.created_at);


        const date =
          created
            ? new Date(
                created * 1000
              ).toLocaleString("ru-RU")
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
                ${escapeHtml(date)}
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

      }).join("");


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
      cards.map(
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
      ).join("");


  } catch (error) {

    showToast(
      error.message,
      true
    );
  }
}


/* =========================================================
   NAVIGATION
========================================================= */

function setupNavigation() {

  $$(".nav-button")
    .forEach((button) => {

      button.addEventListener(
        "click",
        () => {

          setScreen(
            button.dataset.screen
          );

        }
      );

    });


  $$(".quick-card")
    .forEach((button) => {

      button.addEventListener(
        "click",
        () => {

          setScreen(
            button.dataset.screen
          );

        }
      );

    });


  $$(".back-local")
    .forEach((button) => {

      button.addEventListener(
        "click",
        () => {

          setScreen(
            button.dataset.screen ||
            "dashboard"
          );

        }
      );

    });


  $$("[data-command]")
    .forEach((button) => {

      button.addEventListener(
        "click",
        () => {

          $("#commandInput").value =
            button.dataset.command;

          $("#commandInput").focus();

        }
      );

    });

}


/* =========================================================
   REFRESH
========================================================= */

function setupRefresh() {

  $("#refreshButton")
    ?.addEventListener(
      "click",
      async () => {

        const button =
          $("#refreshButton");


        button.disabled = true;


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

        } finally {

          button.disabled = false;

        }

      }
    );

}


/* =========================================================
   TELEGRAM
========================================================= */

function setupTelegram() {

  if (!tg) return;


  try {

    tg.ready();

    tg.expand();


    if (
      typeof tg.setHeaderColor ===
      "function"
    ) {

      tg.setHeaderColor(
        "#070a10"
      );
    }


    if (
      typeof tg.setBackgroundColor ===
      "function"
    ) {

      tg.setBackgroundColor(
        "#070a10"
      );
    }


    if (tg.BackButton) {

      tg.BackButton.onClick(
        () => {

          if (
            state.screen !==
            "dashboard"
          ) {

            setScreen(
              "dashboard"
            );

          }

        }
      );

    }

  } catch (error) {

    console.warn(
      "Telegram WebApp setup error:",
      error
    );

  }
}


/* =========================================================
   INIT
========================================================= */

async function init() {

  const loading =
    $("#loading");


  const app =
    $("#app");


  /*
   * Если открыть index.html обычным браузером,
   * Telegram WebApp объекта не будет.
   */

  if (!tg) {

    loading.innerHTML = `
      <div>

        <div class="loading-logo">
          <div class="logo-mark">
            S
          </div>
        </div>

        <div class="loading-title">
          STMA
        </div>

        <div class="loading-subtitle">
          Откройте приложение через Telegram
        </div>

      </div>
    `;

    return;
  }


  setupTelegram();


  /*
   * Берём оригинальный initData.
   *
   * НЕ JSON.stringify().
   * НЕ tg.initDataUnsafe.
   *
   * Сервер проверяет именно эту строку.
   */

  state.initData =
    tg.initData || "";


  if (!state.initData) {

    loading.innerHTML = `
      <div>

        <div class="loading-title">
          Ошибка авторизации
        </div>

        <div class="loading-subtitle">
          Telegram не передал initData.
          Закройте Mini App и откройте его
          снова через Telegram.
        </div>

      </div>
    `;

    return;
  }


  try {

    /*
     * Проверяем авторизацию.
     */

    const me =
      await api("/api/me");


    state.user =
      me.user;


    if (state.user) {

      $("#userName")
        .textContent =
          state.user.username
            ? `@${state.user.username}`
            : state.user.first_name ||
              "Telegram User";
    }


    /*
     * Загружаем Business Connections.
     */

    await loadConnections();


    /*
     * Показываем приложение.
     */

    loading.classList.add(
      "hidden"
    );

    app.classList.remove(
      "hidden"
    );


    setScreen(
      "dashboard"
    );


  } catch (error) {

    console.error(
      "STMA initialization error:",
      error
    );


    loading.innerHTML = `
      <div>

        <div class="loading-logo">
          <div class="logo-mark">
            S
          </div>
        </div>

        <div class="loading-title">
          STMA не запустился
        </div>

        <div class="loading-subtitle">
          ${escapeHtml(
            error.message
          )}
        </div>

        <button
          id="reloadButton"
          class="primary-button"
          type="button"
          style="margin-top:22px;width:240px"
        >
          Открыть заново
        </button>

      </div>
    `;


    $("#reloadButton")
      ?.addEventListener(
        "click",
        () => {

          try {

            if (
              tg &&
              typeof tg.close ===
              "function"
            ) {

              tg.close();

            }

          } catch {}

          location.reload();

        }
      );

  }
}


/* =========================================================
   EVENTS
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


setupNavigation();

setupRefresh();


/* =========================================================
   START
========================================================= */

init();