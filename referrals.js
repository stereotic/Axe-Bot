const DIRECTION_RATE_COLUMNS = Object.freeze({
  1: 'referral_percent_exchange',
  2: 'referral_percent_direct',
  3: 'referral_percent_bookmaker'
});

const get = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});

const all = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
});

const run = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(err) {
    if (err) reject(err);
    else resolve({ changes: this.changes, lastID: this.lastID });
  });
});

function normalizeRate(value) {
  const parsed = Number(String(value).replace(',', '.').replace('%', ''));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return Math.round(parsed * 100) / 100;
}

function formatRate(value) {
  const rate = Number(value || 0);
  return Number.isInteger(rate) ? String(rate) : String(rate).replace('.', ',');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function getReferralRates(db, referrerId) {
  const row = await get(
    db,
    `SELECT
       COALESCE(referral_percent_direct, 0) AS direct,
       COALESCE(referral_percent_exchange, 0) AS exchange,
       COALESCE(referral_percent_bookmaker, 0) AS bookmaker
     FROM users WHERE user_id = ?`,
    [referrerId]
  );
  return row || { direct: 0, exchange: 0, bookmaker: 0 };
}

async function setReferralRates(db, referrerId, rates) {
  const direct = normalizeRate(rates.direct);
  const exchange = normalizeRate(rates.exchange);
  const bookmaker = normalizeRate(rates.bookmaker);
  if ([direct, exchange, bookmaker].includes(null)) {
    throw new Error('Проценты должны быть числами от 0 до 100');
  }
  const result = await run(
    db,
    `UPDATE users SET
       referral_percent_direct = ?,
       referral_percent_exchange = ?,
       referral_percent_bookmaker = ?
     WHERE user_id = ?`,
    [direct, exchange, bookmaker, referrerId]
  );
  if (!result.changes) throw new Error('Реферал не найден');
  return { direct, exchange, bookmaker };
}

async function getReferralStats(db, referrerId) {
  const row = await get(
    db,
    `SELECT
       COUNT(DISTINCT CASE WHEN u.application_approved = 1 THEN u.user_id END) AS total,
       COUNT(DISTINCT CASE WHEN u.application_approved = 1 AND u.referral_blocked = 1 THEN u.user_id END) AS blocked,
       COUNT(DISTINCT CASE WHEN u.application_approved = 1 AND COALESCE(u.referral_blocked, 0) = 0 THEN u.user_id END) AS active,
       COALESCE(SUM(p.amount), 0) AS profit_all,
       COALESCE(SUM(CASE
         WHEN strftime('%Y-%m', datetime(p.created_at, '+3 hours')) = strftime('%Y-%m', 'now', '+3 hours')
         THEN p.amount ELSE 0 END), 0) AS profit_month,
       COALESCE(SUM(CASE
         WHEN date(datetime(p.created_at, '+3 hours')) = date('now', '+3 hours')
         THEN p.amount ELSE 0 END), 0) AS profit_day
     FROM users u
     LEFT JOIN profits p ON p.user_id = u.user_id
     WHERE u.referred_by = ? AND u.application_approved = 1`,
    [referrerId]
  );
  return row || { total: 0, blocked: 0, active: 0, profit_all: 0, profit_month: 0, profit_day: 0 };
}

async function getReferralWorkers(db, referrerId) {
  return all(
    db,
    `SELECT
       u.user_id,
       u.username,
       u.name,
       COALESCE(u.referral_blocked, 0) AS blocked,
       COALESCE(SUM(p.amount), 0) AS profit_all,
       COALESCE(SUM(CASE
         WHEN strftime('%Y-%m', datetime(p.created_at, '+3 hours')) = strftime('%Y-%m', 'now', '+3 hours')
         THEN p.amount ELSE 0 END), 0) AS profit_month,
       COALESCE(SUM(CASE
         WHEN date(datetime(p.created_at, '+3 hours')) = date('now', '+3 hours')
         THEN p.amount ELSE 0 END), 0) AS profit_day,
       COUNT(p.id) AS profit_count
     FROM users u
     LEFT JOIN profits p ON p.user_id = u.user_id
     WHERE u.referred_by = ? AND u.application_approved = 1
     GROUP BY u.user_id
     ORDER BY profit_all DESC, u.user_id ASC`,
    [referrerId]
  );
}

function calculateReferralReward(amount, percentage) {
  const safeAmount = Math.max(0, Number(amount) || 0);
  const safeRate = Math.max(0, Number(percentage) || 0);
  return Math.floor(safeAmount * safeRate / 100);
}

async function awardReferralProfit(bot, db, profit) {
  const profitId = Number(profit.profitId);
  const workerId = Number(profit.workerId);
  const direction = Number(profit.direction);
  const amount = Number(profit.amount) || 0;
  const rateColumn = DIRECTION_RATE_COLUMNS[direction];
  if (!profitId || !workerId || !rateColumn) return null;

  const worker = await get(
    db,
    `SELECT user_id, username, name, referred_by
     FROM users WHERE user_id = ? AND referred_by IS NOT NULL`,
    [workerId]
  );
  if (!worker || Number(worker.referred_by) === workerId) return null;

  const referrer = await get(
    db,
    `SELECT user_id, COALESCE(${rateColumn}, 0) AS percentage
     FROM users WHERE user_id = ?`,
    [worker.referred_by]
  );
  if (!referrer) return null;

  const percentage = Number(referrer.percentage || 0);
  const reward = calculateReferralReward(amount, percentage);
  const inserted = await run(
    db,
    `INSERT OR IGNORE INTO referral_rewards
       (profit_id, referrer_id, worker_id, direction, percentage, amount)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [profitId, referrer.user_id, workerId, direction, percentage, reward]
  );
  if (!inserted.changes) return null;

  if (reward > 0) {
    await run(db, 'UPDATE users SET balance = COALESCE(balance, 0) + ? WHERE user_id = ?', [reward, referrer.user_id]);
  }

  const rawName = worker.username || worker.name || String(workerId);
  const workerLabel = rawName.startsWith('@') ? rawName : `@${rawName.replace(/^#/, '')}`;
  const text = `<b>Ваш реферал ${escapeHtml(workerLabel)} сделал профит на сумму: ${amount.toLocaleString('en-US')}₽\nВаш профит: ${reward.toLocaleString('en-US')}₽</b>`;
  await bot.sendMessage(referrer.user_id, text, { parse_mode: 'HTML' }).catch(() => {});
  return { referrerId: referrer.user_id, reward, percentage };
}

function buildRatesText(rates) {
  return `Биржа - ${formatRate(rates.exchange)}%\nПрямик - ${formatRate(rates.direct)}%\nБК - ${formatRate(rates.bookmaker)}%`;
}

module.exports = {
  DIRECTION_RATE_COLUMNS,
  normalizeRate,
  formatRate,
  getReferralRates,
  setReferralRates,
  getReferralStats,
  getReferralWorkers,
  calculateReferralReward,
  awardReferralProfit,
  buildRatesText,
  escapeHtml
};
