// profit_parser.js — разбор сообщений публикации профита.
// Вынесено из bot.js, чтобы можно было юнит-тестировать и исключить
// случайную обработку служебных команд (/start 5000 1 и т.п.).

// Известные команды бота — если сообщение начинается с одной из них,
// это не публикация профита, даже если дальше идут числа.
const KNOWN_COMMANDS = [
  'start', 'me', 'top', 'топ', 'staff', 'materials', 'card',
  'keyboard', 'setcard', 'cards', 'broadcast', 'cancel', 'mute',
  'ban', 'updatepin', 'sendkeyboard', 'chatid', 'rass', 'bb', 'cur'
];

// Формат без слэша: username сумма направление (мамонт) — «richvladwork 10000 1»
// Направления: 1 — Кардинг, 2 — Прямой, 3 — Букмекер.
const TEXT_RE = /^(?!\/)([^\s]+)\s+(\d+)₽?\s+([123])(?:\s+\(?(\d+)\)?)?$/;

// Формат со слышом: /username сумма направление (мамонт) — «/richvladwork 5000 1»
const COMMAND_RE = /^\/([^\s]+)\s+(\d+)\s+([123])(?:\s+\(?(\d+)\)?)?$/;

function parseProfitText(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(TEXT_RE);
  if (!m) return null;
  return {
    username: m[1].replace(/^\/+/, '').replace(/@.+$/, ''),
    amount: parseInt(m[2], 10),
    direction: parseInt(m[3], 10),
    mammothCount: m[4] ? parseInt(m[4], 10) : null
  };
}

function parseProfitCommand(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(COMMAND_RE);
  if (!m) return null;

  // Токен команды без суффикса @Bot — если это известная команда, не профит.
  const token = m[1].replace(/@[\w_]+$/, '').toLowerCase();
  if (KNOWN_COMMANDS.includes(token)) return null;

  return {
    username: m[1],
    amount: parseInt(m[2], 10),
    direction: parseInt(m[3], 10),
    mammothCount: m[4] ? parseInt(m[4], 10) : null
  };
}

module.exports = {
  KNOWN_COMMANDS,
  parseProfitText,
  parseProfitCommand
};
