// auto_profits.js — авто-публикация фейковых профитов в кассу и чат.
// /res — меню управления: активные пользователи, добавление/редактирование,
// расписание (суммы, направление, время, частота), вкл/выкл, удаление.
// Профиль таких воркеров при переходе по ссылке показывает «Аккаунт закрыт».

const db = require('./database');
const guard = require('./guard');
const utils = require('./utils');
const battlepass = require('./battlepass');
const statusChats = require('./status_chats');
const { updatePinnedMessage } = require('./update_pinned');
const { sendPrizeNotifications } = require('./prize_notifications');

const CASH_CHANNEL_ID = '-1003924744333'; // Общая касса
const GENERAL_CHAT_ID = '-1003986505552'; // Общий чат

// Базовый «псевдо-ID» фейковых воркеров. Реальные Telegram ID меньше этой
// границы, поэтому по ссылке профиля несложно понять, что это авто-аккаунт.
const AUTO_USER_ID_BASE = 900000000000;

const DIR_LABEL = { 1: 'кд', 2: 'пр', 3: 'бк' };
const DIR_FULL = { 1: 'Кардинг', 2: 'Прямой', 3: 'Букмекер' };

const addFlow = {};   // userId -> состояние добавления пользователя
const editFlow = {};  // userId -> состояние редактирования (поле/значение)
const panelMsg = {};  // userId -> id открытой карточки пользователя
const lastCallback = {};
const publishing = new Set(); // защита от двойной публикации одного юзера

let autoAdminIds = [];

function dedupeCallback(userId, data) {
  const key = `${userId}\u0000${data}`;
  const now = Date.now();
  if (lastCallback[key] && now - lastCallback[key] < 800) return false;
  lastCallback[key] = now;
  return true;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmt(n) {
  return Number(n || 0).toLocaleString('de-DE');
}

function dirLabel(d) {
  return DIR_LABEL[d] || '?';
}

function dirFull(d) {
  return DIR_FULL[d] || `#${d}`;
}

function plainName(name) {
  return String(name || '').replace(/^[@#]+/, '').trim();
}

// Текущее время в минутах по Москве (UTC+3) — проект целиком в МСК.
function moscowMinutes() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour12: false,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return Number(get('hour')) * 60 + Number(get('minute'));
}

// Суммы: «5000 8000 12000» / «5000,8000» — список, бот выбирает случайно.
function parseAmounts(str) {
  const nums = String(str)
    .split(/[\s,;]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 1000000000);
  return nums.length ? nums : null;
}

// Время работы: «13-19». from <= to — дневной диапазон, from > to — ночной.
function parseTimeRange(str) {
  const m = String(str).trim().match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
  if (!m) return null;
  const from = parseInt(m[1], 10);
  const to = parseInt(m[2], 10);
  if (from < 0 || from > 23 || to < 0 || to > 23) return null;
  return { time_from: from, time_to: to };
}

// Частота: «60» или «45-120» (минуты между профитами).
function parseInterval(str) {
  const m = String(str).trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
  if (!m) return null;
  const a = parseInt(m[1], 10);
  const b = m[2] ? parseInt(m[2], 10) : a;
  if (a <= 0 || b < a || b > 24 * 60) return null;
  return { interval_from: a, interval_to: b };
}

// Попадание в рабочий диапазон часов (МСК). from<=to — дневной, from>to — через полночь.
function inTimeWindow(from, to, mins) {
  if (from <= to) return mins >= from * 60 && mins < (to + 1) * 60;
  return mins >= from * 60 || mins < (to + 1) * 60;
}

// Случайный интервал из заданного диапазона частоты.
function pickNextInterval(user) {
  const a = user.interval_from || 60;
  const b = Math.max(a, user.interval_to || a);
  const span = b - a;
  return a + (span > 0 ? Math.floor(Math.random() * (span + 1)) : 0);
}

// Публичный текст «Касса/Чат» — тот же формат, что в bot.js buildPublicText.
function buildPublicText(profit) {
  const profileLink = `https://t.me/${process.env.BOT_USERNAME || 'AXE_xBOT'}?start=profile_${profit.userId}`;
  const worker = plainName(profit.username || profit.name);

  if (profit.direction === 3) {
    return `<b>🌸 УСПЕШНЫЙ ПРОФИТ🌸

<tg-emoji emoji-id="5287744906251510022">🏠</tg-emoji>Сервис: Букмекер
┣<tg-emoji emoji-id="5936017305585586269">👤</tg-emoji>Воркер: <a href="${profileLink}">#${escapeHtml(worker)}</a>
┗<tg-emoji emoji-id="5769403330761593044">💸</tg-emoji>Сумма: ${fmt(profit.amount)}₽</b>`;
  }

  return `<b>🌸УСПЕШНЫЙ ПРОФИТ🌸

<tg-emoji emoji-id="5287744906251510022">🏠</tg-emoji>Сервис: ${profit.directionName}
┣<tg-emoji emoji-id="5936017305585586269">👤</tg-emoji>Воркер: <a href="${profileLink}">#${escapeHtml(worker)}</a>
┗<tg-emoji emoji-id="5769403330761593044">💸</tg-emoji>Сумма: ${fmt(profit.amount)}₽</b>`;
}

function editOrSend(bot, chatId, messageId, text, opts = {}) {
  if (messageId) {
    return bot
      .editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts })
      .catch(() => bot.sendMessage(chatId, text, opts));
  }
  return bot.sendMessage(chatId, text, opts);
}

function renderMain(bot, chatId, messageId) {
  const text = `🤖 <b>Авто-публикация профитов</b>

Профиты автоматически публикуются в кассу и чат по расписанию.`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '👥 Активные пользователи', callback_data: 'ap_list' }],
      [{ text: '➕ Добавить пользователя', callback_data: 'ap_add' }]
    ]
  };
  editOrSend(bot, chatId, messageId, text, { parse_mode: 'HTML', reply_markup: keyboard });
}

function userLine(u) {
  return `${plainName(u.name)} | ${fmt(u.total_amount)}₽ | ${u.profit_count} | ${dirLabel(u.direction)} | ${u.time_from}-${u.time_to} | ${u.enabled ? '✅' : '⛔️'}`;
}

function renderList(bot, chatId, messageId) {
  db.all('SELECT * FROM auto_profit_users ORDER BY id ASC', (err, users) => {
    const rows = err ? [] : (users || []);
    let text;
    if (rows.length) {
      text = `👥 <b>Активные пользователи</b>\n\n${rows.map((u) => `<b>${escapeHtml(userLine(u))}</b>`).join('\n')}`;
    } else {
      text = '👥 <b>Активные пользователи</b>\n\nПока никого нет.';
    }

    const keyboard = { inline_keyboard: [] };
    rows.forEach((u) => {
      keyboard.inline_keyboard.push([{ text: userLine(u), callback_data: `ap_open_${u.id}` }]);
    });
    keyboard.inline_keyboard.push([{ text: '➕ Добавить', callback_data: 'ap_add' }]);
    keyboard.inline_keyboard.push([{ text: '◀️ Назад', callback_data: 'ap_main' }]);

    editOrSend(bot, chatId, messageId, text, { parse_mode: 'HTML', reply_markup: keyboard });
  });
}

function renderPanel(bot, chatId, userId, autoId) {
  db.get('SELECT * FROM auto_profit_users WHERE id = ?', [autoId], (err, u) => {
    if (err || !u) {
      editOrSend(bot, chatId, panelMsg[userId], '❌ Пользователь не найден.', { parse_mode: 'HTML' });
      return;
    }

    const amountsText = (u.amounts || '').split(/[\s,;]+/).filter(Boolean).join(', ');
    const intervalText = u.interval_from === u.interval_to
      ? `каждые ${u.interval_from} мин`
      : `каждые ${u.interval_from}-${u.interval_to} мин`;

    let nextLine = '';
    if (u.last_profit_at) {
      const due = u.last_profit_at + pickNextInterval(u) * 60000;
      const minsLeft = Math.max(0, Math.round((due - Date.now()) / 60000));
      nextLine = minsLeft > 0
        ? `<i>Следующий профит — примерно через ${minsLeft} мин</i>`
        : `<i>Следующий профит — в ближайшее время</i>`;
    } else {
      nextLine = '<i>Профиты ещё не публиковались</i>';
    }

    const text = `👤 <b>#${escapeHtml(plainName(u.name))}</b>

💰 <b>Суммы:</b> ${escapeHtml(amountsText)}₽
📋 <b>Направление:</b> ${dirFull(u.direction)} (${u.direction})
⏰ <b>Время:</b> ${u.time_from}:00 - ${u.time_to}:59 МСК
🔁 <b>Частота:</b> ${intervalText}
📊 <b>Опубликовано:</b> ${fmt(u.total_amount)}₽, ${u.profit_count} профитов
${u.enabled ? '✅ <b>Включен</b>' : '⛔️ <b>Выключен</b>'}

${nextLine}`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '✏️ Ник', callback_data: `ap_editname_${u.id}` },
          { text: '✏️ Суммы', callback_data: `ap_editamounts_${u.id}` }
        ],
        [
          { text: '✏️ Направление', callback_data: `ap_editdir_${u.id}` },
          { text: '✏️ Время', callback_data: `ap_edittime_${u.id}` }
        ],
        [{ text: '✏️ Частота', callback_data: `ap_editinterval_${u.id}` }],
        [
          { text: u.enabled ? '⏸ Выключить' : '▶️ Включить', callback_data: `ap_toggle_${u.id}` },
          { text: '🗑 Удалить', callback_data: `ap_del_${u.id}` }
        ],
        [{ text: '◀️ Назад к списку', callback_data: 'ap_list' }]
      ]
    };

    const opts = { parse_mode: 'HTML', reply_markup: keyboard };
    const mid = panelMsg[userId];
    if (mid) {
      bot
        .editMessageText(text, { chat_id: chatId, message_id: mid, ...opts })
        .catch(() => {
          bot.sendMessage(chatId, text, opts).then((m) => { panelMsg[userId] = m.message_id; }).catch(() => {});
        });
    } else {
      bot.sendMessage(chatId, text, opts).then((m) => { panelMsg[userId] = m.message_id; }).catch(() => {});
    }
  });
}

// ── Добавление пользователя ──────────────────────────────────────────────
const ADD_PROMPT = {
  name: '✍️ <b>Отправь ник пользователя</b>\nНапример: Психопат',
  amounts: '💰 <b>Суммы профитов</b> через пробел (одна или несколько — бот выбирает случайно):\nНапример: <code>5000 8000 12000</code>',
  direction: '📋 <b>Направление</b> (отправь цифру):\n<code>1</code> — Кардинг\n<code>2</code> — Прямой\n<code>3</code> — Букмекер',
  time: '⏰ <b>Рабочее время, МСК</b> — начало и конец часа:\nНапример: <code>13-19</code>',
  interval: '🔁 <b>Частота публикации</b>, в минутах (можно диапазон):\nНапример: <code>60</code>\nИли: <code>45-120</code>'
};

function askAddField(bot, chatId, userId) {
  const f = addFlow[userId];
  if (!f) return;
  bot.sendMessage(chatId, ADD_PROMPT[f.step], { parse_mode: 'HTML' }).then((m) => {
    f.mid = m.message_id;
    guard.setPendingInput(userId, chatId, (msg) => {
      handleAddText(bot, chatId, userId, msg);
    });
  }).catch(() => {});
}

function saveNewUser(bot, chatId, userId, f) {
  const name = f.name;
  db.get('SELECT id FROM auto_profit_users WHERE name = ?', [name], (err, exists) => {
    if (exists) {
      bot.sendMessage(chatId, `❌ Пользователь <b>${escapeHtml(name)}</b> уже есть.`).catch(() => {});
      delete addFlow[userId];
      renderList(bot, chatId, null);
      return;
    }
    db.run(
      `INSERT INTO auto_profit_users (name, amounts, direction, time_from, time_to, interval_from, interval_to, enabled, total_amount, profit_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0)`,
      [name, f.amounts.join(' '), f.direction, f.time.time_from, f.time.time_to, f.interval.interval_from, f.interval.interval_to],
      (insErr) => {
        delete addFlow[userId];
        if (insErr) {
          console.error('[ap] insert error:', insErr.message);
          bot.sendMessage(chatId, '❌ Ошибка сохранения.').catch(() => {});
          return;
        }
        bot.sendMessage(chatId, `✅ <b>${escapeHtml(name)}</b> добавлен в авто-публикацию.`).catch(() => {});
        renderList(bot, chatId, null);
      }
    );
  });
}

function handleAddText(bot, chatId, userId, msg) {
  const f = addFlow[userId];
  if (!f || msg.chat.id !== chatId) return;
  if (!msg.text || msg.text.startsWith('/')) return;

  guard.clearPendingInput(userId);
  bot.deleteMessage(chatId, msg.message_id).catch(() => {});
  if (f.mid) bot.deleteMessage(chatId, f.mid).catch(() => {});
  const val = msg.text.trim();

  if (f.step === 'name') {
    const name = plainName(val);
    if (!name) {
      bot.sendMessage(chatId, '❌ Ник не может быть пустым.').catch(() => {});
      askAddField(bot, chatId, userId);
      return;
    }
    f.name = name;
    f.step = 'amounts';
  } else if (f.step === 'amounts') {
    const amounts = parseAmounts(val);
    if (!amounts) {
      bot.sendMessage(chatId, '❌ Укажи суммы числами через пробел.').catch(() => {});
      askAddField(bot, chatId, userId);
      return;
    }
    f.amounts = amounts;
    f.step = 'direction';
  } else if (f.step === 'direction') {
    const d = parseInt(val, 10);
    if (![1, 2, 3].includes(d)) {
      bot.sendMessage(chatId, '❌ Направление: 1, 2 или 3.').catch(() => {});
      askAddField(bot, chatId, userId);
      return;
    }
    f.direction = d;
    f.step = 'time';
  } else if (f.step === 'time') {
    const t = parseTimeRange(val);
    if (!t) {
      bot.sendMessage(chatId, '❌ Формат: начало-конец, например 13-19.').catch(() => {});
      askAddField(bot, chatId, userId);
      return;
    }
    f.time = t;
    f.step = 'interval';
  } else if (f.step === 'interval') {
    const it = parseInterval(val);
    if (!it) {
      bot.sendMessage(chatId, '❌ Частота в минутах или диапазон, например 60 или 45-120.').catch(() => {});
      askAddField(bot, chatId, userId);
      return;
    }
    f.interval = it;
    saveNewUser(bot, chatId, userId, f);
    return;
  }

  askAddField(bot, chatId, userId);
}

// ── Редактирование пользователя ─────────────────────────────────────────
function beginEdit(bot, chatId, userId, autoId, field, prompt) {
  editFlow[userId] = { id: autoId, field };
  bot.sendMessage(chatId, prompt, { parse_mode: 'HTML' }).then((m) => {
    editFlow[userId].mid = m.message_id;
    guard.setPendingInput(userId, chatId, (msg) => {
      handleEditText(bot, chatId, userId, msg);
    });
  }).catch(() => {});
}

function handleEditText(bot, chatId, userId, msg) {
  const ed = editFlow[userId];
  if (!ed || msg.chat.id !== chatId) return;
  if (!msg.text || msg.text.startsWith('/')) return;

  guard.clearPendingInput(userId);
  bot.deleteMessage(chatId, msg.message_id).catch(() => {});
  if (ed.mid) bot.deleteMessage(chatId, ed.mid).catch(() => {});
  const val = msg.text.trim();

  const apply = (setSql, params, okText) => {
    db.run(`UPDATE auto_profit_users SET ${setSql} WHERE id = ?`, [...params, ed.id], (err) => {
      const autoId = ed.id;
      delete editFlow[userId];
      if (err) {
        console.error('[ap] update error:', err.message);
        bot.sendMessage(chatId, '❌ Ошибка сохранения.').catch(() => {});
        renderPanel(bot, chatId, userId, autoId);
        return;
      }
      bot.sendMessage(chatId, okText).catch(() => {});
      renderPanel(bot, chatId, userId, autoId);
    });
  };

  if (ed.field === 'name') {
    const name = plainName(val);
    if (!name) {
      bot.sendMessage(chatId, '❌ Ник не может быть пустым.').catch(() => {});
      return;
    }
    db.get('SELECT id FROM auto_profit_users WHERE name = ? AND id != ?', [name, ed.id], (err, dup) => {
      if (dup) {
        bot.sendMessage(chatId, `❌ Ник <b>${escapeHtml(name)}</b> уже занят.`).catch(() => {});
        return;
      }
      apply('name = ?', [name], '✅ Ник обновлён.');
    });
    return;
  }

  if (ed.field === 'amounts') {
    const amounts = parseAmounts(val);
    if (!amounts) {
      bot.sendMessage(chatId, '❌ Суммы числами через пробел.').catch(() => {});
      return;
    }
    apply('amounts = ?', [amounts.join(' ')], '✅ Суммы обновлены.');
    return;
  }

  if (ed.field === 'direction') {
    const d = parseInt(val, 10);
    if (![1, 2, 3].includes(d)) {
      bot.sendMessage(chatId, '❌ Направление: 1, 2 или 3.').catch(() => {});
      return;
    }
    apply('direction = ?', [d], '✅ Направление обновлено.');
    return;
  }

  if (ed.field === 'time') {
    const t = parseTimeRange(val);
    if (!t) {
      bot.sendMessage(chatId, '❌ Формат: начало-конец, например 13-19.').catch(() => {});
      return;
    }
    apply('time_from = ?, time_to = ?', [t.time_from, t.time_to], '✅ Время обновлено.');
    return;
  }

  if (ed.field === 'interval') {
    const it = parseInterval(val);
    if (!it) {
      bot.sendMessage(chatId, '❌ Частота в минутах или диапазон, например 60 или 45-120.').catch(() => {});
      return;
    }
    apply('interval_from = ?, interval_to = ?', [it.interval_from, it.interval_to], '✅ Частота обновлена.');
  }
}

// ── Публикация и планировщик ────────────────────────────────────────────
const dbGetP = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});
const dbRunP = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, (err) => (err ? reject(err) : resolve()));
});

function insertProfit(userId, amount, payout, direction) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO profits (user_id, amount, amount_to_pay, direction) VALUES (?, ?, ?, ?)',
      [userId, amount, payout, direction],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

// Регистрируем воркера в users (если ещё нет) — без Telegram-аккаунта,
// спец-диапазоном id, чтобы просмотр профиля отдавал «Аккаунт закрыт».
async function ensureUser(userId, worker) {
  const existing = await dbGetP('SELECT user_id FROM users WHERE user_id = ?', [userId]);
  if (existing) return;
  await dbRunP(
    `INSERT OR IGNORE INTO users
      (user_id, username, name, status, balance, total_earned, battlepass_earned, battlepass_xp, profit_count, application_approved)
     VALUES (?, ?, ?, 'NEW', 0, 0, 0, 0, 0, 1)`,
    [userId, worker, '#' + worker]
  );
}

// Полная накрутка как живой профит: profits, profit_shares, users,
// проект-стата, закреп. Никакой личной рассылки фейковому воркеру.
async function recordProfit(bot, user, profit, workerPayout) {
  const amounts = parseAmounts(user.amounts) || [5000];
  const amount = profit.amount;
  const direction = profit.direction;

  await ensureUser(profit.userId, profit.username);

  const pre = await dbGetP(
    'SELECT battlepass_earned, battlepass_xp FROM users WHERE user_id = ?',
    [profit.userId]
  ).catch(() => null);
  const oldPass = {
    totalEarned: pre ? (pre.battlepass_earned || 0) : 0,
    xp: pre ? (pre.battlepass_xp || 0) : 0
  };

  const profitId = await insertProfit(profit.userId, amount, workerPayout, direction);

  const shares = utils.calculateProfitShares(amount);
  for (const [role, shareAmount] of Object.entries(shares)) {
    await dbRunP(
      'INSERT OR IGNORE INTO profit_shares (profit_id, role, percentage, amount) VALUES (?, ?, ?, ?)',
      [profitId, role, utils.PROFIT_SHARES[role], shareAmount]
    ).catch(() => {});
  }

  // Авто-воркеры копят XP пасса по базовой ставке вне зависимости от направления.
  const xpGain = battlepass.xpFromAmount(amount, 1);
  await dbRunP(
    `UPDATE users SET
      balance = balance + ?,
      total_earned = total_earned + ?,
      battlepass_earned = COALESCE(battlepass_earned, 0) + ?,
      battlepass_xp = COALESCE(battlepass_xp, 0) + ?,
      profit_count = profit_count + 1
     WHERE user_id = ?`,
    [workerPayout, amount, amount, xpGain, profit.userId]
  );

  utils.updateWorkerStatus(profit.userId, (statusErr, status) => {
    if (!statusErr && status) {
      statusChats.sendPendingUnlocks(bot, profit.userId, status);
    }
  });

  utils.updateProjectStats(amount, (err) => {
    if (err) console.error('[ap] updateProjectStats:', err.message);
  });
  updatePinnedMessage(bot, GENERAL_CHAT_ID).catch((err) =>
    console.error('[ap] updatePinnedMessage:', err.message)
  );

  sendPrizeNotifications(
    bot,
    db,
    autoAdminIds,
    profit.userId,
    profit.username,
    profit.name,
    oldPass,
    { totalEarned: oldPass.totalEarned + amount, xp: oldPass.xp + xpGain }
  );
}

async function publishProfit(bot, user) {
  if (publishing.has(user.id)) return;
  publishing.add(user.id);
  try {
    const amounts = parseAmounts(user.amounts) || [5000];
    const amount = amounts[Math.floor(Math.random() * amounts.length)];
    const direction = user.direction || 1;
    const worker = plainName(user.name);
    const userId = AUTO_USER_ID_BASE + user.id;
    const workerPayout = utils.calculateWorkerPayout(amount, direction);

    const profit = {
      userId,
      username: worker,
      name: '#' + worker,
      amount,
      workerPayout,
      direction,
      directionName: dirFull(direction),
      curator: null
    };
    const text = buildPublicText(profit);

    let anyOk = false;
    try {
      await bot.sendMessage(CASH_CHANNEL_ID, text, { parse_mode: 'HTML', disable_web_page_preview: true });
      anyOk = true;
    } catch (e) {
      console.error('[ap] касса:', e.message);
    }
    try {
      await bot.sendMessage(GENERAL_CHAT_ID, text, { parse_mode: 'HTML', disable_web_page_preview: true });
      anyOk = true;
    } catch (e) {
      console.error('[ap] чат:', e.message);
    }

    if (!anyOk) {
      console.error(`[ap] ${worker} не опубликован: касса и чат недоступны`);
      return;
    }

    await recordProfit(bot, user, profit, workerPayout);

    await dbRunP(
      'UPDATE auto_profit_users SET total_amount = total_amount + ?, profit_count = profit_count + 1, last_profit_at = ? WHERE id = ?',
      [amount, Date.now(), user.id]
    ).catch((err) => console.error('[ap] update stats:', err.message));

    console.log(`[ap] ${worker} +${amount}₽ → в БД, касса и чат`);
  } catch (err) {
    console.error('[ap] publish error:', err.message);
  } finally {
    publishing.delete(user.id);
  }
}

function tick(bot) {
  db.all('SELECT * FROM auto_profit_users WHERE enabled = 1', (err, users) => {
    if (err || !users || !users.length) return;
    const mins = moscowMinutes();
    users.forEach((u) => {
      if (!inTimeWindow(u.time_from, u.time_to, mins)) return;
      const elapsedMin = (Date.now() - (u.last_profit_at || 0)) / 60000;
      if (elapsedMin >= pickNextInterval(u)) {
        publishProfit(bot, u);
      }
    });
  });
}

function cancelAutoFlow(userId) {
  let cleared = false;
  if (addFlow[userId]) { delete addFlow[userId]; cleared = true; }
  if (editFlow[userId]) { delete editFlow[userId]; cleared = true; }
  if (panelMsg[userId]) { delete panelMsg[userId]; }
  guard.clearPendingInput(userId);
  return cleared;
}

function setupAutoProfits(bot, adminIds) {
  autoAdminIds = Array.isArray(adminIds) ? adminIds : [];
  // Команда /res — меню авто-публикации (только админы, личка)
  bot.onText(/\/res(?:@[\w_]+)?(?:\s|$)/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!adminIds.includes(userId)) {
      bot.sendMessage(chatId, '❌ У вас нет прав администратора').catch(() => {});
      return;
    }
    if (msg.chat.type !== 'private') {
      bot.sendMessage(chatId, '❌ Команда работает только в личных сообщениях с ботом').catch(() => {});
      return;
    }

    cancelAutoFlow(userId);
    renderMain(bot, chatId, null);
  });

  bot.on('callback_query', (query) => {
    const data = query.data || '';
    if (!data.startsWith('ap_')) return;

    const chatId = query.message.chat.id;
    const userId = query.from.id;
    if (!adminIds.includes(userId)) {
      bot.answerCallbackQuery(query.id, { text: '❌ Доступ запрещён', show_alert: true }).catch(() => {});
      return;
    }
    if (!dedupeCallback(userId, data)) return;
    const messageId = query.message.message_id;

    if (data === 'ap_main') {
      bot.answerCallbackQuery(query.id).catch(() => {});
      delete panelMsg[userId];
      renderMain(bot, chatId, messageId);
      return;
    }

    if (data === 'ap_list') {
      bot.answerCallbackQuery(query.id).catch(() => {});
      delete panelMsg[userId];
      renderList(bot, chatId, messageId);
      return;
    }

    if (data === 'ap_add') {
      bot.answerCallbackQuery(query.id).catch(() => {});
      delete panelMsg[userId];
      addFlow[userId] = { step: 'name' };
      askAddField(bot, chatId, userId);
      return;
    }

    if (data.startsWith('ap_open_')) {
      bot.answerCallbackQuery(query.id).catch(() => {});
      renderPanel(bot, chatId, userId, parseInt(data.slice(8), 10));
      return;
    }

    const editActions = [
      ['ap_editname_', 'name', '✍️ Отправь новый ник:'],
      ['ap_editamounts_', 'amounts', '💰 Отправь новые суммы через пробел:\nНапример: <code>5000 8000 12000</code>'],
      ['ap_editdir_', 'direction', '📋 Отправь направление:\n<code>1</code> — Кардинг\n<code>2</code> — Прямой\n<code>3</code> — Букмекер'],
      ['ap_edittime_', 'time', '⏰ Отправь новое время работы, МСК:\nНапример: <code>13-19</code>'],
      ['ap_editinterval_', 'interval', '🔁 Отправь новую частоту в минутах (или диапазон):\nНапример: <code>45-120</code>']
    ];
    for (const [prefix, field, prompt] of editActions) {
      if (data.startsWith(prefix)) {
        bot.answerCallbackQuery(query.id).catch(() => {});
        beginEdit(bot, chatId, userId, parseInt(data.slice(prefix.length), 10), field, prompt);
        return;
      }
    }

    if (data.startsWith('ap_toggle_')) {
      const id = parseInt(data.slice(10), 10);
      db.run('UPDATE auto_profit_users SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END WHERE id = ?', [id], (err) => {
        bot.answerCallbackQuery(query.id, { text: err ? '❌ Ошибка' : '✅ Переключено' }).catch(() => {});
        renderPanel(bot, chatId, userId, id);
      });
      return;
    }

    if (data.startsWith('ap_del_')) {
      const id = parseInt(data.slice(7), 10);
      db.run('DELETE FROM auto_profit_users WHERE id = ?', [id], (err) => {
        bot.answerCallbackQuery(query.id, { text: err ? '❌ Ошибка' : '🗑 Удалён' }).catch(() => {});
        delete panelMsg[userId];
        renderList(bot, chatId, messageId);
      });
      return;
    }
  });

  // Проверка расписания каждые 30 секунд.
  setInterval(() => tick(bot), 30000);

  console.log('🤖 Авто-публикация профитов готова');
}

module.exports = {
  setupAutoProfits,
  cancelAutoFlow,
  AUTO_USER_ID_BASE,
  parseAmounts,
  parseTimeRange,
  parseInterval,
  inTimeWindow,
  pickNextInterval,
  buildPublicText
};