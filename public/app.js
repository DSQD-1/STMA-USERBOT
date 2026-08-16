const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();

  try {
    tg.setHeaderColor("#0b0c0f");
    tg.setBackgroundColor("#0b0c0f");
  } catch {}
}

/* =========================================================
   STATE
========================================================= */

const state = {
  user: null,
  connected: false,

  stats: {
    messages: 0,
    edits: 0,
    deleted: 0,
    events: 0
  },

  watchCount: 0,
  activities: []
};


/* =========================================================
   HELPERS
========================================================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function headers() {
  return {
    "Content-Type": "application/json",

    "X-Telegram-Init-Data":
      tg?.initData || ""
  };
}


async function api(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,

      headers: {
        ...headers(),
        ...(options.headers || {})
      }
    });

    const text = await response.text();

    try {
      return JSON.parse(text);
    } catch {
      return {
        ok: response.ok,
        reply: text
      };
    }
  } catch (error) {
    console.error("API ERROR:", error);

    return {
      ok: false,
      error: error.message
    };
  }
}


function toast(text) {
  const element =
    document.getElementById("toast");

  if (!element) return;

  element.textContent = text;
  element.classList.add("show");

  clearTimeout(
    toast.timer
  );

  toast.timer = setTimeout(() => {
    element.classList.remove("show");
  }, 2500);
}


function addActivity(
  title,
  icon = "✓"
) {
  state.activities.unshift({
    title,
    icon,
    time: new Date()
  });

  state.activities =
    state.activities.slice(0, 10);

  renderActivity();
}


function formatTime(date) {
  return new Intl.DateTimeFormat(
    "ru-RU",
    {
      hour: "2-digit",
      minute: "2-digit"
    }
  ).format(date);
}


/* =========================================================
   INITIALIZATION
========================================================= */

async function start() {
  const data =
    await api("/api/me");

  if (data?.ok) {
    state.user =
      data.user || null;

    state.connected =
      Boolean(data.connected);

    if (data.stats) {
      state.stats = {
        ...state.stats,
        ...data.stats
      };
    }
  }

  const watch =
    await api("/api/watch");

  if (watch?.ok) {
    state.watchCount =
      Number(
        watch.count ??
        watch.watchCount ??
        watch.total ??
        0
      );
  }

  renderHome();
  renderActivity();

  setupNavigation();
  setupActions();

  updateHeaderStatus();
}


/* =========================================================
   HEADER
========================================================= */

function updateHeaderStatus() {
  const status =
    document.querySelector(".status");

  if (!status) return;

  status.innerHTML = `
    <span class="status-dot"></span>
    <span>
      ${state.connected
        ? "Online"
        : "Offline"}
    </span>
  `;
}


/* =========================================================
   HOME
========================================================= */

function renderHome() {
  const name =
    state.user?.first_name ||
    "владелец";

  const title =
    document.querySelector(".hero h1");

  const subtitle =
    document.querySelector(".hero p");

  if (title) {
    title.innerHTML = `
      Управляй Telegram<br>
      проще.
    `;
  }

  if (subtitle) {
    subtitle.textContent =
      `Добро пожаловать, ${name}. ` +
      `Все инструменты STMA — в одном месте.`;
  }

  const watchCount =
    document.getElementById(
      "watchCount"
    );

  if (watchCount) {
    watchCount.textContent =
      state.watchCount;
  }

  const autoMute =
    document.getElementById(
      "autoMute"
    );

  if (autoMute) {
    autoMute.checked =
      localStorage.getItem(
        "stma_auto_mute"
      ) === "true";
  }
}


/* =========================================================
   NAVIGATION
========================================================= */

function setupNavigation() {
  document
    .querySelectorAll(".nav-item")
    .forEach(button => {
      button.addEventListener(
        "click",
        () => {
          const page =
            button.dataset.page;

          document
            .querySelectorAll(".nav-item")
            .forEach(item => {
              item.classList.remove(
                "active"
              );
            });

          button.classList.add(
            "active"
          );

          if (page === "home") {
            window.scrollTo({
              top: 0,
              behavior: "smooth"
            });

            return;
          }

          if (page === "watch") {
            openWatch();
            return;
          }

          if (page === "actions") {
            openActions();
            return;
          }

          if (page === "settings") {
            openSettings();
          }
        }
      );
    });
}


/* =========================================================
   QUICK ACTIONS
========================================================= */

function setupActions() {
  document
    .querySelectorAll(".action")
    .forEach(button => {
      button.addEventListener(
        "click",
        () => {
          const action =
            button.dataset.action;

          if (action === "mute") {
            openMute();
          }

          if (action === "message") {
            openMessage();
          }

          if (action === "watch") {
            openWatch();
          }

          if (action === "history") {
            openHistory();
          }
        }
      );
    });


  const messageButton =
    document.getElementById(
      "messageButton"
    );

  if (messageButton) {
    messageButton.onclick =
      openMessage;
  }


  const aiButton =
    document.getElementById(
      "aiSend"
    );

  if (aiButton) {
    aiButton.onclick =
      sendAI;
  }


  const aiInput =
    document.getElementById(
      "aiInput"
    );

  if (aiInput) {
    aiInput.addEventListener(
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


  const autoMute =
    document.getElementById(
      "autoMute"
    );

  if (autoMute) {
    autoMute.addEventListener(
      "change",
      async () => {
        localStorage.setItem(
          "stma_auto_mute",
          autoMute.checked
        );

        toast(
          autoMute.checked
            ? "Автоматический мут включён"
            : "Автоматический мут выключен"
        );

        addActivity(
          autoMute.checked
            ? "Включён автоматический мут"
            : "Выключен автоматический мут",
          "🛡"
        );
      }
    );
  }
}


/* =========================================================
   AI
========================================================= */

async function sendAI() {
  const input =
    document.getElementById(
      "aiInput"
    );

  const result =
    document.getElementById(
      "aiResult"
    );

  if (!input || !result) {
    return;
  }

  const prompt =
    input.value.trim();

  if (!prompt) {
    toast("Напиши запрос");
    return;
  }

  result.classList.remove(
    "hidden"
  );

  result.innerHTML =
    "⏳ Обрабатываю запрос...";

  input.disabled = true;

  try {
    const data =
      await api(
        "/api/ai",
        {
          method: "POST",

          body: JSON.stringify({
            prompt
          })
        }
      );

    if (!data?.ok) {
      result.innerHTML =
        escapeHtml(
          data?.error ||
          data?.reply ||
          "Не удалось выполнить запрос."
        );

      return;
    }

    result.innerHTML =
      escapeHtml(
        data.reply ||
        data.message ||
        "Готово."
      );

    addActivity(
      `AI: ${prompt}`,
      "✦"
    );

    toast("Готово");
  } catch {
    result.innerHTML =
      "Произошла ошибка.";
  } finally {
    input.disabled = false;
    input.focus();
  }
}


/* =========================================================
   MUTE
========================================================= */

function openMute() {
  showModal(`
    <div class="modal-card">

      <div class="modal-title">
        🔇 Мут пользователя
      </div>

      <div class="modal-subtitle">
        Укажи username или Telegram ID.
      </div>

      <input
        id="modalMuteUser"
        class="modal-input"
        placeholder="@username или ID"
        autocomplete="off"
      >

      <select
        id="modalMuteDuration"
        class="modal-input"
      >
        <option value="10">
          10 секунд
        </option>

        <option value="60">
          1 минута
        </option>

        <option value="300">
          5 минут
        </option>

        <option value="1800" selected>
          30 минут
        </option>

        <option value="3600">
          1 час
        </option>

        <option value="86400">
          24 часа
        </option>

        <option value="0">
          Навсегда
        </option>
      </select>

      <button
        class="modal-primary"
        id="confirmMute"
      >
        🔇 Замутить
      </button>

      <button
        class="modal-secondary"
        onclick="closeModal()"
      >
        Отмена
      </button>

    </div>
  `);

  document
    .getElementById(
      "confirmMute"
    )
    ?.addEventListener(
      "click",
      confirmMute
    );
}


async function confirmMute() {
  const user =
    document
      .getElementById(
        "modalMuteUser"
      )
      ?.value
      .trim();

  const duration =
    Number(
      document
        .getElementById(
          "modalMuteDuration"
        )
        ?.value
    );

  if (!user) {
    toast("Укажи пользователя");
    return;
  }

  const data =
    await api(
      "/api/mute",
      {
        method: "POST",

        body: JSON.stringify({
          user_id: user,
          duration
        })
      }
    );

  if (!data?.ok) {
    toast(
      data?.error ||
      "Не удалось установить мут"
    );

    return;
  }

  closeModal();

  addActivity(
    `Мут: ${user}`,
    "🔇"
  );

  toast(
    "Пользователь замьючен"
  );
}


/* =========================================================
   MESSAGE
========================================================= */

function openMessage() {
  showModal(`
    <div class="modal-card">

      <div class="modal-title">
        ✉️ Новое сообщение
      </div>

      <div class="modal-subtitle">
        Сообщение отправится от STMA
        через Telegram Business.
      </div>

      <input
        id="modalChat"
        class="modal-input"
        placeholder="@username или ID"
      >

      <textarea
        id="modalText"
        class="modal-textarea"
        placeholder="Текст сообщения..."
      ></textarea>

      <select
        id="modalDeleteAfter"
        class="modal-input"
      >
        <option value="0">
          Не удалять
        </option>

        <option value="10">
          Удалить через 10 секунд
        </option>

        <option value="30">
          Удалить через 30 секунд
        </option>

        <option value="60">
          Удалить через 1 минуту
        </option>

        <option value="300">
          Удалить через 5 минут
        </option>

        <option value="900">
          Удалить через 15 минут
        </option>

        <option value="3600">
          Удалить через 1 час
        </option>
      </select>

      <label class="modal-check">

        <input
          type="checkbox"
          id="modalOnce"
        >

        <span>
          Одноразовое сообщение
        </span>

      </label>

      <button
        class="modal-primary"
        id="confirmSend"
      >
        Отправить
      </button>

      <button
        class="modal-secondary"
        onclick="closeModal()"
      >
        Отмена
      </button>

    </div>
  `);

  document
    .getElementById(
      "confirmSend"
    )
    ?.addEventListener(
      "click",
      confirmSend
    );
}


async function confirmSend() {
  const chat =
    document
      .getElementById(
        "modalChat"
      )
      ?.value
      .trim();

  const text =
    document
      .getElementById(
        "modalText"
      )
      ?.value
      .trim();

  const deleteAfter =
    Number(
      document
        .getElementById(
          "modalDeleteAfter"
        )
        ?.value
    );

  const once =
    Boolean(
      document
        .getElementById(
          "modalOnce"
        )
        ?.checked
    );

  if (!chat) {
    toast("Укажи получателя");
    return;
  }

  if (!text) {
    toast("Напиши сообщение");
    return;
  }

  const data =
    await api(
      "/api/send",
      {
        method: "POST",

        body: JSON.stringify({
          chat_id: chat,
          text,
          delete_after: deleteAfter,
          once
        })
      }
    );

  if (!data?.ok) {
    toast(
      data?.error ||
      "Не удалось отправить"
    );

    return;
  }

  closeModal();

  addActivity(
    `Сообщение отправлено: ${chat}`,
    "✉️"
  );

  toast("Сообщение отправлено");
}


/* =========================================================
   WATCH
========================================================= */

function openWatch() {
  showModal(`
    <div class="modal-card">

      <div class="modal-title">
        🕵️ Слежка за профилем
      </div>

      <div class="modal-subtitle">
        STMA будет проверять выбранный
        профиль и сообщать об изменениях.
      </div>

      <input
        id="modalWatchUser"
        class="modal-input"
        placeholder="@username"
      >

      <button
        class="modal-primary"
        id="confirmWatch"
      >
        Добавить слежку
      </button>

      <button
        class="modal-secondary"
        onclick="closeModal()"
      >
        Отмена
      </button>

    </div>
  `);

  document
    .getElementById(
      "confirmWatch"
    )
    ?.addEventListener(
      "click",
      confirmWatch
    );
}


async function confirmWatch() {
  const username =
    document
      .getElementById(
        "modalWatchUser"
      )
      ?.value
      .trim();

  if (!username) {
    toast("Укажи username");
    return;
  }

  if (state.watchCount >= 10) {
    toast(
      "Максимум 10 слежек"
    );

    return;
  }

  const data =
    await api(
      "/api/watch",
      {
        method: "POST",

        body: JSON.stringify({
          username
        })
      }
    );

  if (!data?.ok) {
    toast(
      data?.error ||
      "Не удалось добавить слежку"
    );

    return;
  }

  state.watchCount++;

  const counter =
    document.getElementById(
      "watchCount"
    );

  if (counter) {
    counter.textContent =
      state.watchCount;
  }

  closeModal();

  addActivity(
    `Добавлена слежка: ${username}`,
    "🕵️"
  );

  toast("Слежка добавлена");
}


/* =========================================================
   HISTORY
========================================================= */

async function openHistory() {
  const data =
    await api(
      "/api/history"
    );

  const messages =
    data?.messages || [];

  let html = `
    <div class="modal-card">

      <div class="modal-title">
        📜 История
      </div>
  `;

  if (!messages.length) {
    html += `
      <div class="modal-empty">
        История пока пустая.
      </div>
    `;
  } else {
    html += `
      <div class="history-list">
        ${
          messages
            .slice(0, 30)
            .map(item => `
              <div class="history-item">

                <div class="history-user">
                  ${escapeHtml(
                    item.sender_username
                      ? "@" +
                        item.sender_username
                      : item.sender_name ||
                        item.sender_id ||
                        "Unknown"
                  )}
                </div>

                <div class="history-text">
                  ${escapeHtml(
                    item.text ||
                    "[медиа]"
                  )}
                </div>

              </div>
            `)
            .join("")
        }
      </div>
    `;
  }

  html += `
      <button
        class="modal-secondary"
        onclick="closeModal()"
      >
        Закрыть
      </button>

    </div>
  `;

  showModal(html);
}


/* =========================================================
   ACTIONS PAGE
========================================================= */

function openActions() {
  showModal(`
    <div class="modal-card">

      <div class="modal-title">
        ✦ Действия
      </div>

      <button
        class="menu-button"
        onclick="closeModal(); openMute()"
      >
        🔇 Мут
      </button>

      <button
        class="menu-button"
        onclick="closeModal(); openMessage()"
      >
        ✉️ Отправить сообщение
      </button>

      <button
        class="menu-button"
        onclick="closeModal(); openWatch()"
      >
        🕵️ Добавить слежку
      </button>

      <button
        class="menu-button"
        onclick="closeModal(); openHistory()"
      >
        📜 История
      </button>

      <button
        class="modal-secondary"
        onclick="closeModal()"
      >
        Закрыть
      </button>

    </div>
  `);
}


/* =========================================================
   SETTINGS
========================================================= */

function openSettings() {
  const autoMute =
    localStorage.getItem(
      "stma_auto_mute"
    ) === "true";

  showModal(`
    <div class="modal-card">

      <div class="modal-title">
        ⚙️ Настройки
      </div>

      <div class="settings-row">

        <div>
          <strong>
            Тихие действия
          </strong>

          <small>
            Служебные действия
            показываются только тебе.
          </small>
        </div>

        <span>
          ${autoMute ? "ON" : "OFF"}
        </span>

      </div>

      <div class="settings-row">

        <div>
          <strong>
            Business
          </strong>

          <small>
            ${
              state.connected
                ? "Подключение активно"
                : "Подключение отсутствует"
            }
          </small>
        </div>

        <span>
          ${
            state.connected
              ? "🟢"
              : "🔴"
          }
        </span>

      </div>

      <button
        class="modal-secondary"
        onclick="closeModal()"
      >
        Закрыть
      </button>

    </div>
  `);
}


/* =========================================================
   ACTIVITY
========================================================= */

function renderActivity() {
  const element =
    document.getElementById(
      "activity"
    );

  if (!element) return;

  if (!state.activities.length) {
    element.innerHTML = `
      <div class="empty">
        Пока действий нет
      </div>
    `;

    return;
  }

  element.innerHTML =
    state.activities
      .map(item => `
        <div class="activity-item">

          <div class="activity-icon">
            ${item.icon}
          </div>

          <div class="activity-main">

            <div class="activity-title">
              ${escapeHtml(
                item.title
              )}
            </div>

            <div class="activity-time">
              ${formatTime(
                item.time
              )}
            </div>

          </div>

        </div>
      `)
      .join("");
}


/* =========================================================
   MODAL
========================================================= */

function showModal(content) {
  closeModal();

  const overlay =
    document.createElement(
      "div"
    );

  overlay.id =
    "stmaModal";

  overlay.className =
    "stma-modal";

  overlay.innerHTML =
    content;

  overlay.addEventListener(
    "click",
    event => {
      if (
        event.target ===
        overlay
      ) {
        closeModal();
      }
    }
  );

  document.body.appendChild(
    overlay
  );

  requestAnimationFrame(() => {
    overlay.classList.add(
      "show"
    );
  });
}


function closeModal() {
  const modal =
    document.getElementById(
      "stmaModal"
    );

  if (!modal) return;

  modal.classList.remove(
    "show"
  );

  setTimeout(() => {
    modal.remove();
  }, 180);
}


/* =========================================================
   KEYBOARD
========================================================= */

document.addEventListener(
  "keydown",
  event => {
    if (
      event.key === "Escape"
    ) {
      closeModal();
    }
  }
);


/* =========================================================
   START
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  start
);