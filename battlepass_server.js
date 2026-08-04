require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const battlepass = require('./battlepass');

const WEBAPP_DIR = path.join(__dirname, 'webapp');
const PORT = parseInt(process.env.BATTLEPASS_PORT || '8081', 10);
const HOST = process.env.BATTLEPASS_HOST || '0.0.0.0';
// BATTLEPASS_DEV=1 разрешает ?user_id=... без подписи Telegram. Только для локальных тестов.
const DEV_MODE = process.env.BATTLEPASS_DEV === '1';
const DEMO_EARNED = parseInt(process.env.BATTLEPASS_DEMO_EARNED || '30000', 10);
const AUTH_TTL = 24 * 60 * 60; // initData живёт сутки

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
      'Cache-Control': (DEV_MODE || ext === '.html') ? 'no-store' : 'public, max-age=300'
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/state') {
    handleState(req, res, url);
    return;
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
