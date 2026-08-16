const db = require("./database");

function textOf(message) {
  return message?.text || message?.caption || "";
}

function parseCommand(text) {
  if (!text || !text.startsWith(".")) return null;
  const parts = text.trim().split(/\s+/);
  return {
    command: parts[0].slice(1).toLowerCase(),
    args: parts.slice(1)
  };
}

function durationSeconds(value) {
  if (!value) return null;
  const s = String(value).toLowerCase().replace(",", ".");
  const match = s.match(/^(\d+(?:\.\d+)?)\s*(s|sec|сек|m|min|мин|h|час|ч|d|д)?$/);
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2] || "m";
  if (!Number.isFinite(n) || n <= 0) return null;
  if (["s","sec","сек"].includes(unit)) return Math.round(n);
  if (["h","час","ч"].includes(unit)) return Math.round(n * 3600);
  if (["d","д"].includes(unit)) return Math.round(n * 86400);
  return Math.round(n * 60);
}

function parseMuteDuration(args) {
  if (!args.length) return null;
  return durationSeconds(args.slice(1).join(" "));
}

function resolveUserId(message, args) {
  if (message?.reply_to_message?.from?.id) {
    return Number(message.reply_to_message.from.id);
  }
  const raw = args[0];
  if (raw && /^\d+$/.test(raw)) return Number(raw);
  return null;
}

async function callTelegram(token, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!data.ok) throw new Error(data.description || "Telegram API error");
  return data.result;
}

async function deleteBusinessMessages(token, connectionId, messageIds) {
  if (!messageIds?.length) return;
  for (let i = 0; i < messageIds.length; i += 100) {
    await callTelegram(token, "deleteBusinessMessages", {
      business_connection_id: connectionId,
      message_ids: messageIds.slice(i, i + 100)
    });
  }
}

async function sendBusinessMessage(token, connectionId, chatId, text) {
  return callTelegram(token, "sendMessage", {
    business_connection_id: connectionId,
    chat_id: chatId,
    text
  });
}

function ownerId() {
  const v = process.env.OWNER_ID || db.getSetting("owner_id");
  return v ? Number(v) : null;
}

async function executeCommand(message, connectionId, services) {
  const parsed = parseCommand(textOf(message));
  if (!parsed) return false;

  const { command, args } = parsed;
  const chatId = message?.chat?.id;
  if (chatId == null) return true;

  if (command === "mute") {
    const userId = resolveUserId(message, args);
    if (!userId) return true;
    const seconds = parseMuteDuration(args);
    const expires = seconds ? Math.floor(Date.now()/1000) + seconds : null;
    db.addMute(connectionId, userId, message?.reply_to_message?.from?.username || null, expires);
    db.addEvent({ connectionId, type: "mute", chatId, data: { userId, expires } });
    return true;
  }

  if (command === "unmute") {
    const userId = resolveUserId(message, args);
    if (!userId) return true;
    db.removeMute(connectionId, userId);
    db.addEvent({ connectionId, type: "unmute", chatId, data: { userId } });
    return true;
  }

  if (command === "watch") {
    const target = args[0];
    if (!target) return true;
    try {
      db.addWatch(connectionId, target);
      db.addEvent({ connectionId, type: "watch_add", chatId, data: { target } });
    } catch {}
    return true;
  }

  if (command === "t") {
    let delay = 0.08;
    let text = args.join(" ");
    if (args[0] && !Number.isNaN(Number(args[0]))) {
      delay = Math.max(0.03, Math.min(1, Number(args[0])));
      text = args.slice(1).join(" ");
    }
    if (!text) return true;
    const sent = await sendBusinessMessage(services.token, connectionId, chatId, "▌");
    let current = "";
    for (const char of text) {
      current += char;
      await new Promise(r => setTimeout(r, delay * 1000));
      try {
        await callTelegram(services.token, "editMessageText", {
          business_connection_id: connectionId,
          chat_id: chatId,
          message_id: sent.message_id,
          text: current + "▌"
        });
      } catch {}
    }
    try {
      await callTelegram(services.token, "editMessageText", {
        business_connection_id: connectionId,
        chat_id: chatId,
        message_id: sent.message_id,
        text
      });
    } catch {}
    return true;
  }

  return false;
}

async function handleUpdate(update, services) {
  const token = services.token;

  if (update.business_connection) {
    const c = update.business_connection;
    db.saveBusinessConnection(c);
    db.addEvent({
      connectionId: c.id,
      type: c.is_enabled ? "business_connected" : "business_disconnected",
      data: c
    });
    return;
  }

  const message = update.business_message || update.edited_business_message;
  if (message) {
    const connectionId = message.business_connection_id;
    const isEdit = Boolean(update.edited_business_message);

    if (isEdit) {
      db.markEdited(message, connectionId);
      db.addEvent({
        connectionId,
        type: "edited_message",
        chatId: message.chat?.id,
        messageId: message.message_id,
        data: message
      });
      return;
    }

    db.saveMessage(message, connectionId);
    db.addEvent({
      connectionId,
      type: "new_message",
      chatId: message.chat?.id,
      messageId: message.message_id,
      data: message
    });

    const fromId = Number(message.from?.id || 0);
    const isOwner = ownerId() && fromId === ownerId();

    if (isOwner) {
      await executeCommand(message, connectionId, services);
      return;
    }

    if (fromId && db.isMuted(connectionId, fromId)) {
      try {
        await deleteBusinessMessages(token, connectionId, [message.message_id]);
        db.markDeleted(connectionId, message.chat?.id, [message.message_id]);
        db.addEvent({
          connectionId,
          type: "mute_delete",
          chatId: message.chat?.id,
          messageId: message.message_id,
          data: { userId: fromId }
        });
      } catch (error) {
        db.addEvent({
          connectionId,
          type: "mute_delete_error",
          chatId: message.chat?.id,
          messageId: message.message_id,
          data: { error: error.message }
        });
      }
    }
    return;
  }

  if (update.deleted_business_messages) {
    const d = update.deleted_business_messages;
    db.markDeleted(d.business_connection_id, d.chat?.id, d.message_ids || []);
    db.addEvent({
      connectionId: d.business_connection_id,
      type: "deleted_messages",
      chatId: d.chat?.id,
      data: d
    });
  }
}

async function processDueDeletes(services) {
  const due = db.getDueDeletes();
  for (const item of due) {
    try {
      await deleteBusinessMessages(services.token, item.connection_id, [item.message_id]);
      db.markDeleteDone(item.id);
      db.markDeleted(item.connection_id, item.chat_id, [item.message_id]);
      db.addEvent({
        connectionId: item.connection_id,
        type: "scheduled_delete",
        chatId: item.chat_id,
        messageId: item.message_id,
        data: {}
      });
    } catch (error) {
      db.addEvent({
        connectionId: item.connection_id,
        type: "scheduled_delete_error",
        chatId: item.chat_id,
        messageId: item.message_id,
        data: { error: error.message }
      });
      db.markDeleteDone(item.id);
    }
  }
}

module.exports = {
  callTelegram,
  deleteBusinessMessages,
  sendBusinessMessage,
  handleUpdate,
  processDueDeletes
};
