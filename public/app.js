"use strict";

/*
==================================================
STMA FRONTEND
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
    events: 0
  },

  watches: [],
  mutes: [],
  events: [],
  history: []
};


/*
==================================================
TELEGRAM WEB APP
==================================================
*/

if (tg) {
  try {
    tg.ready();
    tg.expand();

    if (tg.setHeaderColor) {
      tg.setHeaderColor("#090b10");
    }

    if (tg.setBackgroundColor) {
      tg.setBackgroundColor("#090b10");
    }
  } catch (error) {
    console.warn("Telegram WebApp init:", error);
  }
}


/*
==================================================
DOM
==================================================
*/

const $ = (selector) =>
  document.querySelector(selector);

const $$ = (selector) =>
  [...document.querySelectorAll(selector)];


/*
==================================================
API
==================================================
*/

async function api(
  url,
  options = {}
) {
  const headers = {
    ...(options.headers || {})
  };

  /*
    Telegram WebApp initData нужен серверу
    для проверки пользователя.
  */

  if (tg?.initData) {
    headers["X-Telegram-Init-Data"] =
      tg.initData;
  }

  if (
    options.body &&
    typeof options.body !== "string"
  ) {
    headers["Content-Type"] =
      "application/json";

    options.body =
      JSON.stringify(options.body);
  }

  const response =
    await fetch(url, {
      ...options,
      headers
    });

  let data;

  try {
    data =
      await response.json();
  } catch {
    throw new Error(
      `Сервер вернул HTTP ${response.status}`
    );
  }

  if (!response.ok || data.ok === false) {
    throw new Error(
      data.error ||
      `HTTP ${response.status}`
    );
  }

  return data;
}


/*
==================================================
TOAST
==================================================
*/

let toastTimer = null;

function showToast(message) {
  const toast =
    $("#toast");

  if (!toast) return;

  toast.textContent =
    String(message);

  toast.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer =
    setTimeout(() => {
      toast.classList.remove("show");
    }, 2800);
}


/*
==================================================
LOADING
==================================================
*/

function setButtonLoading(
  button,
  loading,
  text = null
) {
  if (!button) return;

  if (loading) {
    button.dataset.originalText =
      button.textContent;

    button.disabled = true;
    button.textContent =
      text || "Загрузка...";
  } else {
    button.disabled = false;

    button.textContent =
      button.dataset.originalText ||
      text ||
      button.textContent;
  }
}


/*
==================================================
ME
==================================================
*/

async function loadMe() {
  const data =
    await api("/api/me");

  state.user =
    data.user;

  state.connected =
    Boolean(data.connected);

  state.connection =
    data.connection;

  state.stats =
    data.stats || state.stats;

  updateUserUI();
  updateStatsUI();
}


function updateUserUI() {
  const user =
    state.user;

  if (!user) return;

  const greeting =
    $(".greeting");

  if (greeting) {
    const title =
      greeting.querySelector("h1");

    const subtitle =
      greeting.querySelector("p");

    if (title) {
      title.innerHTML =
        `Привет, ${
          escapeHTML(
            user.first_name ||
            "пользователь"
          )
        }`;
    }

    if (subtitle) {
      subtitle.textContent =
        state.connected
          ? "STMA подключён и готов к работе."
          : "Подключи Telegram Business, чтобы начать.";
    }
  }

  const brandStatus =
    $(".brand-status");

  if (brandStatus) {
    brandStatus.textContent =
      state.connected
        ? "Online"
        : "Не подключён";
  }
}


function updateStatsUI() {
  const stats =
    state.stats;

  const values = {
    messages:
      stats.messages ?? 0,

    edits:
      stats.edits ?? 0,

    deleted:
      stats.deleted ?? 0,

    events:
      stats.events ?? 0
  };

  const selectors = {
    messages:
      "#statMessages",

    edits:
      "#statEdits",

    deleted:
      "#statDeleted",

    events:
      "#statEvents"
  };

  for (
    const [key, selector]
    of Object.entries(selectors)
  ) {
    const element =
      $(selector);

    if (element) {
      element.textContent =
        values[key];
    }
  }
}


/*
==================================================
WATCHES
==================================================
*/

async function loadWatches() {
  const data =
    await api("/api/watches");

  state.watches =
    data.watches || [];

  updateWatchUI();
}


function updateWatchUI() {
  const count =
    $("#watchCount");

  if (count) {
    count.textContent =
      state.watches.filter(
        watch =>
          watch.enabled !== 0
      ).length;
  }

  renderWatches();
}


function renderWatches() {
  const container =
    $("#watchesList");

  if (!container) return;

  if (!state.watches.length) {
    container.innerHTML =
      `<div class="empty">
        Активных слежек пока нет
      </div>`;

    return;
  }

  container.innerHTML =
    state.watches
      .map(watch => `
        <div class="list-item">

          <div>
            <div class="list-title">
              ${escapeHTML(
                watch.target
              )}
            </div>

            <div class="list-subtitle">
              ${
                watch.enabled
                  ? "Активна"
                  : "Отключена"
              }
            </div>
          </div>

          <button
            class="icon-button"
            data-remove-watch="${watch.id}"
          >
            ×
          </button>

        </div>
      `)
      .join("");

  $$("[data-remove-watch]")
    .forEach(button => {
      button.addEventListener(
        "click",
        () =>
          removeWatch(
            button.dataset.removeWatch
          )
      );
    });
}


async function addWatch(target) {
  const value =
    String(target || "")
      .trim();

  if (!value) {
    showToast(
      "Укажи username или Telegram ID"
    );

    return;
  }

  try {
    await api(
      "/api/watches",
      {
        method: "POST",
        body: {
          target: value
        }
      }
    );

    showToast(
      "Цель добавлена в слежку"
    );

    await loadWatches();
    await loadEvents();

  } catch (error) {
    showToast(
      error.message
    );
  }
}


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
    await loadEvents();

  } catch (error) {
    showToast(
      error.message
    );
  }
}


/*
==================================================
MUTES
==================================================
*/

async function loadMutes() {
  const data =
    await api("/api/mutes");

  state.mutes =
    data.users || [];

  renderMutes();
}


function renderMutes() {
  const container =
    $("#mutesList");

  if (!container) return;

  if (!state.mutes.length) {
    container.innerHTML =
      `<div class="empty">
        Активных мутов нет
      </div>`;

    return;
  }

  container.innerHTML =
    state.mutes
      .map(mute => {
        const expires =
          mute.expires_at;

        let duration =
          "Навсегда";

        if (expires) {
          duration =
            formatDate(
              expires * 1000
            );
        }

        return `
          <div class="list-item">

            <div>
              <div class="list-title">
                ${
                  escapeHTML(
                    mute.username ||
                    String(mute.user_id)
                  )
                }
              </div>

              <div class="list-subtitle">
                ID: ${mute.user_id}
                · до: ${duration}
              </div>
            </div>

            <button
              class="icon-button"
              data-unmute="${mute.user_id}"
            >
              ×
            </button>

          </div>
        `;
      })
      .join("");

  $$("[data-unmute]")
    .forEach(button => {
      button.addEventListener(
        "click",
        () =>
          unmute(
            button.dataset.unmute
          )
      );
    });
}


async function muteUser(
  userId,
  duration
) {
  const id =
    Number(userId);

  if (!Number.isInteger(id) || id <= 0) {
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
          user_id: id,
          duration:
            duration || "Навсегда"
        }
      }
    );

    showToast(
      "Пользователь замьючен"
    );

    await loadMutes();
    await loadEvents();

  } catch (error) {
    showToast(
      error.message
    );
  }
}


async function unmute(userId) {
  try {
    await api(
      "/api/unmute",
      {
        method: "POST",
        body: {
          user_id:
            Number(userId)
        }
      }
    );

    showToast(
      "Мут снят"
    );

    await loadMutes();
    await loadEvents();

  } catch (error) {
    showToast(
      error.message
    );
  }
}


/*
==================================================
AI
==================================================
*/

async function sendAI() {
  const input =
    $("#aiInput");

  const button =
    $("#aiSend");

  if (!input) return;

  const prompt =
    String(input.value || "")
      .trim();

  if (!prompt) {
    showToast(
      "Напиши команду"
    );

    return;
  }

  setButtonLoading(
    button,
    true,
    "..."
  );

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

    renderAIResult(
      prompt,
      data.reply ||
      "Готово"
    );

    input.value = "";

    await refreshData();

  } catch (error) {
    renderAIResult(
      prompt,
      `Ошибка: ${error.message}`
    );

    showToast(
      error.message
    );

  } finally {
    setButtonLoading(
      button,
      false,
      "→"
    );
  }
}


function renderAIResult(
  prompt,
  reply
) {
  const result =
    $("#aiResult");

  if (!result) return;

  result.classList.remove(
    "hidden"
  );

  result.innerHTML = `
    <div class="ai-message user">
      ${escapeHTML(prompt)}
    </div>

    <div class="ai-message bot">
      ${escapeHTML(reply)}
    </div>
  `;
}


/*
==================================================
SEND MESSAGE
==================================================
*/

async function sendMessage({
  chatId,
  text,
  deleteAfter = 0,
  oneTime = false
}) {
  const id =
    Number(chatId);

  const message =
    String(text || "")
      .trim();

  if (!Number.isInteger(id)) {
    showToast(
      "Некорректный chat ID"
    );

    return null;
  }

  if (!message) {
    showToast(
      "Введите текст сообщения"
    );

    return null;
  }

  try {
    const data =
      await api(
        "/api/send",
        {
          method: "POST",
          body: {
            chat_id: id,
            text: message,
            delete_after:
              Number(deleteAfter) || 0,
            one_time:
              Boolean(oneTime)
          }
        }
      );

    showToast(
      `Сообщение отправлено`
    );

    await refreshData();

    return data;

  } catch (error) {
    showToast(
      error.message
    );

    return null;
  }
}


/*
==================================================
HISTORY
==================================================
*/

async function loadHistory() {
  const data =
    await api("/api/history");

  state.history =
    data.messages || [];

  renderHistory();
}


function renderHistory() {
  const container =
    $("#historyList");

  if (!container) return;

  if (!state.history.length) {
    container.innerHTML =
      `<div class="empty">
        История пока пуста
      </div>`;

    return;
  }

  container.innerHTML =
    state.history
      .map(message => `
        <div class="list-item">

          <div>

            <div class="list-title">
              ${
                escapeHTML(
                  message.text ||
                  "[без текста]"
                )
              }
            </div>

            <div class="list-subtitle">
              Chat:
              ${message.chat_id}
              · Message:
              ${message.message_id}

              ${
                message.edited_at
                  ? " · изменено"
                  : ""
              }

              ${
                message.deleted_at
                  ? " · удалено"
                  : ""
              }
            </div>

          </div>

        </div>
      `)
      .join("");
}


/*
==================================================
EVENTS
==================================================
*/

async function loadEvents() {
  const data =
    await api("/api/events");

  state.events =
    data.events || [];

  renderEvents();
  renderActivity();
}


function eventTitle(event) {
  const types = {
    mute:
      "Пользователь замьючен",

    unmute:
      "Мут снят",

    watch_add:
      "Добавлена слежка",

    watch_remove:
      "Слежка удалена",

    send_message:
      "Отправлено сообщение"
  };

  return (
    types[event.type] ||
    event.type ||
    "Событие"
  );
}


function renderEvents() {
  const container =
    $("#eventsList");

  if (!container) return;

  if (!state.events.length) {
    container.innerHTML =
      `<div class="empty">
        Событий пока нет
      </div>`;

    return;
  }

  container.innerHTML =
    state.events
      .map(event => `
        <div class="event">

          <div>
            <strong>
              ${escapeHTML(
                eventTitle(event)
              )}
            </strong>
          </div>

          <small>
            ${formatDate(
              event.created_at * 1000
            )}
          </small>

        </div>
      `)
      .join("");
}


function renderActivity() {
  const container =
    $("#activity");

  if (!container) return;

  if (!state.events.length) {
    container.innerHTML =
      `<div class="empty">
        Пока действий нет
      </div>`;

    return;
  }

  container.innerHTML =
    state.events
      .slice(0, 5)
      .map(event => `
        <div class="event">

          <strong>
            ${escapeHTML(
              eventTitle(event)
            )}
          </strong>

          <small>
            ${formatDate(
              event.created_at * 1000
            )}
          </small>

        </div>
      `)
      .join("");
}


/*
==================================================
STATS
==================================================
*/

async function loadStats() {
  const data =
    await api("/api/stats");

  state.stats =
    data.stats || state.stats;

  updateStatsUI();
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
NAVIGATION
==================================================
*/

function setupNavigation() {
  $$("[data-page]")
    .forEach(button => {
      button.addEventListener(
        "click",
        () => {
          const page =
            button.dataset.page;

          $$(".nav-item")
            .forEach(item => {
              item.classList.toggle(
                "active",
                item === button
              );
            });

          navigatePage(page);
        }
      );
    });
}


function navigatePage(page) {
  switch (page) {

    case "watch":
      scrollToElement(
        "#watchSection"
      );
      break;

    case "actions":
      scrollToElement(
        "#actionsSection"
      );
      break;

    case "settings":
      scrollToElement(
        "#settingsSection"
      );
      break;

    case "home":
    default:
      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
      break;
  }
}


function scrollToElement(selector) {
  const element =
    $(selector);

  if (!element) {
    showToast(
      "Раздел пока не добавлен в HTML"
    );

    return;
  }

  element.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}


/*
==================================================
QUICK ACTIONS
==================================================
*/

function setupActions() {
  $$("[data-action]")
    .forEach(button => {
      button.addEventListener(
        "click",
        () => {
          const action =
            button.dataset.action;

          handleAction(action);
        }
      );
    });
}


function handleAction(action) {
  switch (action) {

    case "mute":
      openMutePrompt();
      break;

    case "message":
      openMessagePrompt();
      break;

    case "watch":
      openWatchPrompt();
      break;

    case "history":
      scrollToElement(
        "#historySection"
      );
      break;

    default:
      break;
  }
}


function openMutePrompt() {
  const userId =
    window.prompt(
      "Telegram ID пользователя:"
    );

  if (!userId) return;

  const duration =
    window.prompt(
      "Срок мута, например: 30 минут\nОставь пустым для вечного мута:"
    );

  muteUser(
    userId,
    duration || "Навсегда"
  );
}


function openWatchPrompt() {
  const target =
    window.prompt(
      "Username или Telegram ID:"
    );

  if (!target) return;

  addWatch(target);
}


function openMessagePrompt() {
  const chatId =
    window.prompt(
      "Telegram Chat ID:"
    );

  if (!chatId) return;

  const text =
    window.prompt(
      "Текст сообщения:"
    );

  if (!text) return;

  sendMessage({
    chatId,
    text
  });
}


/*
==================================================
MESSAGE BUTTON
==================================================
*/

function setupMessageButton() {
  const button =
    $("#messageButton");

  if (!button) return;

  button.addEventListener(
    "click",
    openMessagePrompt
  );
}


/*
==================================================
AI BUTTON
==================================================
*/

function setupAI() {
  const button =
    $("#aiSend");

  const input =
    $("#aiInput");

  if (button) {
    button.addEventListener(
      "click",
      sendAI
    );
  }

  if (input) {
    input.addEventListener(
      "keydown",
      event => {
        if (
          event.key === "Enter" &&
          !event.shiftKey
        ) {
          event.preventDefault();

          sendAI();
        }
      }
    );
  }
}


/*
==================================================
AUTO MUTE
==================================================
*/

function setupAutoMute() {
  const checkbox =
    $("#autoMute");

  if (!checkbox) return;

  checkbox.addEventListener(
    "change",
    () => {
      /*
        Пока сервер не имеет отдельного
        API для настройки auto-mute.
        Поэтому сохраняем состояние
        только локально.
      */

      localStorage.setItem(
        "stma_auto_mute",
        checkbox.checked
          ? "1"
          : "0"
      );

      showToast(
        checkbox.checked
          ? "Автоматический мут включён"
          : "Автоматический мут выключен"
      );
    }
  );

  checkbox.checked =
    localStorage.getItem(
      "stma_auto_mute"
    ) === "1";
}


/*
==================================================
SPLASH
==================================================
*/

function showSplash() {
  if ($(".splash")) {
    return;
  }

  const splash =
    document.createElement("div");

  splash.className =
    "splash";

  splash.innerHTML = `
    <div class="splash-logo">
      S
    </div>

    <div class="splash-title">
      STMA
    </div>

    <div class="splash-subtitle">
      Telegram automation
    </div>

    <div class="splash-loader">
      <span></span>
      <span></span>
      <span></span>
    </div>
  `;

  document.body.appendChild(
    splash
  );

  setTimeout(() => {
    splash.style.opacity = "0";
    splash.style.transition =
      "opacity .25s ease";

    setTimeout(() => {
      splash.remove();
    }, 280);
  }, 650);
}


/*
==================================================
ERROR
==================================================
*/

function showFatalError(error) {
  console.error(
    "STMA ERROR:",
    error
  );

  showToast(
    error?.message ||
    "Не удалось загрузить STMA"
  );
}


/*
==================================================
ESCAPE HTML
==================================================
*/

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


/*
==================================================
DATE
==================================================
*/

function formatDate(timestamp) {
  const date =
    new Date(timestamp);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "—";
  }

  return date.toLocaleString(
    "ru-RU",
    {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }
  );
}


/*
==================================================
INIT
==================================================
*/

async function init() {
  showSplash();

  setupNavigation();
  setupActions();
  setupAI();
  setupMessageButton();
  setupAutoMute();

  try {
    await loadMe();

    await refreshData();

  } catch (error) {
    showFatalError(error);
  }
}


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
    init
  );
} else {
  init();
}


/*
==================================================
AUTO REFRESH
==================================================
*/

setInterval(
  async () => {
    try {
      await Promise.allSettled([
        loadStats(),
        loadWatches(),
        loadMutes(),
        loadEvents()
      ]);
    } catch {
      // Не мешаем работе интерфейса
    }
  },
  15000
);