require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');
const utils = require('./utils');
const { acquire: acquireSingleInstance } = require('./single_instance');

const TOKEN = process.env.GROOMING_BOT_TOKEN;
const COMMUNITY_CHAT_ID = String(process.env.GROOMING_CHAT_ID || '-1004330111419');
const CASH_CHAT_ID = String(process.env.GROOMING_CASH_CHAT_ID || COMMUNITY_CHAT_ID);
const COMMUNITY_KEY = 'grooming';
const MAIN_BOT_USERNAME = process.env.BOT_USERNAME || 'AXE_xBOT';
const configuredAdmins = (process.env.GROOMING_ADMIN_IDS || process.env.ADMIN_IDS || '')
  .split(',').map(value => Number(value.trim())).filter(Number.isInteger);
const ADMIN_IDS = new Set([7032488691, ...configuredAdmins]);
const drafts = new Map();

if (!TOKEN) {
  console.error('GROOMING_BOT_TOKEN is not set. Add it to .env before starting this bot.');
  process.exit(1);
}

const lock = acquireSingleInstance('grooming-bot');
if (!lock.ok) {
  console.error(lock.message);
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: { interval: 100, params: { timeout: 30 } } });
bot.setMyCommands([{ command: 'top', description: 'Топ GROOMING' }, { command: 'start', description: 'Меню' }]).catch(() => {});
bot.on('polling_error', error => console.error('GROOMING polling error:', error.message));

bot.onText(/\/start(?:@[\w_]+)?(?:\s|$)/u, async message => {
  try {
    const text = `<b><tg-emoji emoji-id="5451845805516302233">🌸</tg-emoji>GROOMING COMMUNITY</b>\n\n` +
      `Направление: Кардинг\n` +
      `Концепция: Фейк Тима\n` +
      `Создатель: @symphonik_AXE\n\n` +
      `Используй <b>/top</b> чтобы увидеть топ грумеров.`;
    await bot.sendMessage(message.chat.id, text, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (error) { console.error('GROOMING /start:', error); }
});

const query = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});
const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(err) { err ? reject(err) : resolve(this); });
});

function isAdmin(message) {
  return Boolean(message && message.from && ADMIN_IDS.has(message.from.id));
}

function amountText(amount) {
  return Number(amount).toLocaleString('de-DE');
}

function profileLink(user) {
  return `https://t.me/${MAIN_BOT_USERNAME}?start=profile_${user.user_id}`;
}

function profitText(user, amount) {
  const worker = user.name && user.name !== '#' ? user.name.replace(/^#/, '') : (user.username || 'Воркер');
  return `<b>🌸УСПЕШНЫЙ ПРОФИТ🌸</b>\n\n` +
    `<b><tg-emoji emoji-id="5444984118519573636">🌸</tg-emoji>УСПЕШНЫЙ ПРОФИТ<tg-emoji emoji-id="5444984118519573636">🌸</tg-emoji></b>\n\n` +
    `<b><tg-emoji emoji-id="5445006366450164917">🏠</tg-emoji>Сервис: Кардинг</b>\n` +
    `<b>┣<tg-emoji emoji-id="5445214049593766654">👤</tg-emoji>Воркер: #<a href="${profileLink(user)}">${worker}</a></b>\n` +
    `<b>┣<tg-emoji emoji-id="5445152270784178138">💸</tg-emoji>Сумма: ${amountText(amount)}₽</b>\n` +
    `<b>┗ <tg-emoji emoji-id="5451845805516302233">😀</tg-emoji><a href="https://t.me/+EcTOSMKQH9thNTQy">GROOMING</a></b>`;
}

function topKeyboard(period) {
  const buttons = period === 'all'
    ? [{ text: 'Месяц', callback_data: 'grooming_top_month' }, { text: 'День', callback_data: 'grooming_top_day' }]
    : period === 'month'
      ? [{ text: 'За все время', callback_data: 'grooming_top_all' }, { text: 'День', callback_data: 'grooming_top_day' }]
      : [{ text: 'За все время', callback_data: 'grooming_top_all' }, { text: 'Месяц', callback_data: 'grooming_top_month' }];
  return { inline_keyboard: [buttons] };
}

function periodRange(period) {
  const now = new Date();
  if (period === 'day') return [new Date(now.getFullYear(), now.getMonth(), now.getDate()), new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)];
  if (period === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1)];
  return null;
}

async function buildTop(period = 'all') {
  const range = periodRange(period);
  const where = range ? 'AND cp.created_at >= ? AND cp.created_at < ?' : '';
  const params = range
    ? [COMMUNITY_KEY, ...range.map(date => date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''))]
    : [COMMUNITY_KEY];
  const users = await query(`SELECT u.user_id, u.username, u.name, SUM(cp.amount) AS total
    FROM community_profits cp JOIN users u ON u.user_id = cp.user_id
    WHERE cp.community_key = ? ${where}
    GROUP BY u.user_id ORDER BY total DESC, u.user_id ASC LIMIT 50`, params);
  const balance = users.length
    ? (await get(`SELECT COALESCE(SUM(amount), 0) AS total FROM community_profits WHERE community_key = ? ${range ? 'AND created_at >= ? AND created_at < ?' : ''}`, params)).total
    : 0;
  const heading = period === 'day' ? '🏆<b>Топ 10 GROOMING за день</b>' : period === 'month' ? '🏆<b>Топ 10 GROOMING за месяц</b>' : '🏆<b>Топ 10 GROOMING</b>';
  const ranks = ['🥇', '🥈', '🥉', '🥉', '🥉', '🥉', '🥉', '🥉', '🥉', '🥉'];
  const merged = {};
  users.forEach(u => {
    const key = (u.name || u.username || '').toLowerCase().trim();
    if (!merged[key]) {
      merged[key] = { ...u, total: Number(u.total) };
    } else {
      merged[key].total += Number(u.total);
    }
  });
  const deduped = Object.values(merged)
    .sort((a, b) => b.total - a.total || a.user_id - b.user_id)
    .slice(0, 10);
  const lines = deduped.map((user, index) => {
    const rawName = (user.name && user.name !== '#' ? user.name : `#${user.username}`).replace(/^#/, '');
    return `${ranks[index]} <a href="${profileLink(user)}">${rawName}</a> — ${amountText(user.total)}₽`;
  });
  return { text: `${heading}\n\n${lines.length ? lines.join('\n') : 'Пока нет профитов.'}\n\n🏦<b>Касса комьюнити: ${amountText(balance)}₽</b>`, reply_markup: topKeyboard(period) };
}

async function buildPinnedText() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const [all, day, top, profitCount] = await Promise.all([
    get('SELECT COALESCE(SUM(amount), 0) AS total FROM community_profits WHERE community_key = ?', [COMMUNITY_KEY]),
    get('SELECT COALESCE(SUM(amount), 0) AS total FROM community_profits WHERE community_key = ? AND created_at >= ? AND created_at < ?', [COMMUNITY_KEY, start, end]),
    get(`SELECT u.user_id, u.username, u.name FROM community_profits cp JOIN users u ON u.user_id = cp.user_id WHERE cp.community_key = ? AND cp.created_at >= ? AND cp.created_at < ? GROUP BY u.user_id ORDER BY SUM(cp.amount) DESC LIMIT 1`, [COMMUNITY_KEY, start, end]),
    get('SELECT COUNT(*) AS cnt FROM community_profits WHERE community_key = ?', [COMMUNITY_KEY])
  ]);
  const leader = top ? `<a href="${profileLink(top)}">${top.name && top.name !== '#' ? top.name : `#${top.username}`}</a>` : '#';
  return `<b><tg-emoji emoji-id="5451845805516302233">😀</tg-emoji>GROOMING COMMUNITY</b>\n` +
    `<tg-emoji emoji-id="5445152270784178138">💸</tg-emoji>Касса КМ: ${amountText(all.total)}₽\n` +
    `<tg-emoji emoji-id="5451805523018033441">💰</tg-emoji>Касса за сутки: ${amountText(day.total)}₽\n\n` +
    `<tg-emoji emoji-id="5451767267744328949">🌶</tg-emoji>Топ 1 грумер ${leader}\n\n` +
    `┏  <a href="https://glas.su/fake-team-symphonik-axe-09-04">Мануал</a>\n` +
    `┣  <a href="https://t.me/BrilliantCM_bot">Фейк Тима</a>\n` +
    `┗  CEO <a href="https://t.me/symphonik_AXE">@symphonik_AXE</a>\n\n` +
    `<b><tg-emoji emoji-id="5444984118519573636">🌸</tg-emoji>УСПЕШНЫХ ПРОФИТОВ ${Number(profitCount?.cnt || 0).toLocaleString('ru-RU')}<tg-emoji emoji-id="5444984118519573636">🌸</tg-emoji></b>`;
}

async function updatePinned() {
  const text = await buildPinnedText();
  const key = 'grooming_pinned_message_id';
  const saved = await get('SELECT value FROM stats WHERE key = ?', [key]);
  let id = saved && Number(saved.value);

  if (!id) {
    try {
      const chat = await bot.getChat(COMMUNITY_CHAT_ID);
      id = chat.pinned_message && chat.pinned_message.message_id;
    } catch (e) { /* ignore */ }
  }

  if (id) {
    try {
      await bot.editMessageText(text, { chat_id: COMMUNITY_CHAT_ID, message_id: id, parse_mode: 'HTML', disable_web_page_preview: true });
      await run('INSERT OR REPLACE INTO stats (key, value) VALUES (?, ?)', [key, String(id)]);
      return;
    } catch (error) {
      if (String(error.message).includes('message is not modified')) return;
      console.error('GROOMING pinned edit:', error.message);
    }
  }

  const sent = await bot.sendMessage(COMMUNITY_CHAT_ID, text, { parse_mode: 'HTML', disable_web_page_preview: true });
  await bot.pinChatMessage(COMMUNITY_CHAT_ID, sent.message_id, { disable_notification: true });
  await run('INSERT OR REPLACE INTO stats (key, value) VALUES (?, ?)', [key, String(sent.message_id)]);
  console.log('📌 GROOMING pinned created, ID:', sent.message_id);
}

async function findWorker(username) {
  return get(`SELECT * FROM users WHERE LOWER(TRIM(COALESCE(username, ''))) = ? LIMIT 1`, [username.toLowerCase()]);
}

async function saveProfit(draft) {
  await run('BEGIN IMMEDIATE');
  try {
    const payout = utils.calculateWorkerPayout(draft.amount, 1);
    const result = await run('INSERT INTO profits (user_id, amount, amount_to_pay, direction) VALUES (?, ?, ?, 1)', [draft.user.user_id, draft.amount, payout]);
    await run('INSERT INTO community_profits (community_key, profit_id, user_id, amount) VALUES (?, ?, ?, ?)', [COMMUNITY_KEY, result.lastID, draft.user.user_id, draft.amount]);
    await run('UPDATE users SET balance = balance + ?, total_earned = total_earned + ?, battlepass_earned = COALESCE(battlepass_earned, 0) + ?, profit_count = profit_count + 1 WHERE user_id = ?', [payout, draft.amount, draft.amount, draft.user.user_id]);
    await run('COMMIT');
    utils.updateProjectStats(draft.amount, () => {});
    return true;
  } catch (error) {
    await run('ROLLBACK').catch(() => {});
    throw error;
  }
}

bot.onText(/^@([\w_]+)\s+([\d\s.,]+)₽?\s*$/u, async message => {
  if (!isAdmin(message)) return;
  const username = message.text.match(/^@([\w_]+)/)[1];
  const amount = Number(message.text.replace(/^@\w+\s+/, '').replace(/[^\d]/g, ''));
  if (!Number.isSafeInteger(amount) || amount <= 0) return bot.sendMessage(message.chat.id, '❌ Укажите корректную сумму.');
  try {
    const user = await findWorker(username);
    if (!user) return bot.sendMessage(message.chat.id, `❌ Воркер @${username} не найден в основном боте.`);
    const id = `${message.from.id}:${Date.now()}`;
    drafts.set(id, { user, amount, saved: false, sent: false });
    await bot.sendMessage(message.chat.id, profitText(user, amount), { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: [[
      { text: 'Отправить в кассу/чат', callback_data: `grooming_send_${id}` },
      { text: 'Отправить везде', callback_data: `grooming_send_${id}` }
    ]] } });
  } catch (error) { console.error('GROOMING draft:', error); }
});

bot.onText(/\/(?:top|топ)(?:@[\w_]+)?(?:\s|$)/u, async message => {
  try {
    const content = await buildTop('all');
    await bot.sendMessage(message.chat.id, content.text, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: content.reply_markup });
  } catch (error) { console.error('GROOMING top:', error); }
});

bot.on('callback_query', async callback => {
  const data = callback.data || '';
  try {
    if (data.startsWith('grooming_top_')) {
      const period = data.slice('grooming_top_'.length);
      const content = await buildTop(['all', 'month', 'day'].includes(period) ? period : 'all');
      await bot.answerCallbackQuery(callback.id);
      return bot.editMessageText(content.text, { chat_id: callback.message.chat.id, message_id: callback.message.message_id, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: content.reply_markup });
    }
    if (!data.startsWith('grooming_send_')) return;
    if (!ADMIN_IDS.has(callback.from.id)) return bot.answerCallbackQuery(callback.id, { text: 'Нет доступа', show_alert: true });
    const draft = drafts.get(data.slice('grooming_send_'.length));
    if (!draft || draft.sent) return bot.answerCallbackQuery(callback.id, { text: 'Профит уже обработан или устарел.' });
    draft.sent = true;
    await saveProfit(draft);
    const targets = [...new Set([COMMUNITY_CHAT_ID, CASH_CHAT_ID])];
    await Promise.all(targets.map(chatId => bot.sendMessage(chatId, profitText(draft.user, draft.amount), { parse_mode: 'HTML', disable_web_page_preview: true })));
    await updatePinned();
    drafts.delete(data.slice('grooming_send_'.length));
    await bot.answerCallbackQuery(callback.id, { text: 'Профит опубликован' });
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: callback.message.chat.id, message_id: callback.message.message_id });
  } catch (error) {
    console.error('GROOMING callback:', error);
    await bot.answerCallbackQuery(callback.id, { text: 'Ошибка публикации. Проверьте права бота.', show_alert: true }).catch(() => {});
  }
});

setTimeout(() => updatePinned().catch(error => console.error('GROOMING initial pin:', error.message)), 5000);
setInterval(() => updatePinned().catch(error => console.error('GROOMING pin:', error.message)), 10 * 60 * 1000);
