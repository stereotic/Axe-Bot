const db = require('./database');

// Статусы и их пороги
const STATUS_THRESHOLDS = [
  { status: 'NEW', threshold: 0 },
  { status: 'PRO', threshold: 30000 },
  { status: 'MASTER', threshold: 100000 },
  { status: 'GOAT', threshold: 300000 },
  { status: 'GOLD', threshold: 1000000 },
  { status: 'GG', threshold: 5000000 }
];

// Проценты по направлениям
const DIRECTION_PERCENTAGES = {
  1: 80, // Кардинг
  2: 75, // Прямой
  3: 70  // Букмекер
};

// Распределение долей
const PROFIT_SHARES = {
  owner: 6,
  admin: 4,
  investor: 5,
  coder: 5
};

/**
 * Получить статус по общей сумме профитов
 */
function getStatusByTotal(totalEarned) {
  let currentStatus = 'NEW';

  for (const { status, threshold } of STATUS_THRESHOLDS) {
    if (totalEarned >= threshold) {
      currentStatus = status;
    } else {
      break;
    }
  }

  return currentStatus;
}

/**
 * Обновить статус воркера
 */
function updateWorkerStatus(userId, callback) {
  db.get('SELECT status, total_earned FROM users WHERE user_id = ?', [userId], (err, user) => {
    if (err || !user) {
      if (callback) callback(err);
      return;
    }

    const oldStatus = user.status || 'NEW';
    const newStatus = getStatusByTotal(user.total_earned);

    if (newStatus === oldStatus) {
      if (callback) callback(null, newStatus);
      return;
    }

    db.run('UPDATE users SET status = ? WHERE user_id = ?', [newStatus, userId], (err) => {
      if (err) {
        if (callback) callback(err);
        return;
      }
      if (callback) callback(null, newStatus, oldStatus);
    });
  });
}

/**
 * Рассчитать сумму к выплате воркеру
 */
function calculateWorkerPayout(amount, direction) {
  const percentage = DIRECTION_PERCENTAGES[direction] || 80;
  return Math.floor(amount * percentage / 100);
}

/**
 * Рассчитать доли от профита
 */
function calculateProfitShares(amount) {
  const shares = {};
  const totalSharePercentage = Object.values(PROFIT_SHARES).reduce((a, b) => a + b, 0);

  for (const [role, percentage] of Object.entries(PROFIT_SHARES)) {
    shares[role] = Math.floor(amount * percentage / 100);
  }

  return shares;
}

/**
 * Получить место в топе
 */
function getTopPosition(userId, callback) {
  db.all(
    `SELECT user_id, SUM(amount) as total_profit
     FROM profits
     GROUP BY user_id
     HAVING total_profit > 0
     ORDER BY total_profit DESC, user_id ASC`,
    (err, users) => {
      if (err) {
        callback(err, 0);
        return;
      }

      const position = users.findIndex(u => u.user_id === userId) + 1;
      callback(null, position > 0 ? position : 0);
    }
  );
}

/**
 * Генерировать номер воркера
 */
function generateWorkerNumber(callback) {
  db.get('SELECT value FROM stats WHERE key = ?', ['worker_counter'], (err, row) => {
    if (err) {
      callback(err, null);
      return;
    }

    const currentCounter = parseInt(row?.value || '0');
    const newCounter = currentCounter + 1;

    db.run('INSERT OR REPLACE INTO stats (key, value) VALUES (?, ?)', ['worker_counter', newCounter.toString()], (err) => {
      if (err) {
        callback(err, null);
      } else {
        callback(null, newCounter);
      }
    });
  });
}

/**
 * Валидация имени воркера
 */
function validateWorkerName(name) {
  // Разрешены: русские, английские буквы, цифры, _, !, ?, $, ₽
  const regex = /^[a-zA-Zа-яА-Я0-9_!?$₽]+$/;
  return regex.test(name) && name.length >= 3 && name.length <= 20;
}

/**
 * Обновить статистику проекта
 */
function updateProjectStats(profitAmount, callback) {
  db.get('SELECT value FROM stats WHERE key = ?', ['project_balance'], (err, row) => {
    if (err) {
      if (callback) callback(err);
      return;
    }

    const currentBalance = parseInt(row?.value || '0');
    const newBalance = currentBalance + profitAmount;

    db.run('INSERT OR REPLACE INTO stats (key, value) VALUES (?, ?)', ['project_balance', newBalance.toString()], (err) => {
      if (err) {
        if (callback) callback(err);
        return;
      }

      db.get('SELECT value FROM stats WHERE key = ?', ['total_profits'], (err, row) => {
        if (err) {
          if (callback) callback(err);
          return;
        }

        const currentCount = parseInt(row?.value || '0');
        const newCount = currentCount + 1;

        db.run('INSERT OR REPLACE INTO stats (key, value) VALUES (?, ?)', ['total_profits', newCount.toString()], callback);
      });
    });
  });
}

/**
 * Получить название направления
 */
function getDirectionName(direction) {
  return direction === 1 ? 'Кардинг' : direction === 3 ? 'Букмекер' : 'Прямой';
}

// Исключения из топов (тестовые / служебные аккаунты)
const TOP_EXCLUDED_NAMES = ['#тестик', 'тестик', 'sss', '#testovhik', 'testovhik', '#sss', '#test', 'test'];
const TOP_EXCLUDED_USERNAMES = ['sss', 'freeobnall', 'test'];

function topExclusionWhere(alias = 'u') {
  const namesList = TOP_EXCLUDED_NAMES.map((n) => `'${n.replace(/'/g, "''")}'`).join(', ');
  const usersList = TOP_EXCLUDED_USERNAMES.map((n) => `'${n.replace(/'/g, "''")}'`).join(', ');
  const nameExpr = `LOWER(TRIM(COALESCE(${alias}.name, '')))`;
  const userExpr = `LOWER(TRIM(COALESCE(${alias}.username, '')))`;
  return `${nameExpr} NOT IN (${namesList})
    AND ${userExpr} NOT IN (${usersList})
    AND ${nameExpr} NOT LIKE '%тестик%'
    AND ${nameExpr} NOT LIKE '%testovhik%'`;
}

function formatAmount(amount) {
  return amount.toLocaleString('ru-RU').replace(/,/g, '.');
}

// Проценты бухгалтерии Букмекера сверх выплаты воркеру.
const BOOKMAKER_ACCOUNT_PERCENTAGES = { tp: 5, owner: 15 };

// Блок бухгалтерии Букмекера: суммы через '.' и только Тп/Владелец.
function buildBookmakerAccountingText({ username, amount, workerPayout, note = '' }) {
  const fmt = (n) => Number(n).toLocaleString('de-DE');
  const worker = String(username || '').replace(/^@+/, '');
  const tp = Math.floor(Number(amount) * BOOKMAKER_ACCOUNT_PERCENTAGES.tp / 100);
  const owner = Math.floor(Number(amount) * BOOKMAKER_ACCOUNT_PERCENTAGES.owner / 100);
  const body =
    `⚽️ Букмекер\n` +
    `<tg-emoji emoji-id="5920344347152224466">👤</tg-emoji>Воркер: @${worker}\n` +
    `💸Сумма профита: ${fmt(amount)}₽\n` +
    `<tg-emoji emoji-id="5258204546391351475">💼</tg-emoji>К выплате: ${fmt(workerPayout)}₽\n` +
    `👥 Тп: ${fmt(tp)}₽\n` +
    `👑Владелец: ${fmt(owner)}₽` +
    (note ? `\n${note}` : '');
  return `<b>${body}</b>`;
}

// Общий блок бухгалтерии: готовые суммы, а не проценты.
function buildAccountingText({ direction, directionName, username, amount, workerPayout, shares, note = '' }) {
  if (Number(direction) === 3) {
    return buildBookmakerAccountingText({ username, amount, workerPayout, note });
  }
  const fmt = (n) => Number(n).toLocaleString();
  const worker = String(username || '').replace(/^@+/, '');
  const body =
    `🚀${directionName}\n` +
    `<tg-emoji emoji-id="5920344347152224466">👤</tg-emoji>Воркер: @${worker}\n` +
    `💸Сумма профита: ${fmt(amount)}₽\n` +
    `<tg-emoji emoji-id="5258204546391351475">💼</tg-emoji>К выплате: ${fmt(workerPayout)}₽\n` +
    `👑Владелец: ${fmt(shares.owner)}₽\n` +
    `👔Администратор: ${fmt(shares.admin)}₽\n` +
    `🍌Инвестор: ${fmt(shares.investor)}₽\n` +
    `🧑‍💻Кодер: ${fmt(shares.coder)}₽` +
    (note ? `\n${note}` : '');
  return `<b>${body}</b>`;
}

// Общий чат проекта — эталон членства: юзер, состоящий в нём, считается зарегистрированным.
const MEMBER_CHAT_ID = '-1003986505552';

// Премиум-эмодзи публикации профита: до 50к — один набор, свыше — другой.
const PROFIT_EMOJI_THRESHOLD = 50000;
const PROFIT_EMOJI_SETS = {
  small: {
    header: '5444984118519573636',
    service: '5445006366450164917',
    worker: '5445214049593766654',
    amount: '5445152270784178138'
  },
  large: {
    header: '5444984118519573636',
    service: '5451767267744328949',
    worker: '5451735570885680691',
    amount: '5451805523018033441'
  }
};

function profitEmojiSet(amount) {
  return Number(amount) > PROFIT_EMOJI_THRESHOLD ? PROFIT_EMOJI_SETS.large : PROFIT_EMOJI_SETS.small;
}

function tgEmoji(id, fallback) {
  return `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;
}

function isSubscribedChatMember(member) {
  if (!member) return false;
  if (['member', 'administrator', 'creator'].includes(member.status)) return true;
  // Ограниченный участник чата всё ещё считается подписанным
  if (member.status === 'restricted' && member.is_member) return true;
  return false;
}

// Если юзер отсутствует в БД или не одобрен — пускаем по факту членства в общем чате
// и чиним запись (создаём/ставим application_approved = 1). Возвращает true при допуске.
function ensureMemberAccess(bot, userId, contact) {
  return new Promise((resolve) => {
    bot.getChatMember(MEMBER_CHAT_ID, userId)
      .then((member) => {
        if (!isSubscribedChatMember(member)) return resolve(false);
        const username = (contact && contact.username) || '';
        db.get('SELECT user_id FROM users WHERE user_id = ?', [userId], (err, existing) => {
          if (!err && existing) {
            db.run(
              'UPDATE users SET application_approved = 1, username = COALESCE(NULLIF(?, ""), username) WHERE user_id = ?',
              [username, userId],
              () => resolve(true)
            );
          } else {
            db.run(
              'INSERT OR IGNORE INTO users (user_id, username, name, status, application_approved, welcome_keyboard_sent) VALUES (?, ?, ?, ?, 1, 1)',
              [userId, username, username || '#', 'NEW'],
              () => resolve(true)
            );
          }
        });
      })
      .catch(() => resolve(false));
  });
}

module.exports = {
  STATUS_THRESHOLDS,
  DIRECTION_PERCENTAGES,
  PROFIT_SHARES,
  MEMBER_CHAT_ID,
  getStatusByTotal,
  updateWorkerStatus,
  calculateWorkerPayout,
  calculateProfitShares,
  getTopPosition,
  generateWorkerNumber,
  validateWorkerName,
  updateProjectStats,
  getDirectionName,
  topExclusionWhere,
  formatAmount,
  buildAccountingText,
  profitEmojiSet,
  tgEmoji,
  isSubscribedChatMember,
  ensureMemberAccess
};
