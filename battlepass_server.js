require('dotenv').config();
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const battlepass = require('./battlepass');
const db = require('./database');

const WEBAPP_DIR = path.join(__dirname, 'webapp');
const PORT = parseInt(process.env.BATTLEPASS_PORT || '8081', 10);
const HOST = process.env.BATTLEPASS_HOST || '0.0.0.0';
// BATTLEPASS_DEV=1 разрешает ?user_id=... без подписи Telegram. Только для локальных тестов.
const DEV_MODE = process.env.BATTLEPASS_DEV === '1';
const DEMO_EARNED = parseInt(process.env.BATTLEPASS_DEMO_EARNED || '30000', 10);
const AUTH_TTL = 24 * 60 * 60; // initData живёт сутки
const PREMIUM_EMOJI_IDS = {
  search: '5874960879434338403',
  settings: '5967574255670399788'
};
const premiumEmojiCache = new Map();
const premiumEmojiLoading = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon'
};

/**
 * Проверка подписи Telegram WebApp initData.
 * secret = HMAC(key="WebAppData", msg=bot_token), затем HMAC(key=secret, msg=data_check_string).
 */
function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  let params;
  try {
    params = new URLSearchParams(initData);
  } catch (e) {
    return null;
  }

  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (!authDate || Math.floor(Date.now() / 1000) - authDate > AUTH_TTL) return null;

  try {
    return JSON.parse(params.get('user') || 'null');
  } catch (e) {
    return null;
  }
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function httpsBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function loadPremiumEmoji(name) {
  if (!PREMIUM_EMOJI_IDS[name]) throw new Error('unknown premium emoji');
  if (premiumEmojiCache.has(name)) return premiumEmojiCache.get(name);
  if (premiumEmojiLoading.has(name)) return premiumEmojiLoading.get(name);

  const loading = (async () => {
    const token = process.env.BOT_TOKEN;
    if (!token) throw new Error('BOT_TOKEN is missing');
    const ids = encodeURIComponent(JSON.stringify([PREMIUM_EMOJI_IDS[name]]));
    const stickerResponse = JSON.parse((await httpsBuffer(
      `https://api.telegram.org/bot${token}/getCustomEmojiStickers?custom_emoji_ids=${ids}`
    )).toString('utf8'));
    const sticker = stickerResponse.result?.[0];
    // Для анимированных emoji используем статичный thumbnail в WebP.
    const fileId = sticker?.thumbnail?.file_id || sticker?.file_id;
    if (!fileId) throw new Error('premium emoji not found');
    const fileResponse = JSON.parse((await httpsBuffer(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`
    )).toString('utf8'));
    const filePath = fileResponse.result?.file_path;
    if (!filePath) throw new Error('premium emoji file path not found');
    const emoji = { body: await httpsBuffer(`https://api.telegram.org/file/bot${token}/${filePath}`), contentType: 'image/webp' };
    premiumEmojiCache.set(name, emoji);
    return emoji;
  })();
  premiumEmojiLoading.set(name, loading);
  try {
    return await loading;
  } finally {
    premiumEmojiLoading.delete(name);
  }
}

function servePremiumEmoji(res, name) {
  loadPremiumEmoji(name).then((emoji) => {
    res.writeHead(200, { 'Content-Type': emoji.contentType, 'Cache-Control': 'public, max-age=86400' });
    res.end(emoji.body);
  }).catch((error) => {
    console.error('[battlepass] premium emoji error:', error.message);
    res.writeHead(404).end();
  });
}

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const target = path.resolve(WEBAPP_DIR, rel);

  if (!target.startsWith(WEBAPP_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }

    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      // В DEV кэш отключён целиком — иначе Telegram держит старую версию app.js.
      'Cache-Control': 'no-store, max-age=0'
    });
    fs.createReadStream(target).pipe(res);
  });
}

function handleState(req, res, url) {
  const botToken = process.env.BOT_TOKEN;
  const initData = url.searchParams.get('initData') || req.headers['x-telegram-init-data'] || '';

  let userId = null;
  const tgUser = verifyInitData(initData, botToken);

  // DEV: ?earned=50000 — посмотреть любой уровень, не трогая базу.
  // Без подписи и без user_id тоже отдаём демо, чтобы голая ссылка не упиралась в 401.
  if (DEV_MODE && !tgUser && !url.searchParams.get('user_id')) {
    const raw = url.searchParams.get('earned');
    const earned = raw === null ? DEMO_EARNED : (parseInt(raw, 10) || 0);
    const state = battlepass.buildState(earned);
    state.user = { userId: 0, username: 'demo', name: '#DEMO', status: 'NEW' };
    state.demo = true;
    sendJson(res, 200, state);
    return;
  }

  if (tgUser && tgUser.id) {
    userId = tgUser.id;
  } else if (DEV_MODE && url.searchParams.get('user_id')) {
    userId = parseInt(url.searchParams.get('user_id'), 10);
  }

  if (!userId) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  battlepass.getStateForUser(userId, (err, state) => {
    if (err) {
      console.error('[battlepass] state error:', err);
      sendJson(res, 500, { error: 'internal' });
      return;
    }
    if (!state) {
      sendJson(res, 404, { error: 'user_not_found' });
      return;
    }
    sendJson(res, 200, state);
  });
}

function resolveWebAppUser(req, url) {
  const initData = url.searchParams.get('initData') || req.headers['x-telegram-init-data'] || '';
  const user = verifyInitData(initData, process.env.BOT_TOKEN);
  if (user && user.id) return user;
  if (DEV_MODE && url.searchParams.get('user_id')) return { id: parseInt(url.searchParams.get('user_id'), 10) };
  return null;
}

function getProfits(res) {
  db.all(`SELECT p.id, p.amount, p.direction, p.created_at, u.user_id, u.username, u.name, u.curator,
                 u.profit_avatar, u.profit_background
          FROM profits p JOIN users u ON u.user_id = p.user_id
          ORDER BY p.created_at DESC, p.id DESC LIMIT 100`, (err, rows) => {
    if (err) return sendJson(res, 500, { error: 'internal' });
    sendJson(res, 200, { profits: rows || [] });
  });
}

function getProfitSettings(req, res, url) {
  const user = resolveWebAppUser(req, url);
  if (!user) return sendJson(res, 401, { error: 'unauthorized' });
  db.get('SELECT user_id, username, name, profit_avatar, profit_background FROM users WHERE user_id = ?', [user.id], (err, row) => {
    if (err) return sendJson(res, 500, { error: 'internal' });
    if (!row) return sendJson(res, 404, { error: 'user_not_found' });
    sendJson(res, 200, { user: row });
  });
}

function readJson(req, callback) {
  let raw = '';
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > 1_500_000) req.destroy();
  });
  req.on('end', () => {
    try { callback(null, JSON.parse(raw || '{}')); } catch (error) { callback(error); }
  });
  req.on('error', callback);
}

function validImage(value) {
  return value === null || (typeof value === 'string' && /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(value) && value.length <= 1_000_000);
}

function saveProfitSettings(req, res, url) {
  const user = resolveWebAppUser(req, url);
  if (!user) return sendJson(res, 401, { error: 'unauthorized' });
  readJson(req, (error, body) => {
    if (error || !validImage(body.avatar) || !validImage(body.background)) return sendJson(res, 400, { error: 'invalid_image' });
    db.run('UPDATE users SET profit_avatar = ?, profit_background = ? WHERE user_id = ?', [body.avatar, body.background, user.id], function onSave(err) {
      if (err) return sendJson(res, 500, { error: 'internal' });
      if (!this.changes) return sendJson(res, 404, { error: 'user_not_found' });
      sendJson(res, 200, { ok: true });
    });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/state') {
    handleState(req, res, url);
    return;
  }

  if (url.pathname === '/api/profits' && req.method === 'GET') return getProfits(res);
  if (url.pathname === '/api/profit-settings' && req.method === 'GET') return getProfitSettings(req, res, url);
  if (url.pathname === '/api/profit-settings' && req.method === 'POST') return saveProfitSettings(req, res, url);
  if (url.pathname.startsWith('/api/premium-emoji/') && req.method === 'GET') {
    return servePremiumEmoji(res, url.pathname.split('/').pop());
  }

  if (url.pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  serveStatic(req, res, url.pathname);
});

function startBattlePassServer() {
  server.listen(PORT, HOST, () => {
    console.log(`🎁 Battle Pass mini app: http://${HOST}:${PORT}${DEV_MODE ? ' (DEV: ?user_id= разрешён)' : ''}`);
  });
  server.on('error', (err) => console.error('[battlepass] server error:', err));
  return server;
}

module.exports = { startBattlePassServer, verifyInitData };

if (require.main === module) startBattlePassServer();
