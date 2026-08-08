const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Worker, isMainThread, parentPort } = require('worker_threads');

const TEMPLATE_PATHS = [
  path.join(__dirname, 'assets', 'templates', 'profile_bg.jpg'),
  path.join(__dirname, 'images', 'profile_template.jpg')
];

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

// Слоты нового шаблона. Координаты сняты с рамок подложки (обводка 1px).
const SLOTS = {
  avatar: { x: 76, y: 95, size: 351, radius: 30 },
  name: { x: 461, y: 89, width: 366, height: 96 },
  status: { x: 915, y: 90, width: 285, height: 95 },
  profitCount: { x: 461, y: 264, width: 749, height: 74 },
  profitSum: { x: 461, y: 420, width: 749, height: 64 },
  progress: { x: 73, y: 551, width: 1133, height: 70, radius: 26 }
};

const NEON = {
  base: '#e9c6ff',
  accent: '#c77dff',
  deep: '#7b2cbf',
  track: 'rgba(18, 6, 30, 0.55)'
};

const LEVELS = [
  { name: 'NEW', threshold: 0, color: '#ff5fb8', soft: '#ffc9e8' },
  { name: 'PRO', threshold: 30000, color: '#4fd8ff', soft: '#c9f4ff' },
  { name: 'MASTER', threshold: 100000, color: '#ffc247', soft: '#ffe9b3' },
  { name: 'GOAT', threshold: 300000, color: '#ff6a5c', soft: '#ffd0cb' },
  { name: 'GOLD', threshold: 1000000, color: '#f7d24a', soft: '#fff0b5' },
  { name: 'GG', threshold: 5000000, color: '#57ff90', soft: '#d2ffe1' }
];

const FONT_FAMILY = resolveFontFamily();

let cachedTemplate = null;

function resolveFontFamily() {
  const fontsDir = path.join(__dirname, 'assets', 'fonts');

  try {
    const files = fs.readdirSync(fontsDir).filter((file) => /\.(ttf|otf)$/i.test(file));
    if (files.length === 0) return 'Arial';

    for (const file of files) {
      registerFont(path.join(fontsDir, file), { family: 'AxeProfile' });
    }

    return 'AxeProfile';
  } catch (error) {
    return 'Arial';
  }
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function loadTemplate() {
  if (cachedTemplate) return cachedTemplate;

  const templatePath = TEMPLATE_PATHS.find((filePath) => fs.existsSync(filePath));
  if (!templatePath) {
    throw new Error('Profile banner template not found');
  }

  cachedTemplate = await loadImage(fs.readFileSync(templatePath));
  return cachedTemplate;
}

function getLevel(totalEarned) {
  const total = Number(totalEarned) || 0;
  let current = LEVELS[0];
  let next = LEVELS[1] || null;

  for (let i = 0; i < LEVELS.length; i += 1) {
    if (total >= LEVELS[i].threshold) {
      current = LEVELS[i];
      next = LEVELS[i + 1] || null;
    }
  }

  const progress = next
    ? Math.max(0, Math.min(100, (total / next.threshold) * 100))
    : 100;

  return { current, next, progress };
}

function formatRub(value) {
  return `${(Number(value) || 0).toLocaleString('ru-RU')}₽`;
}

function fitText(ctx, text, maxWidth, baseSize, minSize = 18) {
  let fontSize = baseSize;
  ctx.font = `900 ${fontSize}px ${FONT_FAMILY}`;

  while (ctx.measureText(text).width > maxWidth && fontSize > minSize) {
    fontSize -= 1;
    ctx.font = `900 ${fontSize}px ${FONT_FAMILY}`;
  }

  return fontSize;
}

// Неон: два прохода тени под один fillText — дальний ореол и ближний контур.
function drawNeonText(ctx, text, centerX, centerY, options) {
  const { maxWidth, size, minSize = 18, fill, glow, glowBlur = 22 } = options;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, text, maxWidth, size, minSize);

  ctx.shadowColor = glow;
  ctx.shadowBlur = glowBlur;
  ctx.fillStyle = fill;
  ctx.fillText(text, centerX, centerY);
  ctx.fillText(text, centerX, centerY);

  ctx.shadowBlur = Math.round(glowBlur / 3);
  ctx.fillText(text, centerX, centerY);
  ctx.restore();
}

function drawSlotText(ctx, slot, text, options) {
  drawNeonText(ctx, text, slot.x + slot.width / 2, slot.y + slot.height / 2, {
    maxWidth: slot.width - 28,
    ...options
  });
}

function drawAvatarFallback(ctx, slot) {
  const gradient = ctx.createLinearGradient(slot.x, slot.y, slot.x + slot.size, slot.y + slot.size);
  gradient.addColorStop(0, '#3c1b5c');
  gradient.addColorStop(1, '#1a0a2b');

  ctx.fillStyle = gradient;
  ctx.fillRect(slot.x, slot.y, slot.size, slot.size);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 132px ${FONT_FAMILY}`;
  ctx.shadowColor = NEON.deep;
  ctx.shadowBlur = 26;
  ctx.fillStyle = NEON.accent;
  ctx.fillText('AXE', slot.x + slot.size / 2, slot.y + slot.size / 2);
  ctx.shadowBlur = 0;
}

async function drawAvatar(ctx, avatarSource) {
  const slot = SLOTS.avatar;

  ctx.save();
  roundRect(ctx, slot.x, slot.y, slot.size, slot.size, slot.radius);
  ctx.clip();

  let drawn = false;

  if (avatarSource) {
    try {
      const avatar = await loadImage(avatarSource);
      const side = Math.min(avatar.width, avatar.height);
      const sx = (avatar.width - side) / 2;
      const sy = (avatar.height - side) / 2;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(avatar, sx, sy, side, side, slot.x, slot.y, slot.size, slot.size);
      drawn = true;
    } catch (error) {
      drawn = false;
    }
  }

  if (!drawn) drawAvatarFallback(ctx, slot);

  // Фиолетовая вуаль поверх фото — аватар садится в палитру подложки.
  const veil = ctx.createLinearGradient(slot.x, slot.y, slot.x, slot.y + slot.size);
  veil.addColorStop(0, 'rgba(123, 44, 191, 0.10)');
  veil.addColorStop(1, 'rgba(40, 8, 66, 0.42)');
  ctx.fillStyle = veil;
  ctx.fillRect(slot.x, slot.y, slot.size, slot.size);

  ctx.restore();

  ctx.save();
  roundRect(ctx, slot.x, slot.y, slot.size, slot.size, slot.radius);
  ctx.strokeStyle = 'rgba(199, 125, 255, 0.85)';
  ctx.lineWidth = 3;
  ctx.shadowColor = NEON.accent;
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.restore();
}

function drawProgress(ctx, level, totalEarned) {
  const { x, y, width, height, radius } = SLOTS.progress;
  const ratio = Math.max(0, Math.min(1, level.progress / 100));
  const fillWidth = Math.max(height, width * ratio);
  const label = level.next
    ? `${formatRub(totalEarned)} / ${formatRub(level.next.threshold)}  •  ${Math.round(100 - level.progress)}% ДО ${level.next.name}`
    : `GG MAX  •  ${formatRub(totalEarned)}`;

  ctx.save();
  roundRect(ctx, x, y, width, height, radius);
  ctx.clip();

  ctx.fillStyle = NEON.track;
  ctx.fillRect(x, y, width, height);

  const gradient = ctx.createLinearGradient(x, y, x + fillWidth, y);
  gradient.addColorStop(0, NEON.deep);
  gradient.addColorStop(0.55, level.current.color);
  gradient.addColorStop(1, level.next ? level.next.color : level.current.color);

  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, fillWidth, height);

  const sheen = ctx.createLinearGradient(x, y, x, y + height);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
  sheen.addColorStop(0.5, 'rgba(255, 255, 255, 0.04)');
  sheen.addColorStop(1, 'rgba(0, 0, 0, 0.20)');
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, fillWidth, height);

  // Светящийся торец заполнения.
  if (ratio > 0 && ratio < 1) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.shadowColor = level.next ? level.next.color : NEON.accent;
    ctx.shadowBlur = 24;
    ctx.fillRect(x + fillWidth - 4, y, 4, height);
    ctx.shadowBlur = 0;
  }

  ctx.restore();

  // Обводка вместо тени: полоса заливается любым цветом, текст читается всегда.
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, label, width - 56, 33, 20);
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(24, 5, 42, 0.92)';
  ctx.strokeText(label, x + width / 2, y + height / 2 + 1);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, x + width / 2, y + height / 2 + 1);
  ctx.restore();
}

async function fetchBuffer(url, attempts = 2) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 5000,
        validateStatus: (status) => status >= 200 && status < 300
      });

      return Buffer.from(response.data);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

const avatarCache = new Map();
const AVATAR_CACHE_TTL = 300000;

async function getTelegramAvatarBuffer(bot, userId) {
  if (!bot || !userId) return null;

  const cached = avatarCache.get(userId);
  if (cached && Date.now() - cached.timestamp < AVATAR_CACHE_TTL) {
    return cached.buffer;
  }

  try {
    const photos = await bot.getUserProfilePhotos(userId, { limit: 1 });
    const photoSizes = photos.photos?.[0];
    if (!photoSizes || photoSizes.length === 0) {
      avatarCache.set(userId, { buffer: null, timestamp: Date.now() });
      return null;
    }

    const fileUrl = await bot.getFileLink(photoSizes[photoSizes.length - 1].file_id);
    const buffer = await fetchBuffer(fileUrl);
    avatarCache.set(userId, { buffer, timestamp: Date.now() });
    return buffer;
  } catch (error) {
    console.error(`Avatar loading failed for user ${userId}:`, error.message);
    avatarCache.set(userId, { buffer: null, timestamp: Date.now() });
    return null;
  }
}

function formatName(rawName) {
  const name = String(rawName || 'UNKNOWN').trim().toUpperCase();
  return name.startsWith('@') || name.startsWith('#') ? '#' + name.replace(/^[@#]/, '') : `#${name}`;
}

function formatCount(value) {
  return (Number(value) || 0).toLocaleString('ru-RU');
}

// ─── Вынос отрисовки в worker_threads ───────────────────────────────────────
// Рендер canvas (~230мс) блокирует event loop в главном потоке. В main-потоке
// renderProfileBanner отправляет задачу воркеру; в воркере этот же файл
// исполняется синхронно. При сбое воркера — синхронный фолбэк.

let renderWorker = null;
let renderQueue = [];
let renderBusy = false;

function ensureRenderWorker() {
  if (renderWorker) return renderWorker;
  renderWorker = new Worker(__filename);
  renderWorker.on('message', (res) => {
    renderBusy = false;
    const pending = renderQueue.shift();
    if (!pending) return;
    if (res && res.error) {
      pending.reject(new Error(res.error));
    } else {
      // structured clone возвращает Uint8Array — возвращаем настоящий Buffer
      pending.resolve(res && res.buffer ? Buffer.from(res.buffer) : res.buffer);
    }
    pumpRenderQueue();
  });
  renderWorker.on('error', (err) => failRenderWorker(err));
  renderWorker.on('exit', () => failRenderWorker(new Error('render worker exited')));
  return renderWorker;
}

function failRenderWorker(err) {
  renderBusy = false;
  if (renderWorker) {
    renderWorker.removeAllListeners();
    renderWorker = null;
  }
  const pending = renderQueue.shift();
  if (pending) pending.reject(err);
}

function pumpRenderQueue() {
  if (renderBusy || renderQueue.length === 0) return;
  const worker = ensureRenderWorker();
  if (!worker) return;
  renderBusy = true;
  worker.postMessage(renderQueue[0].profile);
}

function renderInWorker(profile) {
  return new Promise((resolve, reject) => {
    renderQueue.push({ profile, resolve, reject });
    pumpRenderQueue();
  });
}

if (!isMainThread) {
  parentPort.on('message', async (profile) => {
    try {
      if (profile && profile.avatarBuffer) {
        profile.avatarBuffer = Buffer.from(profile.avatarBuffer);
      }
      const buffer = await renderProfileBanner(profile);
      parentPort.postMessage({ buffer });
    } catch (error) {
      parentPort.postMessage({ error: error.message || String(error) });
    }
  });
}

async function renderProfileBanner(profile) {
  if (isMainThread && process.env.AXE_DISABLE_WORKER !== '1') {
    try {
      return await renderInWorker(profile);
    } catch (error) {
      console.error('Render worker failed, falling back to sync render:', error.message);
    }
  }

  const template = await loadTemplate();
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');
  const totalEarned = Number(profile.total_earned || profile.totalEarned || 0);
  const level = getLevel(totalEarned);
  const status = level.current.name.toUpperCase();

  ctx.drawImage(template, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  await drawAvatar(ctx, profile.avatarBuffer || profile.avatarUrl);

  drawSlotText(ctx, SLOTS.name, formatName(profile.name), {
    size: 52,
    minSize: 22,
    fill: NEON.base,
    glow: NEON.accent
  });

  drawSlotText(ctx, SLOTS.status, status, {
    size: 46,
    minSize: 20,
    fill: level.current.soft,
    glow: level.current.color,
    glowBlur: 26
  });

  drawSlotText(ctx, SLOTS.profitCount, formatCount(profile.profit_count || profile.profitCount), {
    size: 58,
    minSize: 26,
    fill: '#ffffff',
    glow: NEON.accent,
    glowBlur: 26
  });

  drawSlotText(ctx, SLOTS.profitSum, formatRub(totalEarned), {
    size: 54,
    minSize: 24,
    fill: NEON.base,
    glow: NEON.accent,
    glowBlur: 26
  });

  drawProgress(ctx, level, totalEarned);

  return canvas.toBuffer('image/png');
}

function buildProfileCaption(user, topPosition) {
  const level = getLevel(user.total_earned);

  return `<tg-emoji emoji-id="5920344347152224466">👤</tg-emoji><b>Воркер:</b> @${user.username || 'unknown'}
<tg-emoji emoji-id="5936017305585586269">🪪</tg-emoji><b>Name:</b> ${user.name}
└ <b>Статус:</b> ${level.current.name}

<tg-emoji emoji-id="5258204546391351475">💼</tg-emoji><b>Кошелек</b>
└ <b>На вывод:</b> <i>${formatRub(user.balance)}</i>

<tg-emoji emoji-id="5877485980901971030">🏦</tg-emoji><b>Касса воркера:</b> <i>${formatRub(user.total_earned)}</i>
┣ <b>Кол-во профитов:</b> ${user.profit_count || 0}
└ <b>Место в топе:</b> ${topPosition || 0}`;
}

async function buildProfileMedia(bot, user, topPosition) {
  const avatarBuffer = await getTelegramAvatarBuffer(bot, user.user_id);
  const buffer = await renderProfileBanner({
    ...user,
    topPosition,
    avatarBuffer
  });

  return {
    buffer,
    caption: buildProfileCaption(user, topPosition)
  };
}

module.exports = {
  LEVELS,
  SLOTS,
  getLevel,
  formatRub,
  renderProfileBanner,
  buildProfileCaption,
  buildProfileMedia
};
