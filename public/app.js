(() => {
  "use strict";

  /*
  ==================================================
  STMA APP.JS
  ==================================================
  */

  const state = {
    initData: "",
    me: null,
    stats: {
      messages: 0,
      edits: 0,
      deleted: 0,
      events: 0,
      mutes: 0,
      watches: 0
    },
    mutes: [],
    watches: [],
    history: [],
    events: [],
    currentSection: "dashboard",
    loading: false
  };

  /*
  ==================================================
  TELEGRAM
  ==================================================
  */

  function getTelegram() {
    return window.Telegram?.WebApp || null;
  }

  function initTelegram() {
    const tg = getTelegram();

    if (!tg) {
      state.initData = "";
      return;
    }

    try {
      tg.ready();
      tg.expand();

      if (typeof tg.setHeaderColor === "function") {
        tg.setHeaderColor("#07050d");
      }

      if (typeof tg.setBackgroundColor === "function") {
        tg.setBackgroundColor("#07050d");
      }

      state.initData = tg.initData || "";
    } catch (error) {
      console.error("Telegram init error:", error);
    }
  }

  /*
  ==================================================
  API
  ==================================================
  */

  async function api(url, options = {}) {
    const config = {
      ...options,
      headers: {
        ...(options.headers || {}),
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": state.initData
      }
    };

    const response = await fetch(url, config);

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error(
        `Сервер вернул некорректный ответ (${response.status})`
      );
    }

    if (!response.ok || data?.ok === false) {
      throw new Error(
        data?.error ||
        data?.message ||
        `Ошибка сервера (${response.status})`
      );
    }

    return data;
  }

  /*
  ==================================================
  HELPERS
  ==================================================
  */

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const $$ = (selector, root = document) =>
    [...root.querySelectorAll(selector)];

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDate(value) {
    if (!value) return "—";

    let date;

    if (typeof value === "number") {
      date = new Date(
        value < 100000000000
          ? value * 1000
          : value
      );
    } else {
      date = new Date(value);
    }

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) {
      return "Навсегда";
    }

    const value = Number(seconds);

    if (!Number.isFinite(value)) {
      return "—";
    }

    if (value <= 0) {
      return "Истёк";
    }

    const days = Math.floor(value / 86400);
    const hours = Math.floor((value % 86400) / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const secs = Math.floor(value % 60);

    const parts = [];

    if (days) parts.push(`${days}д`);
    if (hours) parts.push(`${hours}ч`);
    if (minutes) parts.push(`${minutes}м`);

    if (!parts.length || secs) {
      parts.push(`${secs}с`);
    }

    return parts.join(" ");
  }

  function showToast(message, type = "info") {
    let container = $("#toast-container");

    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");

    toast.className = `toast toast-${type}`;

    toast.innerHTML = `
      <div class="toast-icon">
        ${
          type === "success"
            ? "✓"
            : type === "error"
              ? "!"
              : "•"
        }
      </div>
      <div class="toast-text">
        ${escapeHTML(message)}
      </div>
    `;

    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add("show");
    });

    setTimeout(() => {
      toast.classList.remove("show");

      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 3500);
  }

  function confirmAction(message) {
    return window.confirm(message);
  }

  function setText(selector, value) {
    const element = $(selector);

    if (element) {
      element.textContent = String(value ?? "");
    }
  }

  /*
  ==================================================
  USER
  ==================================================
  */

  function renderUser() {
    const user = state.me?.user;

    if (!user) return;

    const fullName = [
      user.first_name,
      user.last_name
    ]
      .filter(Boolean)
      .join(" ");

    const displayName =
      fullName ||
      (user.username
        ? `@${user.username}`
        : `ID ${user.id}`);

    setText("#user-name", displayName);

    setText(
      "#user-username",
      user.username
        ? `@${user.username}`
        : `ID: ${user.id}`
    );

    const avatar = $("#user-avatar");

    if (avatar) {
      avatar.textContent =
        (user.first_name || user.username || "S")
          .charAt(0)
          .toUpperCase();
    }

    setText(
      "#connection-status",
      state.me.connected
        ? "Telegram Business подключён"
        : "Telegram Business не подключён"
    );

    const status = $("#connection-dot");

    if (status) {
      status.classList.toggle(
        "online",
        Boolean(state.me.connected)
      );
    }
  }

  /*
  ==================================================
  STATS
  ==================================================
  */

  function renderStats() {
    const stats = state.stats || {};

    const map = {
      "#stat-messages": stats.messages ?? 0,
      "#stat-edits": stats.edits ?? 0,
      "#stat-deleted": stats.deleted ?? 0,
      "#stat-events": stats.events ?? 0,
      "#stat-mutes": stats.mutes ?? 0,
      "#stat-watches": stats.watches ?? 0
    };

    Object.entries(map).forEach(
      ([selector, value]) => {
        setText(selector, value);
      }
    );
  }

  /*
  ==================================================
  DASHBOARD
  ==================================================
  */

  function renderDashboard() {
    renderUser();
    renderStats();

    const connection = state.me?.connection;

    setText(
      "#connection-id",
      connection?.id || "Не подключён"
    );

    setText(
      "#connection-user",
      connection?.username
        ? `@${connection.username}`
        : connection?.first_name || "—"
    );

    const badge = $("#connection-badge");

    if (badge) {
      badge.textContent =
        state.me?.connected
          ? "CONNECTED"
          : "NOT CONNECTED";

      badge.classList.toggle(
        "connected",
        Boolean(state.me?.connected)
      );
    }
  }

  /*
  ==================================================
  MUTES
  ==================================================
  */

  function renderMutes() {
    const container =
      $("#mutes-list");

    if (!container) return;

    if (!state.mutes.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔇</div>
          <div class="empty-title">Мутов нет</div>
          <div class="empty-text">
            Добавь пользователя через форму выше
          </div>
        </div>
      `;

      return;
    }

    container.innerHTML =
      state.mutes
        .map((mute) => {
          const username =
            mute.username
              ? `@${String(mute.username).replace(/^@/, "")}`
              : "";

          const target =
            username ||
            mute.user_id ||
            "Неизвестный пользователь";

          let expiration = "Навсегда";

          if (mute.expires_at) {
            const remaining =
              Number(mute.expires_at) -
              Math.floor(Date.now() / 1000);

            expiration =
              remaining > 0
                ? `Осталось ${formatDuration(remaining)}`
                : "Истёк";
          }

          return `
            <div class="list-item mute-item">
              <div class="list-icon purple">🔇</div>

              <div class="list-main">
                <div class="list-title">
                  ${escapeHTML(target)}
                </div>

                <div class="list-subtitle">
                  ${
                    mute.user_id
                      ? `Telegram ID: ${escapeHTML(mute.user_id)}`
                      : "ID не указан"
                  }
                </div>

                <div class="list-meta">
                  ${escapeHTML(expiration)}
                </div>
              </div>

              <button
                class="icon-button danger"
                data-action="unmute"
                data-user-id="${escapeHTML(mute.user_id || "")}"
                title="Снять мут"
              >
                ✕
              </button>
            </div>
          `;
        })
        .join("");
  }

  async function loadMutes() {
    const data = await api("/api/mutes");

    state.mutes = Array.isArray(data.users)
      ? data.users
      : [];

    renderMutes();
  }

  async function createMute() {
    const userId =
      Number($("#mute-user-id")?.value || 0);

    const username =
      String(
        $("#mute-username")?.value || ""
      ).trim();

    const duration =
      String(
        $("#mute-duration")?.value || ""
      ).trim();

    if (!userId && !username) {
      showToast(
        "Укажи Telegram ID или username",
        "error"
      );
      return;
    }

    try {
      await api("/api/mute", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId || undefined,
          username: username || undefined,
          duration: duration || undefined
        })
      });

      showToast(
        "Пользователь замьючен",
        "success"
      );

      if ($("#mute-user-id")) {
        $("#mute-user-id").value = "";
      }

      if ($("#mute-username")) {
        $("#mute-username").value = "";
      }

      if ($("#mute-duration")) {
        $("#mute-duration").value = "";
      }

      await Promise.all([
        loadMutes(),
        loadStats()
      ]);
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function removeMute(userId) {
    if (!userId) {
      showToast(
        "Для снятия мута нужен Telegram ID",
        "error"
      );
      return;
    }

    if (
      !confirmAction(
        "Снять мут с этого пользователя?"
      )
    ) {
      return;
    }

    try {
      await api("/api/unmute", {
        method: "POST",
        body: JSON.stringify({
          user_id: Number(userId)
        })
      });

      showToast(
        "Мут снят",
        "success"
      );

      await Promise.all([
        loadMutes(),
        loadStats()
      ]);
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  /*
  ==================================================
  WATCHES
  ==================================================
  */

  function renderWatches() {
    const container =
      $("#watches-list");

    if (!container) return;

    if (!state.watches.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">👁</div>
          <div class="empty-title">Слежек нет</div>
          <div class="empty-text">
            Добавь username или Telegram ID
          </div>
        </div>
      `;

      return;
    }

    container.innerHTML =
      state.watches
        .map((watch) => {
          const target =
            String(watch.target || "");

          return `
            <div class="list-item watch-item">
              <div class="list-icon cyan">◉</div>

              <div class="list-main">
                <div class="list-title">
                  ${escapeHTML(target)}
                </div>

                <div class="list-subtitle">
                  ${
                    Number(watch.enabled)
                      ? "Слежка активна"
                      : "Слежка выключена"
                  }
                </div>

                <div class="list-meta">
                  Добавлено ${formatDate(watch.created_at)}
                </div>
              </div>

              <button
                class="icon-button danger"
                data-action="remove-watch"
                data-watch-id="${escapeHTML(watch.id)}"
                title="Удалить"
              >
                ✕
              </button>
            </div>
          `;
        })
        .join("");
  }

  async function loadWatches() {
    const data =
      await api("/api/watches");

    state.watches =
      Array.isArray(data.watches)
        ? data.watches
        : [];

    renderWatches();
  }

  async function createWatch() {
    const target =
      String(
        $("#watch-target")?.value || ""
      ).trim();

    if (!target) {
      showToast(
        "Укажи username или Telegram ID",
        "error"
      );
      return;
    }

    try {
      await api("/api/watches", {
        method: "POST",
        body: JSON.stringify({
          target
        })
      });

      showToast(
        `${target} добавлен в слежку`,
        "success"
      );

      $("#watch-target").value = "";

      await Promise.all([
        loadWatches(),
        loadStats()
      ]);
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function removeWatch(id) {
    if (!id) return;

    if (
      !confirmAction(
        "Удалить эту слежку?"
      )
    ) {
      return;
    }

    try {
      await api(
        `/api/watches/${encodeURIComponent(id)}`,
        {
          method: "DELETE"
        }
      );

      showToast(
        "Слежка удалена",
        "success"
      );

      await Promise.all([
        loadWatches(),
        loadStats()
      ]);
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  /*
  ==================================================
  HISTORY
  ==================================================
  */

  function renderHistory() {
    const container =
      $("#history-list");

    if (!container) return;

    if (!state.history.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">💬</div>
          <div class="empty-title">История пуста</div>
          <div class="empty-text">
            Здесь появятся сообщения из Telegram Business
          </div>
        </div>
      `;

      return;
    }

    container.innerHTML =
      state.history
        .map((message) => {
          const deleted =
            Boolean(message.deleted_at);

          const edited =
            Boolean(message.edited_at);

          const sender =
            message.sender_username
              ? `@${String(message.sender_username).replace(/^@/, "")}`
              : message.sender_name ||
                message.sender_id ||
                "Пользователь";

          return `
            <div class="message-item ${
              deleted
                ? "message-deleted"
                : ""
            }">

              <div class="message-top">
                <span class="message-sender">
                  ${escapeHTML(sender)}
                </span>

                <span class="message-time">
                  ${formatDate(message.created_at)}
                </span>
              </div>

              <div class="message-text">
                ${
                  message.text
                    ? escapeHTML(message.text)
                    : "<i>Медиа / сообщение без текста</i>"
                }
              </div>

              <div class="message-bottom">
                <span>
                  Chat: ${escapeHTML(message.chat_id)}
                </span>

                <span>
                  #${escapeHTML(message.message_id)}
                </span>

                ${
                  edited
                    ? `<span class="tag purple-tag">ИЗМЕНЕНО</span>`
                    : ""
                }

                ${
                  deleted
                    ? `<span class="tag red-tag">УДАЛЕНО</span>`
                    : ""
                }
              </div>
            </div>
          `;
        })
        .join("");
  }

  async function loadHistory() {
    const data =
      await api("/api/history");

    state.history =
      Array.isArray(data.messages)
        ? data.messages
        : [];

    renderHistory();
  }

  /*
  ==================================================
  EVENTS
  ==================================================
  */

  function eventName(type) {
    const names = {
      message: "Новое сообщение",
      message_edited: "Сообщение изменено",
      messages_deleted: "Сообщения удалены",
      connection_enabled: "Business подключён",
      connection_disabled: "Business отключён",
      mute: "Пользователь замьючен",
      unmute: "Мут снят",
      watch_add: "Добавлена слежка",
      watch_remove: "Слежка удалена",
      send_message: "Сообщение отправлено",
      message_deleted: "Сообщение удалено"
    };

    return names[type] || type || "Событие";
  }

  function renderEvents() {
    const container =
      $("#events-list");

    if (!container) return;

    if (!state.events.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚡</div>
          <div class="empty-title">Событий нет</div>
          <div class="empty-text">
            Система ещё не получила события
          </div>
        </div>
      `;

      return;
    }

    container.innerHTML =
      state.events
        .map((event) => {
          let details = "";

          if (event.data) {
            try {
              const data =
                typeof event.data === "string"
                  ? JSON.parse(event.data)
                  : event.data;

              if (
                data?.userId
              ) {
                details =
                  `Telegram ID: ${data.userId}`;
              } else if (
                data?.target
              ) {
                details =
                  `Цель: ${data.target}`;
              } else if (
                data?.messageIds
              ) {
                details =
                  `Сообщений: ${data.messageIds.length}`;
              }
            } catch {
              details = "";
            }
          }

          return `
            <div class="event-item">

              <div class="event-icon">
                ⚡
              </div>

              <div class="event-main">

                <div class="event-title">
                  ${escapeHTML(eventName(event.type))}
                </div>

                <div class="event-subtitle">
                  ${escapeHTML(details)}
                </div>

                <div class="event-meta">
                  ${formatDate(event.created_at)}
                </div>

              </div>
            </div>
          `;
        })
        .join("");
  }

  async function loadEvents() {
    const data =
      await api("/api/events");

    state.events =
      Array.isArray(data.events)
        ? data.events
        : [];

    renderEvents();
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

    renderStats();
  }

  /*
  ==================================================
  ME
  ==================================================
  */

  async function loadMe() {
    const data =
      await api("/api/me");

    state.me = data;

    renderDashboard();

    return data;
  }

  /*
  ==================================================
  AI
  ==================================================
  */

  function addAIMessage(text, type = "bot") {
    const container =
      $("#ai-messages");

    if (!container) return;

    const message =
      document.createElement("div");

    message.className =
      `ai-message ${type}`;

    message.innerHTML = `
      <div class="ai-message-label">
        ${
          type === "user"
            ? "YOU"
            : "STMA AI"
        }
      </div>

      <div class="ai-message-text">
        ${escapeHTML(text)}
      </div>
    `;

    container.appendChild(message);

    container.scrollTop =
      container.scrollHeight;
  }

  async function sendAI() {
    const input =
      $("#ai-input");

    if (!input) return;

    const prompt =
      String(input.value || "").trim();

    if (!prompt) return;

    input.value = "";

    addAIMessage(
      prompt,
      "user"
    );

    try {
      const data =
        await api("/api/ai", {
          method: "POST",
          body: JSON.stringify({
            prompt
          })
        });

      addAIMessage(
        data.reply || "Готово.",
        "bot"
      );

      await refreshAll();
    } catch (error) {
      addAIMessage(
        `Ошибка: ${error.message}`,
        "bot"
      );
    }
  }

  /*
  ==================================================
  SEND MESSAGE
  ==================================================
  */

  async function sendMessage() {
    const chatId =
      Number(
        $("#send-chat-id")?.value || 0
      );

    const text =
      String(
        $("#send-text")?.value || ""
      ).trim();

    const deleteAfter =
      Number(
        $("#send-delete-after")?.value || 0
      );

    if (!chatId || !text) {
      showToast(
        "Укажи chat ID и текст",
        "error"
      );
      return;
    }

    try {
      const data =
        await api("/api/send", {
          method: "POST",
          body: JSON.stringify({
            chat_id: chatId,
            text,
            delete_after:
              deleteAfter || 0
          })
        });

      showToast(
        `Сообщение отправлено (#${data.message_id})`,
        "success"
      );

      $("#send-text").value = "";

      await Promise.all([
        loadHistory(),
        loadEvents(),
        loadStats()
      ]);
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  /*
  ==================================================
  NAVIGATION
  ==================================================
  */

  function switchSection(section) {
    if (!section) return;

    state.currentSection =
      section;

    $$(".page-section")
      .forEach((element) => {
        element.classList.toggle(
          "active",
          element.dataset.section === section
        );
      });

    $$(".nav-item")
      .forEach((element) => {
        element.classList.toggle(
          "active",
          element.dataset.section === section
        );
      });

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });

    if (section === "mutes") {
      loadMutes().catch(console.error);
    }

    if (section === "watches") {
      loadWatches().catch(console.error);
    }

    if (section === "history") {
      loadHistory().catch(console.error);
    }

    if (section === "events") {
      loadEvents().catch(console.error);
    }

    if (section === "dashboard") {
      refreshAll().catch(console.error);
    }
  }

  /*
  ==================================================
  REFRESH
  ==================================================
  */

  async function refreshAll() {
    if (state.loading) return;

    state.loading = true;

    try {
      await loadMe();
      await loadStats();

      await Promise.all([
        loadMutes(),
        loadWatches(),
        loadHistory(),
        loadEvents()
      ]);

      renderDashboard();
    } catch (error) {
      console.error(
        "REFRESH ERROR:",
        error
      );

      if (
        error.message.includes("401")
      ) {
        showToast(
          "Telegram авторизация не подтверждена",
          "error"
        );
      } else {
        showToast(
          error.message,
          "error"
        );
      }
    } finally {
      state.loading = false;
    }
  }

  /*
  ==================================================
  EVENTS
  ==================================================
  */

  function bindEvents() {
    document.addEventListener(
      "click",
      (event) => {
        const nav =
          event.target.closest(
            "[data-section]"
          );

        if (
          nav &&
          !event.target.closest(
            "button[type='submit']"
          )
        ) {
          const section =
            nav.dataset.section;

          if (section) {
            event.preventDefault();
            switchSection(section);
            return;
          }
        }

        const action =
          event.target.closest(
            "[data-action]"
          );

        if (!action) return;

        const type =
          action.dataset.action;

        if (type === "unmute") {
          removeMute(
            action.dataset.userId
          );
        }

        if (type === "remove-watch") {
          removeWatch(
            action.dataset.watchId
          );
        }

        if (type === "refresh") {
          refreshAll();
        }

        if (type === "ai-example") {
          const prompt =
            action.dataset.prompt || "";

          const input =
            $("#ai-input");

          if (input) {
            input.value = prompt;
            input.focus();
          }
        }
      }
    );

    const aiForm =
      $("#ai-form");

    if (aiForm) {
      aiForm.addEventListener(
        "submit",
        (event) => {
          event.preventDefault();
          sendAI();
        }
      );
    }

    const muteForm =
      $("#mute-form");

    if (muteForm) {
      muteForm.addEventListener(
        "submit",
        (event) => {
          event.preventDefault();
          createMute();
        }
      );
    }

    const watchForm =
      $("#watch-form");

    if (watchForm) {
      watchForm.addEventListener(
        "submit",
        (event) => {
          event.preventDefault();
          createWatch();
        }
      );
    }

    const sendForm =
      $("#send-form");

    if (sendForm) {
      sendForm.addEventListener(
        "submit",
        (event) => {
          event.preventDefault();
          sendMessage();
        }
      );
    }

    const refresh =
      $("#refresh-button");

    if (refresh) {
      refresh.addEventListener(
        "click",
        () => refreshAll()
      );
    }

    const aiInput =
      $("#ai-input");

    if (aiInput) {
      aiInput.addEventListener(
        "keydown",
        (event) => {
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
  AUTO UPDATE
  ==================================================
  */

  function startAutoRefresh() {
    setInterval(
      async () => {
        if (
          document.hidden ||
          state.loading
        ) {
          return;
        }

        try {
          await loadStats();

          if (
            state.currentSection ===
            "dashboard"
          ) {
            await loadMe();
          }

          if (
            state.currentSection ===
            "history"
          ) {
            await loadHistory();
          }

          if (
            state.currentSection ===
            "events"
          ) {
            await loadEvents();
          }

          if (
            state.currentSection ===
            "mutes"
          ) {
            await loadMutes();
          }

          if (
            state.currentSection ===
            "watches"
          ) {
            await loadWatches();
          }
        } catch (error) {
          console.error(
            "AUTO REFRESH ERROR:",
            error
          );
        }
      },
      15000
    );
  }

  /*
  ==================================================
  START
  ==================================================
  */

  async function start() {
    initTelegram();
    bindEvents();

    await refreshAll();

    startAutoRefresh();

    console.log(
      "%c STMA %c initialized ",
      "background:#8b5cf6;color:white;font-weight:bold;padding:4px 8px;border-radius:4px",
      "color:#a78bfa;font-weight:bold"
    );
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      start
    );
  } else {
    start();
  }

})();