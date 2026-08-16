const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const state = {
  user: null,
  connected: false,
  connection: null,
  stats: {messages:0,edits:0,deleted:0,events:0}
};

function headers() {
  return {
    "Content-Type": "application/json",
    "X-Telegram-Init-Data": tg?.initData || ""
  };
}

async function api(url, options={}) {
  const r = await fetch(url, {...options, headers:{...headers(),...(options.headers||{})}});
  const data = await r.json().catch(()=>({ok:false,error:"Ошибка ответа сервера"}));
  if (!r.ok && data.error) throw new Error(data.error);
  return data;
}

function esc(v) {
  return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

function toast(text) {
  const el=document.getElementById("toast");
  el.textContent=text; el.classList.add("show");
  clearTimeout(window.__toast);
  window.__toast=setTimeout(()=>el.classList.remove("show"),2200);
}

async function start() {
  try {
    const data=await api("/api/me");
    if(data.ok){
      state.user=data.user;
      state.connected=data.connected;
      state.connection=data.connection;
      state.stats=data.stats||state.stats;
    }
  } catch(e) { console.error(e); }
  setTimeout(()=>{
    document.getElementById("splash").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    openPage("home");
  },650);
}

function updateStatus() {
  const el=document.getElementById("status");
  if(el) el.textContent=state.connected ? "● Подключено" : "○ Не подключено";
}

function setNav(page) {
  document.querySelectorAll(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.page===page));
}

function openPage(page) {
  setNav(page);
  const c=document.getElementById("content");
  if(page==="home") renderHome(c);
  else if(page==="ai") renderAI(c);
  else if(page==="protection") renderProtection(c);
  else if(page==="watch") renderWatch(c);
  else if(page==="actions") renderActions(c);
  else if(page==="history") renderHistory(c);
  else if(page==="stats") renderStats(c);
  else if(page==="settings") renderSettings(c);
  else if(page==="help") renderHelp(c);
}

function renderHome(el) {
  const name=esc(state.user?.first_name||"друг");
  el.innerHTML=`
    <section class="greeting">
      <h1>Привет, ${name} 👋</h1>
      <p>Что будем делать?</p>
    </section>

    <div class="stats">
      <div class="stat"><div class="stat-value">${state.stats.messages}</div><div class="stat-name">Сообщений</div></div>
      <div class="stat"><div class="stat-value">${state.stats.edits}</div><div class="stat-name">Изменений</div></div>
      <div class="stat"><div class="stat-value">${state.stats.deleted}</div><div class="stat-name">Удалений</div></div>
    </div>

    <div class="grid">
      ${card("✦","STMA AI","Управление обычным текстом","ai")}
      ${card("🔇","Защита","Мут и автоудаление","protection")}
      ${card("✉️","Сообщения","Отправка и таймер","actions")}
      ${card("🕵️","Слежка","До 10 целей","watch")}
      ${card("📜","История","Сообщения и события","history")}
      ${card("📊","Статистика","Активность","stats")}
    </div>
  `;
  updateStatus();
}

function card(icon,title,sub,page) {
  return `<div class="card clickable" onclick="openPage('${page}')"><div class="card-icon">${icon}</div><div class="card-title">${title}</div><div class="card-subtitle">${sub}</div></div>`;
}

function renderAI(el) {
  el.innerHTML=`
    <div class="page-title">STMA AI</div>
    <div class="card ai-box">
      <div id="messages" class="messages">
        <div class="ai-message bot">Привет 👋<br><br>Напиши, что нужно сделать.<br><br>Например: <b>замуть @username на 30 минут</b></div>
      </div>
      <div class="ai-input">
        <input id="aiInput" placeholder="Что сделать?" onkeydown="if(event.key==='Enter')sendAI()">
        <button class="send-button" onclick="sendAI()">➤</button>
      </div>
    </div>
  `;
}

async function sendAI() {
  const input=document.getElementById("aiInput");
  const box=document.getElementById("messages");
  const prompt=input.value.trim();
  if(!prompt)return;
  box.innerHTML+=`<div class="ai-message user">${esc(prompt)}</div>`;
  input.value="";
  try {
    const data=await api("/api/ai",{method:"POST",body:JSON.stringify({prompt})});
    box.innerHTML+=`<div class="ai-message bot">${esc(data.reply||"Не удалось обработать запрос.")}</div>`;
  } catch(e) {
    box.innerHTML+=`<div class="ai-message bot">Ошибка: ${esc(e.message)}</div>`;
  }
  box.scrollTop=box.scrollHeight;
}

async function renderProtection(el) {
  let users=[];
  try { users=(await api("/api/mutes")).users||[]; } catch(e){}
  el.innerHTML=`
    <div class="page-title">🔇 Защита</div>
    <div class="card">
      <div class="label">Telegram ID пользователя</div>
      <input id="muteUser" class="input" inputmode="numeric" placeholder="Например: 123456789">
      <div class="label">Срок</div>
      <select id="muteDuration" class="select">
        <option>10 секунд</option><option>1 минута</option><option>5 минут</option>
        <option>30 минут</option><option>1 час</option><option>24 часа</option><option>Навсегда</option>
      </select>
      <button class="primary" onclick="muteUser()">🔇 Замутить</button>
      <div class="card-subtitle">Для @username удобнее использовать AI или команду .mute ответом на сообщение пользователя.</div>
    </div>
    <div class="page-title">Активные</div>
    <div class="list">
      ${users.length ? users.map(u=>`
        <div class="list-item">
          <div><div class="list-title">${esc(u.username||u.user_id)}</div><div class="list-subtitle">${u.expires_at?new Date(u.expires_at*1000).toLocaleString():"Навсегда"}</div></div>
          <button class="icon-button" onclick="unmuteUser(${Number(u.user_id)})">🔊</button>
        </div>`).join("") : `<div class="empty">Нет активных мутов</div>`}
    </div>
  `;
}

async function muteUser() {
  const user=document.getElementById("muteUser").value.trim();
  const duration=document.getElementById("muteDuration").value;
  if(!/^\d+$/.test(user)) return toast("Нужен Telegram ID");
  try { await api("/api/mute",{method:"POST",body:JSON.stringify({user_id:user,duration})}); toast("Пользователь замьючен"); renderProtection(document.getElementById("content")); } catch(e){toast(e.message)}
}

async function unmuteUser(user) {
  try { await api("/api/unmute",{method:"POST",body:JSON.stringify({user_id:user})}); toast("Мут снят"); renderProtection(document.getElementById("content")); } catch(e){toast(e.message)}
}

async function renderActions(el) {
  el.innerHTML=`
    <div class="page-title">✉️ Сообщения</div>
    <div class="card form">
      <div class="label">Получатель — Telegram chat ID</div>
      <input id="sendChat" class="input" inputmode="numeric" placeholder="Например: 123456789">
      <div class="label">Сообщение</div>
      <textarea id="sendText" class="textarea" placeholder="Введите сообщение..."></textarea>
      <div class="label">Удалить через</div>
      <select id="sendDelete" class="select">
        <option value="0">Не удалять</option><option value="10">10 секунд</option><option value="30">30 секунд</option>
        <option value="60">1 минута</option><option value="300">5 минут</option><option value="900">15 минут</option><option value="3600">1 час</option>
      </select>
      <label class="label"><input id="oneTime" type="checkbox"> Одноразовое сообщение</label>
      <button class="primary" onclick="sendMessage()">➤ Отправить</button>
    </div>
    <div class="card"><div class="card-title">Важно</div><div class="card-subtitle">Сообщения и действия не сопровождаются служебным текстом в чате. Управление остаётся внутри STMA.</div></div>
  `;
}

async function sendMessage() {
  const chat=document.getElementById("sendChat").value.trim();
  const text=document.getElementById("sendText").value.trim();
  const del=Number(document.getElementById("sendDelete").value);
  const one=document.getElementById("oneTime").checked;
  if(!/^-?\d+$/.test(chat)||!text)return toast("Заполни получателя и сообщение");
  try {
    await api("/api/send",{method:"POST",body:JSON.stringify({chat_id:chat,text,delete_after:del,one_time:one})});
    document.getElementById("sendText").value="";
    toast("Сообщение отправлено");
  } catch(e){toast(e.message)}
}

async function renderWatch(el) {
  let watches=[];
  try { watches=(await api("/api/watches")).watches||[]; } catch(e){}
  el.innerHTML=`
    <div class="page-title">🕵️ Слежка</div>
    <div class="card">
      <div class="card-title">Слежка за профилями</div>
      <div class="card-subtitle">До 10 целей. STMA сохраняет цели и проверяет только те данные, которые доступны этому Bot API подключению.</div>
      <div style="height:12px"></div>
      <input id="watchTarget" class="input" placeholder="@username или ID">
      <button class="primary" onclick="addWatch()">＋ Добавить</button>
    </div>
    <div class="list">
      ${watches.length?watches.map(w=>`
        <div class="list-item"><div><div class="list-title">${esc(w.target)}</div><div class="list-subtitle">${w.enabled?"Активна":"Выключена"}</div></div><button class="icon-button" onclick="removeWatch(${w.id})">×</button></div>
      `).join(""):`<div class="empty">Пока нет активных слежек</div>`}
    </div>
    <div class="card" style="margin-top:10px"><div class="card-title">Что реально отслеживается</div><div class="card-subtitle">STMA не притворяется userbot-клиентом: произвольные Premium, подарки, музыка и Star Rating обычный Bot API не предоставляет.</div></div>
  `;
}

async function addWatch() {
  const target=document.getElementById("watchTarget").value.trim();
  if(!target)return;
  try { await api("/api/watches",{method:"POST",body:JSON.stringify({target})}); toast("Цель добавлена"); renderWatch(document.getElementById("content")); } catch(e){toast(e.message)}
}
async function removeWatch(id) {
  await api("/api/watches/"+id,{method:"DELETE"});
  renderWatch(document.getElementById("content"));
}

async function renderHistory(el) {
  let messages=[],events=[];
  try { messages=(await api("/api/history")).messages||[]; events=(await api("/api/events")).events||[]; } catch(e){}
  el.innerHTML=`
    <div class="page-title">📜 История</div>
    <div class="section-title">Сообщения</div>
    <div class="list">
      ${messages.length?messages.map(m=>`<div class="list-item"><div><div class="list-title">${esc(m.sender_username?"@"+m.sender_username:m.sender_name||m.sender_id||"Unknown")}</div><div class="list-subtitle">${esc(m.text||"[медиа]")}</div></div></div>`).join(""):`<div class="empty">История пуста</div>`}
    </div>
    <div class="section-title" style="margin-top:18px">События</div>
    <div class="list">
      ${events.length?events.map(e=>`<div class="event"><strong>${esc(e.type)}</strong><small>${new Date(e.created_at*1000).toLocaleString()}</small></div>`).join(""):`<div class="empty">Событий пока нет</div>`}
    </div>
  `;
}

function renderStats(el) {
  el.innerHTML=`
    <div class="page-title">📊 Статистика</div>
    <div class="stats">
      <div class="stat"><div class="stat-value">${state.stats.messages}</div><div class="stat-name">Сообщений</div></div>
      <div class="stat"><div class="stat-value">${state.stats.edits}</div><div class="stat-name">Изменений</div></div>
      <div class="stat"><div class="stat-value">${state.stats.deleted}</div><div class="stat-name">Удалений</div></div>
    </div>
    <div class="card"><div class="card-title">События</div><div class="card-subtitle">${state.stats.events} событий записано в журнал.</div></div>
  `;
}

function renderSettings(el) {
  el.innerHTML=`
    <div class="page-title">⚙️ Настройки</div>
    <div class="card"><div class="card-title">🔕 Тихие действия</div><div class="card-subtitle">Муты, отправка, автоудаление и другие операции не отправляют служебные сообщения в чаты. Результаты доступны в STMA.</div></div>
    <div class="card"><div class="card-title">🔗 Подключение</div><div class="card-subtitle">${state.connected?"Подключение активно":"Подключение не найдено"}</div></div>
    <div class="card"><div class="card-title">❓ Помощь</div><div class="card-subtitle">Открой раздел помощи, чтобы посмотреть возможности STMA.</div><button class="secondary" onclick="openPage('help')">Открыть помощь</button></div>
  `;
}

function renderHelp(el) {
  el.innerHTML=`
    <div class="page-title">❓ Помощь</div>
    <div class="card">
      <div class="card-title">STMA AI</div>
      <div class="card-subtitle">Пиши обычным текстом: «замуть 123456789 на 30 минут».</div>
    </div>
    <div class="card">
      <div class="card-title">🔇 Защита</div>
      <div class="card-subtitle">Мут сохраняется на сервере. Когда от замьюченного пользователя приходит новое сообщение, STMA пытается удалить его автоматически.</div>
    </div>
    <div class="card">
      <div class="card-title">✉️ Сообщения</div>
      <div class="card-subtitle">Можно отправить сообщение и поставить таймер удаления.</div>
    </div>
    <div class="card">
      <div class="card-title">🕵️ Слежка</div>
      <div class="card-subtitle">До 10 целей. Набор доступных данных зависит от Telegram Bot API.</div>
    </div>
  `;
}

document.addEventListener("click", e=>{
  const nav=e.target.closest(".nav-item");
  if(nav) openPage(nav.dataset.page);
});

start();
