require('dotenv').config();
const db = require('./database');
const axios = require('axios');

const API_URL = process.env.LIMEBET_API_URL || 'https://limebet.top/api/qqqqqqqqaaa3337';
const POLL_INTERVAL_MS = (parseInt(process.env.EPICBET_POLL_SECONDS, 10) || 60) * 1000;

function formatAmount(n) {
  return Number(n || 0).toLocaleString('ru-RU').replace(/,/g, '.');
}

function parseTargets(raw, adminIds) {
  if (raw && String(raw).trim()) {
    return String(raw).split(',').map((id) => id.trim()).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n));
  }
  return adminIds.filter((id) => !Number.isNaN(id));
}

function getSeenIds(cb) {
  db.all('SELECT id FROM limebet_profits', (err, rows) => {
    if (err) {
      console.error('[epicbet] error loading seen ids:', err);
      return cb(new Set());
    }
    return cb(new Set((rows || []).map((r) => String(r.id))));
  });
}

function markSeen(p, callback) {
  db.run(
    `INSERT OR IGNORE INTO limebet_profits (id, mammoth, worker, amount, date) VALUES (?, ?, ?, ?, ?)`,
    [String(p.id), p.mammoth || '', p.worker || '', Number(p.amount) || 0, p.date || ''],
    (err) => {
      if (err) console.error('[epicbet] error marking seen:', err);
      if (callback) callback(err);
    }
  );
}

function buildMessage(p) {
  const worker = String(p.worker || '').trim().replace(/^@+/, '@');
  const amount = Number(p.amount) || 0;
  let text = `${worker}
Сумма: ${amount}₽`;
  if (p.date) text += `\nДата: ${p.date}`;
  return text;
}

async function sendToTargets(bot, targets, p) {
  const text = buildMessage(p);
  let sent = 0;
  for (const target of targets) {
    try {
      await bot.sendMessage(target, text, { parse_mode: 'HTML' });
      sent++;
    } catch (err) {
      console.error(`[epicbet] failed to notify ${target}:`, err.message);
    }
  }
  return sent;
}

function setupEpicbetProfits(bot, adminIds) {
  const targets = parseTargets(process.env.EPICBET_NOTIFY_IDS, adminIds);
  console.log(`🔄 EpicBet profits poller: ${targets.length} получателей (интервал ${POLL_INTERVAL_MS / 1000}с)`);

  db.run(`CREATE TABLE IF NOT EXISTS limebet_profits (
    id TEXT PRIMARY KEY,
    mammoth TEXT,
    worker TEXT,
    amount INTEGER,
    date TEXT,
    notified_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  let running = false;

  async function poll() {
    if (running) return;
    running = true;
    try {
      const res = await axios.get(API_URL, { timeout: 15000 });
      const items = Array.isArray(res.data) ? res.data : [];
      if (!items.length) return;

      const seen = await new Promise((resolve) => getSeenIds(resolve));
      const fresh = items
        .filter((p) => p && p.id != null && !seen.has(String(p.id)))
        .reverse(); // API отдаёт новые сверху — шлём в хронологическом порядке

      if (!fresh.length) return;
      console.log(`[epicbet] ${fresh.length} новых профитов`);

      for (const p of fresh) {
        const sent = await sendToTargets(bot, targets, p);
        if (sent > 0) {
          await new Promise((resolve) => markSeen(p, resolve));
        }
      }
    } catch (err) {
      console.error('[epicbet] poll error:', err.message);
    } finally {
      running = false;
    }
  }

  setInterval(poll, POLL_INTERVAL_MS);
  setTimeout(poll, 3000);
}

module.exports = { setupEpicbetProfits };
