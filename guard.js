// guard.js — общая защита от повторной обработки событий и pending-ввод.
// Единая точка дедупликации callback-ов и управления ожиданием текстового ввода.

const callbackLog = new Map();
const CALLBACK_TTL_MS = 1000;

// Возвращает true, если callback можно обрабатывать (не дубликат в окне TTL).
// Ключ — userId + данные кнопки. Применяется во всех файлах с callback_query.
function shouldProcessCallback(userId, data, ttl = CALLBACK_TTL_MS) {
  if (userId == null || data == null) return false;
  const key = `${userId}\u0000${data}`;
  const now = Date.now();
  const last = callbackLog.get(key) || 0;
  if (now - last < ttl) return false;
  callbackLog.set(key, now);

  // Не даём Map бесконечно расти: чистим записи старше 10 секунд.
  if (callbackLog.size > 5000) {
    const cutoff = now - 10000;
    for (const [k, t] of callbackLog) {
      if (t < cutoff) callbackLog.delete(k);
    }
  }
  return true;
}

// Помечает callback как обработанный (например, после idempotency-переходов).
function markCallbackProcessed(userId, data) {
  if (userId == null || data == null) return;
  callbackLog.set(`${userId}\u0000${data}`, Date.now());
}

// ─── Ожидание текстового ввода (замена bot.once('message', ...)) ─────────────
// Каждый userId имеет максимум один pending-обработчик. Новый вызов
// setPendingInput перезаписывает старый — дубли-слушатели исключены.

const pendingInputs = new Map(); // userId -> { chatId, handler }

function setPendingInput(userId, chatId, handler) {
  if (userId == null) return;
  pendingInputs.set(userId, { chatId, handler });
}

function clearPendingInput(userId) {
  pendingInputs.delete(userId);
}

function hasPendingInput(userId) {
  return pendingInputs.has(userId);
}

// Вызывается в начале message-обработчика. Если у пользователя есть
// ожидающий ввод в этом чате — отдаём сообщение ему и возвращаем true,
// чтобы общий обработчик не разбирал сообщение повторно.
function dispatchPendingInput(msg) {
  if (!msg || msg.from == null) return false;
  const entry = pendingInputs.get(msg.from.id);
  if (!entry) return false;
  if (entry.chatId !== msg.chat.id) return false;
  entry.handler(msg);
  return true;
}

module.exports = {
  shouldProcessCallback,
  markCallbackProcessed,
  setPendingInput,
  clearPendingInput,
  hasPendingInput,
  dispatchPendingInput
};
