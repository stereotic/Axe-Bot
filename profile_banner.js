const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const TEMPLATE_PATHS = [
  path.join(__dirname, 'assets', 'templates', 'profile_bg.jpg'),
  path.join(__dirname, 'images', 'profile_template.jpg')
];

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

const LEVELS = [
  { name: 'NEW', threshold: 0, color: '#ff2f9a', soft: '#ffd7ea' },
  { name: 'PRO', threshold: 30000, color: '#28c7e8', soft: '#d8f7ff' },
  { name: 'MASTER', threshold: 100000, color: '#ffb822', soft: '#fff0bd' },
  { name: 'GOAT', threshold: 300000, color: '#ff5a4f', soft: '#ffe0dd' },
  { name: 'GOLD', threshold: 1000000, color: '#f5c542', soft: '#fff1b8' },
  { name: 'GG', threshold: 5000000, color: '#38e66b', soft: '#dcffe5' }
];

let cachedTemplate = null;

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

function fitText(ctx, text, maxWidth, baseSize, fontFamily = 'Arial') {
  let fontSize = baseSize;
  do {
    ctx.font = `900 ${fontSize}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth) return;
    fontSize -= 2;
  } while (fontSize >= 18);
}

function drawCircleFallback(ctx, centerX, centerY, radius) {
  const gradient = ctx.createRadialGradient(centerX - 24, centerY - 28, 8, centerX, centerY, radius);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(1, '#f1f1f1');

  ctx.fillStyle = gradient;
  ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
}

async function drawAvatar(ctx, avatarSource) {
  const centerX = 640;
  const centerY = 303;
  const radius = 86;

  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.clip();

  if (avatarSource) {
    try {
      const avatar = await loadImage(avatarSource);
      const side = Math.min(avatar.width, avatar.height);
      const sx = (avatar.width - side) / 2;
      const sy = (avatar.height - side) / 2;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(avatar, sx, sy, side, side, centerX - radius, centerY - radius, radius * 2, radius * 2);
    } catch (error) {
      drawCircleFallback(ctx, centerX, centerY, radius);
    }
  } else {
    drawCircleFallback(ctx, centerX, centerY, radius);
  }

  ctx.restore();
}

function drawValue(ctx, value, x, y, width, height, colors) {
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const gradient = ctx.createLinearGradient(x, y, x + width, y);

  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(1, colors[1]);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, value, width - 24, 39);

  ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = gradient;
  ctx.fillText(value, centerX, centerY + 2);

  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function drawProgress(ctx, level, totalEarned) {
  const x = 90;
  const y = 625;
  const width = 1100;
  const height = 73;
  const radius = 24;
  const fillWidth = Math.max(height, (width * level.progress) / 100);
  const remaining = level.next ? 100 - level.progress : 0;
  const label = level.next
    ? `${Math.round(remaining)}% ДО ${level.next.name} • ${formatRub(totalEarned)} / ${formatRub(level.next.threshold)}`
    : `GG MAX • ${formatRub(totalEarned)}`;

  ctx.save();
  roundRect(ctx, x, y, width, height, radius);
  ctx.clip();

  const gradient = ctx.createLinearGradient(x, y, x + width, y);
  gradient.addColorStop(0, level.current.color);
  gradient.addColorStop(0.65, level.next ? level.next.color : level.current.soft);
  gradient.addColorStop(1, level.next ? level.next.soft : '#f4fff6');

  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, fillWidth, height);
  ctx.restore();

  ctx.fillStyle = '#232323';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, label, width - 48, 31);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
  ctx.shadowBlur = 1;
  ctx.shadowOffsetY = 1;
  ctx.fillText(label, x + width / 2, y + height / 2 + 1);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
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

async function renderProfileBanner(profile) {
  const template = await loadTemplate();
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');
  const totalEarned = Number(profile.total_earned || profile.totalEarned || 0);
  const level = getLevel(totalEarned);
  const topPosition = Number(profile.topPosition || profile.top_position || 0);

  ctx.drawImage(template, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  await drawAvatar(ctx, profile.avatarBuffer || profile.avatarUrl);

  drawValue(ctx, level.current.name, 127, 481, 251, 60, [level.current.color, '#ff70bc']);
  drawValue(ctx, topPosition > 0 ? `${topPosition}` : '0', 511, 481, 251, 60, ['#f0ad00', '#ffd24d']);
  drawValue(ctx, formatRub(totalEarned), 902, 481, 251, 60, ['#20c957', '#67e887']);
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
  getLevel,
  formatRub,
  renderProfileBanner,
  buildProfileCaption,
  buildProfileMedia
};
