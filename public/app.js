"use strict";

/*
==================================================
STMA — MINI APP
BLACK / NEON PURPLE
FULL FRONTEND FOR CURRENT index.html
==================================================
*/

const tg = window.Telegram?.WebApp || null;

const state = {
  user: null,
  connected: false,
  connection: null,

  stats: {
    messages: 0,
    edits: 0,
    deleted: 0,
    events: 0,
    mutes: 0,
    watches: 0
  },

  watches: [],
  mutes: [],
  history: [],
  events: []
};

/*
==================================================
TELEGRAM
==================================================
*/

if (tg) {
  try {
    tg.ready();
    tg.expand();

    if (tg.setHeaderColor) {
      tg.setHeaderColor("#07070a");
    }

    if (tg.setBackgroundColor) {
      tg.setBackgroundColor("#07070a");
    }

    if (tg.enableClosingConfirmation) {
      tg.enableClosingConfirmation();
    }
  } catch (error) {
    console.warn("Telegram WebApp:", error);
  }
}

/*
==================================================
HELPERS
==================================================
*/

const $ = selector =>
  document.querySelector(selector);

const $$ = selector =>
  [...document.querySelectorAll(selector)];

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(timestamp) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/*
==================================================
TOAST
==================================================
*/

let toastTimer = null;

function showToast(message) {
  const toast = $("#toast");

  if (!toast) {
    console.log(message);
    return;
  }

  toast.textContent = String(message);
  toast.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}

/*
==================================================
API
==================================================
*/

async function api(url, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  /*
  Telegram Mini App authentication.
  */

  if (tg?.initData) {
    headers["X-Telegram-Init-Data"] =
      tg.initData;
  }

  let body = options.body;

  if (
    body &&
    typeof body !== "string"
  ) {
    headers["Content-Type"] =
      "application/json";

    body = JSON.stringify(body);
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(() => {
      controller.abort();
    }, 15000);

  let response;

  try {
    response = await fetch(url, {
      ...options,
      body,
      headers,
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeout);

    if (error.name === "AbortError") {
      throw new Error(
        "Сервер не отвечает. Проверь Render."
      );
    }

    throw new Error(
      "Не удалось подключиться к серверу."
    );
  }

  clearTimeout(timeout);

  let data = null;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Сервер вернул HTTP ${response.status}`
    );
  }

  if (
    !response.ok ||
    data?.ok === false
  ) {
    throw new Error(
      data?.error ||
      `HTTP ${response.status}`
    );
  }

  return data;
}

/*
==================================================
LOADING / ERROR
==================================================
*/

function showApp() {
  const loading = $("#loading");
  const app = $("#app");
  const errorScreen = $("#errorScreen");

  if (loading) {
    loading.style.display = "none";
  }

  if (errorScreen) {
    errorScreen.style.display = "none";
  }

  if (app) {
    app.style.display = "block";
  }
}

function showError(error) {
  console.error(
    "STMA FRONTEND ERROR:",
    error
  );

  const loading = $("#loading");
  const app = $("#app");
  const errorScreen = $("#errorScreen");
  const errorText = $("#errorText");

  if (loading) {
    loading.style.display = "none";
  }

  if (app) {
    app.style.display = "none";
  }

  if (errorText) {
    errorText.textContent =
      error?.message ||
      "Не удалось загрузить STMA.";
  }

  if (errorScreen) {
    errorScreen.style.display = "flex";
  }
}

/*
==================================================
USER / ME
==================================================
*/

async function loadMe() {
  try {
    const data =
      await api("/api/me");

    state.user =
      data.user || null;

    state.connected =
      Boolean(data.connected);

    state.connection =
      data.connection || null;

    state.stats =
      data.stats || state.stats;

    updateUserUI();
    updateStatsUI();
    updateConnectionUI();

    return data;
  } catch (error) {
    updateConnectionUI(false);
    throw error;
  }
}

function updateUserUI() {
  const user =
    state.user;

  if (!user) {
    return;
  }

  const firstName =
    user.first_name ||
    "Пользователь";

  const lastName =
    user.last_name || "";

  const fullName =
    `${firstName} ${lastName}`.trim();

  const username =
    user.username
      ? `@${user.username}`
      : `ID: ${user.id}`;

  const avatar =
    $("#avatar");

  if (avatar) {
    avatar.textContent =
      String(firstName)
        .charAt(0)
        .toUpperCase() || "S";
  }

  const userName =
    $("#userName");

  if (userName) {
    userName.textContent =
      fullName;
  }

  const usernameElement =
    $("#username");

  if (usernameElement) {
    usernameElement.textContent =
      username;
  }
}

function updateConnectionUI(
  forceOffline = null
) {
  const online =
    forceOffline === null
      ? state.connected
      : !forceOffline;

  const headerDot =
    $("#headerDot");

  const headerStatus =
    $("#headerStatus");

  const statusDot =
    $("#statusDot");

  const statusText =
    $("#statusText");

  const businessDot =
    $("#businessDot");

  const businessStatus =
    $("#businessStatus");

  if (headerDot) {
    headerDot.classList.toggle(
      "online",
      online
    );
  }

  if (headerStatus) {
    headerStatus.textContent =
      online
        ? "online"
        : "offline";
  }

  if (statusDot) {
    statusDot.classList.toggle(
      "online",
      online
    );

    statusDot.classList.toggle(
      "offline",
      !online
    );
  }

  if (statusText) {
    statusText.textContent =
      online
        ? "STMA подключён и готов к работе"
        : "Telegram Business не подключён";
  }

  if (businessDot) {
    businessDot.classList.toggle(
      "online",
      online
    );

    businessDot.classList.toggle(
      "offline",
      !online
    );
  }

  if (businessStatus) {
    if (!online) {
      businessStatus.textContent =
        "Не подключён";
      return;
    }

    const connection =
      state.connection;

    if (
      connection?.username
    ) {
      businessStatus.textContent =
        `Подключён @${connection.username}`;
    } else {
      businessStatus.textContent =
        "Подключён";
    }
  }
}

/*
==================================================
STATS
==================================================
*/

function updateStatsUI() {
  const stats =
    state.stats || {};

  const map = {
    "#statMessages":
      stats.messages || 0,

    "#statEdits":
      stats.edits || 0,

    "#statDeleted":
      stats.deleted || 0,

    "#statEvents":
      stats.events || 0,

    "#statMutes":
      stats.mutes || 0,

    "#statWatches":
      stats.watches || 0
  };

  for (
    const [selector, value]
    of Object.entries(map)
  ) {
    const element =
      $(selector);

    if (element) {
      element.textContent =
        String(value);
    }
  }
}

async function loadStats() {
  try {
    const data =
      await api("/api/stats");

    state.stats =
      data.stats || state.stats;

    updateStatsUI();
  } catch (error) {
    console.warn(
      "Stats:",
      error.message
    );
  }
}

/*
==================================================
NAVIGATION
==================================================
*/

function showPage(page) {
  $$(".page")
    .forEach(section => {
      section.classList.toggle(
        "active",
        section.id ===
          `page-${page}`
      );
    });

  $$(".nav-button")
    .forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.page === page
      );
    });

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

  /*
  Lazy-load section data.
  */

  if (page === "watch") {
    loadWatches();
  }

  if (page === "actions") {
    loadMutes();
  }

  if (page === "history") {
    loadHistory();
  }

  if (page === "events") {
    loadEvents();
  }
}

window.showPage =
  showPage;

/*
==================================================
WATCHES
==================================================
*/

async function loadWatches() {
  const container =
    $("#watchList");

  try {
    const data =
      await api("/api/watches");

    state.watches =
      data.watches || [];

    renderWatches();
  } catch (error) {
    if (container) {
      container.innerHTML = `
        <div class="empty">
          Не удалось загрузить слежку
        </div>
      `;
    }

    console.error(
      "WATCH LOAD:",
      error
    );
  }
}

function renderWatches() {
  const container =
    $("#watchList");

  if (!container) {
    return;
  }

  if (!state.watches.length) {
    container.innerHTML = `
      <div class="empty">
        Активных целей нет
      </div>
    `;

    return;
  }

  container.innerHTML =
    state.watches
      .map(watch => `
        <div class="list-item">

          <div class="list-main">

            <div>
              <div class="list-title">
                ${escapeHTML(
                  watch.target
                )}
              </div>

              <div class="list-meta">
                ${
                  watch.enabled
                    ? "Активна"
                    : "Отключена"
                }
              </div>
            </div>

            <button
              class="button danger"
              style="
                width:auto;
                margin:0;
                padding:8px 12px;
              "
              onclick="removeWatch('${escapeHTML(
                watch.id
              )}')"
            >
              Удалить
            </button>

          </div>

        </div>
      `)
      .join("");
}

async function addWatch() {
  const input =
    $("#watchTarget");

  const target =
    String(
      input?.value || ""
    ).trim();

  if (!target) {
    showToast(
      "Укажи username или Telegram ID"
    );
    return;
  }

  try {
    const data =
      await api(
        "/api/watches",
        {
          method: "POST",
          body: {
            target
          }
        }
      );

    if (input) {
      input.value = "";
    }

    showToast(
      data.message ||
      "Цель добавлена в слежку"
    );

    await loadWatches();
    await loadStats();
    await loadEvents();

  } catch (error) {
    showToast(
      error.message
    );
  }
}

window.addWatch =
  addWatch;

async function removeWatch(id) {
  try {
    await api(
      `/api/watches/${encodeURIComponent(id)}`,
      {
        method: "DELETE"
      }
    );

    showToast(
      "Слежка удалена"
    );

    await loadWatches();
    await loadStats();
    await loadEvents();

  } catch (error) {
    showToast(
      error.message
    );
  }
}

window.removeWatch =
  removeWatch;

/*
==================================================
MUTES
==================================================
*/

async function loadMutes() {
  const container =
    $("#muteList");

  try {
    const data =
      await api("/api/mutes");

    state.mutes =
      data.users || [];

    renderMutes();

  } catch (error) {
    if (container) {
      container.innerHTML = `
        <div class="empty">
          Не удалось загрузить муты
        </div>
      `;
    }

    console.error(
      "MUTE LOAD:",
      error
    );
  }
}

function renderMutes() {
  const container =
    $("#muteList");

  if (!container) {
    return;
  }

  if (!state.mutes.length) {
    container.innerHTML = `
      <div class="empty">
        Активных мутов нет
      </div>
    `;

    return;
  }

  container.innerHTML =
    state.mutes
      .map(mute => {

        let until =
          "Навсегда";

        if (mute.expires_at) {
          until =
            formatDate(
              Number(
                mute.expires_at
              ) * 1000
            );
        }

        return `
          <div class="list-item">

            <div class="list-main">

              <div>
                <div class="list-title">
                  ${escapeHTML(
                    mute.username ||
                    String(
                      mute.user_id
                    )
                  )}
                </div>

                <div class="list-meta">
                  ID: ${escapeHTML(
                    mute.user_id
                  )}
                  · до: ${escapeHTML(
                    until
                  )}
                </div>
              </div>

              <button
                class="button danger"
                style="
                  width:auto;
                  margin:0;
                  padding:8px 12px;
                "
                onclick="unmuteUser('${escapeHTML(
                  mute.user_id
                )}')"
              >
                Размутить
              </button>

            </div>

          </div>
        `;
      })
      .join("");
}

async function muteUser() {
  const userInput =
    $("#muteUser");

  const durationInput =
    $("#muteDuration");

  const userId =
    Number(
      String(
        userInput?.value || ""
      ).trim()
    );

  const duration =
    String(
      durationInput?.value ||
      "Навсегда"
    ).trim();

  if (
    !Number.isSafeInteger(userId) ||
    userId <= 0
  ) {
    showToast(
      "Некорректный Telegram ID"
    );

    return;
  }

  try {
    await api(
      "/api/mute",
      {
        method: "POST",
        body: {
          user_id: userId,
          duration
        }
      }
    );

    if (userInput) {
      userInput.value = "";
    }

    if (durationInput) {
      durationInput.value = "";
    }

    showToast(
      "Пользователь замьючен"
    );

    await loadMutes();
    await loadStats();
    await loadEvents();

  } catch (error) {
    showToast(
      error.message
    );
  }
}

window.muteUser =
  muteUser;

async function unmuteUser(userId = null) {
  let id = Number(userId);

  if (!id) {
    const input =
      $("#muteUser");

    id =
      Number(
        String(
          input?.value || ""
        ).trim()
      );
  }

  if (
    !Number.isSafeInteger(id) ||
    id <= 0
  ) {
    showToast(
      "Укажи Telegram ID"
    );

    return;
  }

  try {
    await api(
      "/api/unmute",
      {
        method: "POST",
        body: {
          user_id: id
        }
      }
    );

    showToast(
      "Мут снят"
    );

    await loadMutes();
    await loadStats();
    await loadEvents();

  } catch (error) {
    showToast(
      error.message
    );
  }
}

window.unmuteUser =
  unmuteUser;

/*
==================================================
AI
==================================================
*/

async function runAI() {
  const input =
    $("#aiPrompt");

  const result =
    $("#aiResult");

  const prompt =
    String(
      input?.value || ""
    ).trim();

  if (!prompt) {
    showToast(
      "Введите команду"
    );

    return;
  }

  if (result) {
    result.textContent =
      "Выполняю...";
  }

  try {
    const data =
      await api(
        "/api/ai",
        {
          method: "POST",
          body: {
            prompt
          }
        }
      );

    if (result) {
      result.textContent =
        data.reply ||
        "Готово";
    }

    if (input) {
      input.value = "";
    }

    showToast(
      "Команда выполнена"
    );

    await loadMe();
    await refreshData();

  } catch (error) {
    if (result) {
      result.textContent =
        `Ошибка: ${error.message}`;
    }

    showToast(
      error.message
    );
  }
}

window.runAI =
  runAI;

/*
==================================================
HISTORY
==================================================
*/

async function loadHistory() {
  const container =
    $("#historyList");

  try {
    const data =
      await api("/api/history");

    state.history =
      data.messages || [];

    renderHistory();

  } catch (error) {
    if (container) {
      container.innerHTML = `
        <div class="empty">
          Не удалось загрузить историю
        </div>
      `;
    }

    console.error(
      "HISTORY:",
      error
    );
  }
}

function renderHistory() {
  const container =
    $("#historyList");

  if (!container) {
    return;
  }

  if (!state.history.length) {
    container.innerHTML = `
      <div class="empty">
        История пока пуста
      </div>
    `;

    return;
  }

  container.innerHTML =
    state.history
      .map(message => {

        const text =
          message.text ||
          "[без текста]";

        const status = [];

        if (message.edited_at) {
          status.push(
            "изменено"
          );
        }

        if (message.deleted_at) {
          status.push(
            "удалено"
          );
        }

        return `
          <div class="list-item">

            <div class="list-main">

              <div>

                <div class="list-title">
                  ${escapeHTML(text)}
                </div>

                <div class="list-meta">
                  Chat:
                  ${escapeHTML(
                    message.chat_id
                  )}

                  · Message:
                  ${escapeHTML(
                    message.message_id
                  )}

                  ${
                    status.length
                      ? ` · ${status.join(
                          " · "
                        )}`
                      : ""
                  }
                </div>

              </div>

              ${
                message.deleted_at
                  ? `
                    <span class="badge red">
                      удалено
                    </span>
                  `
                  : message.edited_at
                    ? `
                      <span class="badge">
                        изменено
                      </span>
                    `
                    : ""
              }

            </div>

          </div>
        `;
      })
      .join("");
}

/*
==================================================
EVENTS
==================================================
*/

async function loadEvents() {
  const container =
    $("#eventList");

  try {
    const data =
      await api("/api/events");

    state.events =
      data.events || [];

    renderEvents();

  } catch (error) {
    if (container) {
      container.innerHTML = `
        <div class="empty">
          Не удалось загрузить события
        </div>
      `;
    }

    console.error(
      "EVENTS:",
      error
    );
  }
}

function eventTitle(event) {
  const titles = {
    mute:
      "Пользователь замьючен",

    unmute:
      "Мут снят",

    watch_add:
      "Добавлена слежка",

    watch_remove:
      "Слежка удалена",

    message:
      "Получено сообщение",

    message_edited:
      "Сообщение изменено",

    messages_deleted:
      "Сообщения удалены",

    muted_message_deleted:
      "Сообщение замьюченного пользователя удалено",

    mute_delete_error:
      "Ошибка удаления сообщения",

    send_message:
      "Сообщение отправлено"
  };

  return (
    titles[event.type] ||
    event.type ||
    "Событие"
  );
}

function renderEvents() {
  const container =
    $("#eventList");

  if (!container) {
    return;
  }

  if (!state.events.length) {
    container.innerHTML = `
      <div class="empty">
        Событий пока нет
      </div>
    `;

    return;
  }

  container.innerHTML =
    state.events
      .map(event => `
        <div class="list-item">

          <div class="list-main">

            <div>

              <div class="list-title">
                ${escapeHTML(
                  eventTitle(event)
                )}
              </div>

              <div class="list-meta">
                ${
                  event.chat_id
                    ? `Chat: ${escapeHTML(
                        event.chat_id
                      )}`
                    : ""
                }

                ${
                  event.message_id
                    ? ` · Message: ${escapeHTML(
                        event.message_id
                      )}`
                    : ""
                }

                ${
                  event.created_at
                    ? ` · ${formatDate(
                        Number(
                          event.created_at
                        ) * 1000
                      )}`
                    : ""
                }
              </div>

            </div>

            <span class="badge">
              STMA
            </span>

          </div>

        </div>
      `)
      .join("");
}

/*
==================================================
REFRESH
==================================================
*/

async function refreshData() {
  await Promise.allSettled([
    loadStats(),
    loadWatches(),
    loadMutes(),
    loadEvents()
  ]);
}

/*
==================================================
INITIALIZATION
==================================================
*/

async function init() {
  try {
    /*
    Сначала показываем интерфейс.
    Больше никакой вечной загрузки.
    */

    showApp();

    /*
    Сначала проверяем Telegram.
    */

    if (
      !tg ||
      !tg.initData
    ) {
      throw new Error(
        "STMA нужно открывать внутри Telegram Mini App."
      );
    }

    /*
    Загружаем пользователя.
    */

    await loadMe();

    /*
    Затем данные.
    Ошибка одного раздела
    не ломает весь интерфейс.
    */

    await refreshData();

    console.log(
      "STMA frontend ready"
    );

  } catch (error) {
    showError(error);
  }
}

/*
==================================================
GLOBAL FUNCTIONS
==================================================
*/

window.loadMe =
  loadMe;

window.loadWatches =
  loadWatches;

window.loadMutes =
  loadMutes;

window.loadHistory =
  loadHistory;

window.loadEvents =
  loadEvents;

window.loadStats =
  loadStats;

/*
==================================================
START
==================================================
*/

if (
  document.readyState ===
  "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    init,
    {
      once: true
    }
  );
} else {
  init();
}