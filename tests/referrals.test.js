const { test } = require('node:test');
const assert = require('node:assert');
const sqlite3 = require('sqlite3').verbose();

const referrals = require('../referrals');

test('normalizeRate: принимает проценты и отклоняет выход за диапазон', () => {
  assert.strictEqual(referrals.normalizeRate('1,5%'), 1.5);
  assert.strictEqual(referrals.normalizeRate('0'), 0);
  assert.strictEqual(referrals.normalizeRate('100'), 100);
  assert.strictEqual(referrals.normalizeRate('-1'), null);
  assert.strictEqual(referrals.normalizeRate('101'), null);
  assert.strictEqual(referrals.normalizeRate('abc'), null);
});

test('calculateReferralReward: округляет выплату вниз', () => {
  assert.strictEqual(referrals.calculateReferralReward(5000, 1), 50);
  assert.strictEqual(referrals.calculateReferralReward(999, 1.5), 14);
  assert.strictEqual(referrals.calculateReferralReward(-1, 10), 0);
});

test('buildRatesText: порядок прямик, биржа и БК отражается под своими подписями', () => {
  const text = referrals.buildRatesText({ direct: 1, exchange: 2.5, bookmaker: 3 });
  assert.strictEqual(text, 'Биржа - 2,5%\nПрямик - 1%\nБК - 3%');
});

test('awardReferralProfit: один profit_id начисляется только один раз', async () => {
  const db = new sqlite3.Database(':memory:');
  const exec = (sql) => new Promise((resolve, reject) => db.exec(sql, (err) => err ? reject(err) : resolve()));
  const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
  const close = () => new Promise((resolve) => db.close(resolve));
  await exec(`
    CREATE TABLE users (
      user_id INTEGER PRIMARY KEY,
      username TEXT,
      name TEXT,
      referred_by INTEGER,
      balance INTEGER DEFAULT 0,
      referral_percent_direct REAL DEFAULT 0,
      referral_percent_exchange REAL DEFAULT 0,
      referral_percent_bookmaker REAL DEFAULT 0
    );
    CREATE TABLE referral_rewards (
      profit_id INTEGER PRIMARY KEY,
      referrer_id INTEGER NOT NULL,
      worker_id INTEGER NOT NULL,
      direction INTEGER NOT NULL,
      percentage REAL NOT NULL,
      amount INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (user_id, username, balance, referral_percent_exchange)
      VALUES (10, 'referrer', 0, 1);
    INSERT INTO users (user_id, username, referred_by)
      VALUES (20, 'worker', 10);
  `);
  const messages = [];
  const bot = { sendMessage: async (...args) => { messages.push(args); } };
  await referrals.awardReferralProfit(bot, db, { profitId: 77, workerId: 20, amount: 5000, direction: 1 });
  await referrals.awardReferralProfit(bot, db, { profitId: 77, workerId: 20, amount: 5000, direction: 1 });
  const referrer = await get('SELECT balance FROM users WHERE user_id = 10');
  const reward = await get('SELECT COUNT(*) AS count, amount FROM referral_rewards WHERE profit_id = 77');
  assert.strictEqual(referrer.balance, 50);
  assert.strictEqual(reward.count, 1);
  assert.strictEqual(reward.amount, 50);
  assert.strictEqual(messages.length, 1);
  assert.match(messages[0][1], /Ваш профит: 50₽/);
  await close();
});
