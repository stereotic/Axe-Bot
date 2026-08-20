// res_gift_backfill.js — догнать пропущенные подарки АХЕ PASS для воркеров `/res`.
// Считает уровень по battlepass_earned/battlepass_xp в users и отправляет в общий чат
// все подарки 1..текущий уровень, которые не были уведомлены (идемпотентно).
//
// Запуск на сервере (там же, где database.db и .env):
//   node res_gift_backfill.js 900000000002 900000000003   — отправить для этих воркеров
//   node res_gift_backfill.js                             — все авто-воркеры из auto_profit_users
//   node res_gift_backfill.js --dry 900000000002          — посчитать и показать тексты, не слать
//   node res_gift_backfill.js --test-chat <id> 900000000002 — слать подарки в тестовый чат,
//                                                              без билетов в БД и алертов админам
//   node res_gift_backfill.js --dry --test-chat <id> 900000000002 — показать тексты + сверка

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');
const battlepass = require('./battlepass');
const { sendLevelGift, giftChatText } = require('./prize_notifications');

const AUTO_USER_ID_BASE = 900000000000;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const testChatIdx = args.indexOf('--test-chat');
const testChat = testChatIdx >= 0 ? args[testChatIdx + 1] : null;
const targets = args.filter((a) => /^\d+$/.test(a)).map(Number);

const tokens = (process.env.BOT_TOKEN || '').trim();
if (!tokens) {
  console.error('BOT_TOKEN не задан в .env');
  process.exit(1);
}
const adminIds = process.env.ADMIN_IDS
  ? process.env.ADMIN_IDS.split(',').map((id) => parseInt(id.trim(), 10)).filter(Boolean)
  : [];

const proxy = process.env.TELEGRAM_PROXY?.trim();
const options = { polling: false };
if (proxy) options.request = { proxy };
const bot = new TelegramBot(tokens, options);

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});
const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
});
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, (err) => (err ? reject(err) : resolve()));
});

async function main() {
  await dbRun(
    `CREATE TABLE IF NOT EXISTS pass_gift_notified (
      user_id INTEGER NOT NULL,
      prize_level INTEGER NOT NULL,
      notified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, prize_level)
    )`
  );

  const where = targets.length
    ? `u.user_id IN (${targets.join(',')})`
    : `u.user_id >= ${AUTO_USER_ID_BASE}`;
  const users = await dbAll(
    `SELECT u.user_id, u.username, u.name, u.battlepass_earned, u.battlepass_xp
     FROM users u
     WHERE ${where}
       AND user_id IS NOT NULL`
  );

  if (!users.length) {
    console.log('Воркеры не найдены.');
    return;
  }

  for (const u of users) {
    const state = battlepass.buildState(u.battlepass_earned || 0, u.battlepass_xp || 0);
    const missed = [];
    for (let lvl = 1; lvl <= state.level; lvl++) {
      const row = await dbGet(
        'SELECT 1 FROM pass_gift_notified WHERE user_id = ? AND prize_level = ?',
        [u.user_id, lvl]
      );
      if (!row) missed.push(lvl);
    }

    console.log(
      `#${String(u.name || '').replace(/^#+/, '')} (${u.user_id}) касса=${u.battlepass_earned || 0} xp=${u.battlepass_xp || 0} ` +
      `уровень=${state.level} пропущено=[${missed.join(',') || '-'}]`
    );

    if (!missed.length) continue;

    for (const lvl of missed) {
      const text = giftChatText(u.username || null, u.name, lvl);
      const isTicket = !!(battlepass.LEVELS[lvl - 1] && battlepass.LEVELS[lvl - 1].ticketName);

      if (dryRun) {
        console.log(`  [dry] lvl ${lvl}: ${text}\n${isTicket ? '  [dry]   → билет: будет выпущен в боевом режиме' : ''}`);
        continue;
      }

      if (testChat) {
        await bot.sendMessage(testChat, text, { parse_mode: 'HTML' }).catch((err) =>
          console.error(`Ошибка отправки в тестовый чат: ${err.message}`)
        );
        if (isTicket) {
          await bot.sendMessage(testChat,
            `ℹ️ Уровень ${lvl}: в тестовом режиме билет не выпускается, в боевом — будет выпущен и уведомлён админ.`,
            { parse_mode: 'HTML' }
          ).catch(() => {});
        }
        console.log(`  → уровень ${lvl} отправлен в тестовый чат`);
        continue;
      }

      await dbRun(
        'INSERT INTO pass_gift_notified (user_id, prize_level) VALUES (?, ?)',
        [u.user_id, lvl]
      );
      sendLevelGift(bot, db, adminIds, u.user_id, u.username || null, u.name, lvl);
    }

    if (!dryRun && !testChat) console.log(`  → отправлено подарков: ${missed.length}`);
  }

  setTimeout(() => {
    db.close();
    process.exit(0);
  }, 5000);
}

main().catch((err) => {
  console.error('Ошибка:', err);
  process.exit(1);
});