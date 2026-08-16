const tg =
  window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

let state = {
  user: null,
  connected: false,
  stats: {
    messages: 0,
    edits: 0,
    deleted: 0,
    events: 0
  }
};

function headers() {
  const initData =
    tg?.initData || "";

  return {
    "Content-Type":
      "application/json",

    "X-Telegram-Init-Data":
      initData
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
          ...headers(),
          ...(options.headers || {})
        }
      }
    );

  return response.json();
}

/*
==================================================
START
==================================================
*/

async function start() {
  try {
    const data =
      await api("/api/me");

    if (data.ok) {
      state.user =
        data.user;

      state.connected =
        data.connected;

      if (data.stats) {
        state.stats =
          data.stats;
      }
    }
  } catch (error) {
    console.error(error);
  }

  setTimeout(() => {
    document
      .getElementById("splash")
      .classList.add("hidden");

    document
      .getElementById("app")
      .classList.remove("hidden");

    openPage("home");
  }, 700);
}

/*
==================================================
PAGE
==================================================
*/

function openPage(page) {
  const content =
    document.getElementById(
      "content"
    );

  if (page === "home") {
    renderHome(content);
    return;
  }

  if (page === "ai") {
    renderAI(content);
    return;
  }

  if (page === "protection") {
    renderProtection(content);
    return;
  }

  if (page === "watch") {
    renderWatch(content);
    return;
  }

  if (page === "more") {
    renderMore(content);
    return;
  }

  if (page === "send") {
    renderSend(content);
    return;
  }

  if (page === "history") {
    renderHistory(content);
    return;
  }

  if (page === "stats") {
    renderStats(content);
    return;
  }

  if (page === "settings") {
    renderSettings(content);
    return;
  }

  if (page === "help") {
    renderHelp(content);
  }
}

/*
==================================================
HOME
==================================================
*/

function renderHome(el) {
  const name =
    state.user?.first_name ||
    "пользователь";

  el.innerHTML = `
    <section class="greeting">

      <h1>
        Добро пожаловать, ${escapeHtml(name)} 👋
      </h1>

      <p>
        Управляй STMA из одного места.
      </p>

    </section>

    <div class="stats">

      <div class="stat">
        <div class="stat-value">
          ${state.stats.messages}
        </div>

        <div class="stat-name">
          Сообщений
        </div>
      </div>

      <div class="stat">
        <div class="stat-value">
          ${state.stats.edits}
        </div>

        <div class="stat-name">
          Изменений
        </div>
      </div>

      <div class="stat">
        <div class="stat-value">
          ${state.stats.deleted}
        </div>

        <div class="stat-name">
          Удалений
        </div>
      </div>

    </div>

    <div class="grid">

      <div
        class="card"
        onclick="openPage('ai')"
      >
        <div class="card-icon">✦</div>
        <div class="card-title">AI</div>
        <div class="card-subtitle">
          Управление командами
        </div>
      </div>

      <div
        class="card"
        onclick="openPage('protection')"
      >
        <div class="card-icon">◉</div>
        <div class="card-title">Защита</div>
        <div class="card-subtitle">
          Mute и фильтры
        </div>
      </div>

      <div
        class="card"
        onclick="openPage('send')"
      >
        <div class="card-icon">↗</div>
        <div class="card-title">Сообщения</div>
        <div class="card-subtitle">
          Отправка и таймер
        </div>
      </div>

      <div
        class="card"
        onclick="openPage('watch')"
      >
        <div class="card-icon">◌</div>
        <div class="card-title">Слежка</div>
        <div class="card-subtitle">
          Профили
        </div>
      </div>

      <div
        class="card"
        onclick="openPage('history')"
      >
        <div class="card-icon">≡</div>
        <div class="card-title">История</div>
        <div class="card-subtitle">
          Сообщения и события
        </div>
      </div>

      <div
        class="card"
        onclick="openPage('stats')"
      >
        <div class="card-icon">▥</div>
        <div class="card-title">Статистика</div>
        <div class="card-subtitle">
          Активность
        </div>
      </div>

    </div>
  `;

  updateStatus();
}

/*
==================================================
STATUS
==================================================
*/

function updateStatus() {
  const status =
    document.getElementById(
      "status"
    );

  if (!status) return;

  status.textContent =
    state.connected
      ? "● Business подключён"
      : "○ Business не подключён";
}

/*
==================================================
AI
==================================================
*/

function renderAI(el) {
  el.innerHTML = `
    <div class="page-title">
      AI
    </div>

    <div class="card ai-box">

      <div
        id="messages"
        class="messages"
      >

        <div class="ai-message bot">
          Привет 👋<br><br>
          Я STMA AI. Напиши, что нужно сделать.
          Например: «Замуть @username на 30 минут».
        </div>

      </div>

      <div class="ai-input">

        <input
          id="aiInput"
          placeholder="Что сделать?"
          onkeydown="
            if(event.key === 'Enter')
              sendAI()
          "
        >

        <button
          class="send-button"
          onclick="sendAI()"
        >
          ➤
        </button>

      </div>

    </div>
  `;
}

async function sendAI() {
  const input =
    document.getElementById(
      "aiInput"
    );

  const messages =
    document.getElementById(
      "messages"
    );

  const prompt =
    input.value.trim();

  if (!prompt) return;

  messages.innerHTML += `
    <div class="ai-message user">
      ${escapeHtml(prompt)}
    </div>
  `;

  input.value = "";

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

  messages.innerHTML += `
    <div class="ai-message bot">
      ${escapeHtml(
        data.reply ||
        "Не удалось обработать запрос."
      )}
    </div>
  `;

  messages.scrollTop =
    messages.scrollHeight;
}

/*
==================================================
PROTECTION
==================================================
*/

async function renderProtection(el) {
  const data =
    await api("/api/mutes");

  const users =
    data.users || [];

  el.innerHTML = `
    <div class="page-title">
      🔇 Защита
    </div>

    <div class="card">

      <div class="label">
        Пользователь
      </div>

      <input
        id="muteUser"
        class="input"
        placeholder="@username или ID"
      >

      <div
        style="height:10px"
      ></div>

      <div class="label">
        Срок
      </div>

      <select
        id="muteDuration"
        class="select"
      >
        <option>10 секунд</option>
        <option>1 минута</option>
        <option>5 минут</option>
        <option>30 минут</option>
        <option>1 час</option>
        <option>24 часа</option>
        <option>Навсегда</option>
      </select>

      <div
        style="height:12px"
      ></div>

      <button
        class="primary"
        onclick="muteUser()"
      >
        🔇 Замутить
      </button>

    </div>

    <div
      style="height:18px"
    ></div>

    <div class="page-title">
      Активные Mute
    </div>

    <div class="list">

      ${
        users.length
          ? users.map(
              user => `
                <div class="list-item">

                  <div>
                    <div class="list-title">
                      ${escapeHtml(user)}
                    </div>

                    <div class="list-subtitle">
                      Новые сообщения удаляются
                    </div>
                  </div>

                  <button
                    class="icon-button"
                    onclick="unmuteUser('${escapeHtml(user)}')"
                  >
                    🔊
                  </button>

                </div>
              `
            ).join("")
          : `
            <div class="empty">
              Нет замьюченных пользователей
            </div>
          `
      }

    </div>
  `;
}

async function muteUser() {
  const user =
    document.getElementById(
      "muteUser"
    ).value.trim();

  const duration =
    document.getElementById(
      "muteDuration"
    ).value;

  if (!user) return;

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

  renderProtection(
    document.getElementById(
      "content"
    )
  );
}

async function unmuteUser(user) {
  await api(
    "/api/unmute",
    {
      method: "POST",

      body: JSON.stringify({
        user_id: user
      })
    }
  );

  renderProtection(
    document.getElementById(
      "content"
    )
  );
}

/*
==================================================
SEND
==================================================
*/

function renderSend(el) {
  el.innerHTML = `
    <div class="page-title">
      ✉️ Сообщение
    </div>

    <div class="form">

      <div class="label">
        Получатель
      </div>

      <input
        id="sendChat"
        class="input"
        placeholder="@username или ID"
      >

      <div class="label">
        Сообщение
      </div>

      <textarea
        id="sendText"
        class="textarea"
        placeholder="Введите сообщение..."
      ></textarea>

      <div class="label">
        Удалить через
      </div>

      <select
        id="sendDelete"
        class="select"
      >
        <option value="0">
          Не удалять
        </option>

        <option value="10">
          10 секунд
        </option>

        <option value="30">
          30 секунд
        </option>

        <option value="60">
          1 минута
        </option>

        <option value="300">
          5 минут
        </option>

        <option value="900">
          15 минут
        </option>

        <option value="3600">
          1 час
        </option>
      </select>

      <button
        class="primary"
        onclick="sendMessage()"
      >
        ➤ Отправить
      </button>

    </div>
  `;
}

async function sendMessage() {
  const chat =
    document.getElementById(
      "sendChat"
    ).value.trim();

  const text =
    document.getElementById(
      "sendText"
    ).value.trim();

  const deleteAfter =
    Number(
      document.getElementById(
        "sendDelete"
      ).value
    );

  if (!chat || !text) {
    return;
  }

  await api(
    "/api/send",
    {
      method: "POST",

      body: JSON.stringify({
        chat_id: chat,
        text,
        delete_after:
          deleteAfter
      })
    }
  );

  document.getElementById(
    "sendText"
  ).value = "";
}

/*
==================================================
WATCH
==================================================
*/

async function renderWatch(el) {
  el.innerHTML = `
    <div class="page-title">
      🕵️ Слежка
    </div>

    <div class="card">

      <div class="card-title">
        Слежка за профилями
      </div>

      <div class="card-subtitle">
        До 10 целей. STMA будет отслеживать
        доступные изменения профиля.
      </div>

      <div
        style="height:15px"
      ></div>

      <input
        class="input"
        placeholder="@username"
      >

      <div
        style="height:10px"
      ></div>

      <button class="primary">
        ＋ Добавить слежку
      </button>

    </div>

    <div
      style="height:14px"
    ></div>

    <div class="empty">
      Пока нет активных слежек
    </div>
  `;
}

/*
==================================================
HISTORY
==================================================
*/

async function renderHistory(el) {
  const data =
    await api("/api/history");

  const messages =
    data.messages || [];

  el.innerHTML = `
    <div class="page-title">
      📜 История
    </div>

    <div class="list">

      ${
        messages.length
          ? messages.map(
              item => `
                <div class="list-item">

                  <div>

                    <div class="list-title">
                      ${
                        escapeHtml(
                          item.sender_username
                            ? "@" +
                              item.sender_username
                            : item.sender_name ||
                              item.sender_id ||
                              "Unknown"
                        )
                      }
                    </div>

                    <div class="list-subtitle">
                      ${
                        escapeHtml(
                          item.text ||
                          "[медиа]"
                        )
                      }
                    </div>

                  </div>

                </div>
              `
            ).join("")
          : `
            <div class="empty">
              История пока пустая
            </div>
          `
      }

    </div>
  `;
}

/*
==================================================
STATS
==================================================
*/

function renderStats(el) {
  el.innerHTML = `
    <div class="page-title">
      📊 Статистика
    </div>

    <div class="stats">

      <div class="stat">
        <div class="stat-value">
          ${state.stats.messages}
        </div>

        <div class="stat-name">
          Сообщений
        </div>
      </div>

      <div class="stat">
        <div class="stat-value">
          ${state.stats.edits}
        </div>

        <div class="stat-name">
          Изменений
        </div>
      </div>

      <div class="stat">
        <div class="stat-value">
          ${state.stats.deleted}
        </div>

        <div class="stat-name">
          Удалений
        </div>
      </div>

    </div>
  `;
}

/*
==================================================
MORE
==================================================
*/

function renderMore(el) {
  el.innerHTML = `
    <div class="page-title">
      Ещё
    </div>

    <div class="grid">

      <div
        class="card"
        onclick="openPage('history')"
      >
        📜
        <div class="card-title">
          История
        </div>
      </div>

      <div
        class="card"
        onclick="openPage('stats')"
      >
        📊
        <div class="card-title">
          Статистика
        </div>
      </div>

      <div
        class="card"
        onclick="openPage('settings')"
      >
        ⚙️
        <div class="card-title">
          Настройки
        </div>
      </div>

      <div
        class="card"
        onclick="openPage('help')"
      >
        ❓
        <div class="card-title">
          Помощь
        </div>
      </div>

    </div>
  `;
}

/*
==================================================
SETTINGS
==================================================
*/

function renderSettings(el) {
  el.innerHTML = `
    <div class="page-title">
      ⚙️ Настройки
    </div>

    <div class="card">

      <div class="card-title">
        🔕 Тихие действия
      </div>

      <div class="card-subtitle">
        Не отправлять служебные сообщения
        в Business-чаты.
      </div>

    </div>

    <div
      style="height:10px"
    ></div>

    <div class="card">

      <div class="card-title">
        🤖 AI
      </div>

      <div class="card-subtitle">
        Управление STMA через обычные запросы.
      </div>

    </div>
  `;
}

/*
==================================================
HELP
==================================================
*/

function renderHelp(el) {
  el.innerHTML = `
    <div class="page-title">
      ❓ Помощь
    </div>

    <div class="card">

      <div class="card-title">
        STMA
      </div>

      <div class="card-subtitle">

        AI — управление STMA<br><br>

        Mute — автоматическое удаление
        сообщений пользователей<br><br>

        Сообщения — отправка и
        автоудаление<br><br>

        Мониторинг — события Business-чатов<br><br>

        Слежка — изменения доступных
        данных профилей

      </div>

    </div>
  `;
}

/*
==================================================
ESCAPE
==================================================
*/

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/*
==================================================
START
==================================================
*/

start();