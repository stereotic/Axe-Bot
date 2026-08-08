const db = require('./database');
const utils = require('./utils');

// Порядок статусов по возрастанию (см. STATUS_THRESHOLDS в utils.js)
const CHAT_STATUS_ORDER = ['NEW', 'PRO', 'MASTER', 'GOAT', 'GOLD', 'GG'];

// Ссылки открытых чатов (панель «Информация»)
const OPEN_CHAT_LINKS = {
  general: 'https://t.me/+1EwzBdEWNQgxYWFi',
  profits: 'https://t.me/+euO9gzLMUMFhNmJi',
  news: 'https://t.me/+BO1F4O1KUd0zZTI6',
  materials: 'https://t.me/+GMixQrZvJkQ4ODE6'
};

// Закрытые чаты: разблокируются при достижении unlockStatus.
const STATUS_CHATS = [
  {
    key: 'newpro',
    label: 'NEW-PRO',
    unlockStatus: 'NEW',
    link: 'https://t.me/+_-RftIj7dlY4NGUy'
  },
  {
    key: 'mastergoat',
    label: 'MASTER-GOAT',
    unlockStatus: 'MASTER',
    link: 'https://t.me/+Mj1i5fFnJnk2Nzgy'
  },
  {
    key: 'goldgg',
    label: 'GOLD-GG',
    unlockStatus: 'GOLD',
    link: 'https://t.me/+gzMrBxBptsw5NWIy'
  }
];

const CONGRATS_EMOJI = { id: '5994502837327892086', fallback: '🎉' };

const statusRank = (status) => CHAT_STATUS_ORDER.indexOf(status);

const isChatUnlocked = (status, chat) => {
  const r = statusRank(status);
  return r >= 0 && r >= statusRank(chat.unlockStatus);
};

const getChatByKey = (key) => STATUS_CHATS.find((c) => c.key === key);

const getStatus = (userId) => new Promise((resolve) => {
  db.get('SELECT total_earned FROM users WHERE user_id = ?', [userId], (err, user) => {
    resolve((!err && user) ? utils.getStatusByTotal(user.total_earned || 0) : 'NEW');
  });
});

// Кнопки трёх закрытых чатов: 🔒 пока закрыт, 💬 когда разблокирован.
const buildChatButtons = (status) => {
  return STATUS_CHATS.map((chat) => {
    if (isChatUnlocked(status, chat)) {
      return { text: `${chat.label} 💬`, url: chat.link };
    }
    return { text: `${chat.label} 🔒`, callback_data: `chat_locked_${chat.key}` };
  });
};

// Клавиатура панели «Информация»
const buildInfoKeyboard = (status) => ({
  inline_keyboard: [
    [{ text: 'Общий чат 💬', url: OPEN_CHAT_LINKS.general }],
    buildChatButtons(status),
    [
      { text: '💸Профиты', url: OPEN_CHAT_LINKS.profits },
      { text: '📢Новости', url: OPEN_CHAT_LINKS.news }
    ],
    [{ text: '📁Материалы', url: OPEN_CHAT_LINKS.materials }]
  ]
});

const buildInfoKeyboardForUser = async (userId) => {
  const status = await getStatus(userId);
  return buildInfoKeyboard(status);
};

// Отправляет воркеру уведомления о всех чатах, которые ему уже доступны, но ещё не отправлены.
// Один чат — одно уведомление за всё время (таблица chat_unlocks).
const sendPendingUnlocks = (bot, userId, status) => new Promise((resolve) => {
  db.all('SELECT chat_key FROM chat_unlocks WHERE user_id = ?', [userId], (err, rows) => {
    const sent = new Set((rows || []).map((r) => r.chat_key));
    const pending = STATUS_CHATS.filter((c) => !sent.has(c.key) && isChatUnlocked(status, c));

    let i = 0;
    const next = () => {
      if (i >= pending.length) return resolve();
      const chat = pending[i++];
      bot.sendMessage(
        userId,
        `<b><tg-emoji emoji-id="${CONGRATS_EMOJI.id}">${CONGRATS_EMOJI.fallback}</tg-emoji>Поздравляем тебе доступен чат уровня ${chat.label}</b>`,
        { parse_mode: 'HTML' }
      ).catch(() => {}).finally(() => {
        db.run('INSERT OR IGNORE INTO chat_unlocks (user_id, chat_key) VALUES (?, ?)', [userId, chat.key], () => next());
      });
    };
    next();
  });
});

// Стартовая миграция: существующим воркерам с уже набранными статусами шлём уведомления
// по действующему статусу и всем пройденным ранее.
const migrateExistingWorkers = (bot) => {
  db.all('SELECT user_id, total_earned FROM users WHERE application_approved = 1', (err, users) => {
    if (err || !users) {
      console.error('Error loading users for chat migration:', err);
      return;
    }
    users.forEach((u) => sendPendingUnlocks(bot, u.user_id, utils.getStatusByTotal(u.total_earned || 0)));
  });
};

module.exports = {
  CHAT_STATUS_ORDER,
  STATUS_CHATS,
  OPEN_CHAT_LINKS,
  statusRank,
  isChatUnlocked,
  getChatByKey,
  getStatus,
  buildChatButtons,
  buildInfoKeyboard,
  buildInfoKeyboardForUser,
  sendPendingUnlocks,
  migrateExistingWorkers
};
