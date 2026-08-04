const db = require('./database');

// ─── Экономика ────────────────────────────────────────────────────────────────
// За каждые полные RUB_PER_STEP рублей кассы воркера начисляется XP_PER_STEP.
// 30.000₽ -> floor(30000/10000) = 3 шага -> 3 * 0.5 = 1.5 XP
const RUB_PER_STEP = 10000;
const XP_PER_STEP = 0.5;

// Стоимость КАЖДОГО уровня в XP. Уровни 1-5 по 1 XP, уровни 6-10 по 2 XP.
// Полный пасс = 5*1 + 5*2 = 15 XP = 300.000₽ кассы.
const LEVELS = [
  { level: 1,  xpCost: 1, title: 'Физ номер',                 image: 'img/gift_1.jpg',  link: null },
  { level: 2,  xpCost: 1, title: 'Instant Ramen',             image: 'img/gift_2.jpg',  link: 'https://t.me/nft/InstantRamen-384646' },
  { level: 3,  xpCost: 1, title: 'TG Premium 1 месяц',        image: 'img/gift_3.jpg',  link: null },
  { level: 4,  xpCost: 1, title: 'Swag bag',                  image: 'img/gift_4.jpg',  link: 'https://t.me/nft/SwagBag-13402' },
  { level: 5,  xpCost: 1, title: '3 физ номера',              image: 'img/gift_5.jpg',  link: null },
  { level: 6,  xpCost: 2, title: 'TG Premium · 3 месяца',     image: 'img/gift_6.jpg',  link: null },
  { level: 7,  xpCost: 2, title: 'Vintage Cigar',             image: 'img/gift_7.jpg',  link: 'https://t.me/nft/VintageCigar-11995' },
  { level: 8,  xpCost: 2, title: 'Swiss Watch',               image: 'img/gift_8.jpg',  link: 'https://t.me/nft/SwissWatch-23130' },
  { level: 9,  xpCost: 4,  title: 'Билет на розыгрыш 1000$',   image: 'img/gift_9.jpg',  link: null, ticketName: '1000' },
  { level: 10, xpCost: 10, title: 'Билет на MacBook Air M4',   image: 'img/gift_10.jpg', link: null, ticketName: 'MacBook AIR m4' }
];

// Накопительные пороги: [1, 2, 3, 4, 5, 7, 9, 11, 13, 15]
const THRESHOLDS = LEVELS.reduce((acc, lvl) => {
  acc.push((acc[acc.length - 1] || 0) + lvl.xpCost);
  return acc;
}, []);

const MAX_XP = THRESHOLDS[THRESHOLDS.length - 1];

function xpFromEarned(totalEarned) {
  const steps = Math.floor(Math.max(0, totalEarned) / RUB_PER_STEP);
  return steps * XP_PER_STEP;
}

/**
 * Синхронный расчёт состояния пасса по сумме кассы.
 */
function buildState(totalEarned) {
  const xp = xpFromEarned(totalEarned);

  let level = 0;
  for (let i = 0; i < THRESHOLDS.length; i++) {
    if (xp >= THRESHOLDS[i]) level = i + 1;
    else break;
  }

  const passedXp = level > 0 ? THRESHOLDS[level - 1] : 0;
  const nextCost = level < LEVELS.length ? LEVELS[level].xpCost : 0;
  const intoLevel = Math.max(0, xp - passedXp);
  const xpToNext = level < LEVELS.length ? Math.max(0, nextCost - intoLevel) : 0;
  const rubToNext = Math.ceil(xpToNext / XP_PER_STEP) * RUB_PER_STEP;

  return {
    totalEarned,
    xp,
    maxXp: MAX_XP,
    level,
    maxLevel: LEVELS.length,
    intoLevel,
    nextLevelCost: nextCost,
    xpToNext,
    rubToNext,
    levelProgress: nextCost > 0 ? Math.min(1, intoLevel / nextCost) : 1,
    totalProgress: Math.min(1, xp / MAX_XP),
    rubPerStep: RUB_PER_STEP,
    xpPerStep: XP_PER_STEP,
    levels: LEVELS.map((lvl, i) => ({
      level: lvl.level,
      title: lvl.title,
      image: lvl.image,
      link: lvl.link,
      xpCost: lvl.xpCost,
      requiredXp: THRESHOLDS[i],
      requiredRub: Math.ceil(THRESHOLDS[i] / XP_PER_STEP) * RUB_PER_STEP,
      unlocked: xp >= THRESHOLDS[i]
    }))
  };
}

/**
 * Состояние пасса для конкретного воркера.
 */
function getStateForUser(userId, callback) {
  db.get(
    'SELECT user_id, username, name, status, battlepass_earned FROM users WHERE user_id = ?',
    [userId],
    (err, user) => {
      if (err) return callback(err);
      if (!user) return callback(null, null);

      const state = buildState(user.battlepass_earned || 0);
      state.user = {
        userId: user.user_id,
        username: user.username || null,
        name: user.name || '#',
        status: user.status || 'NEW'
      };
      callback(null, state);
    }
  );
}

module.exports = {
  LEVELS,
  THRESHOLDS,
  MAX_XP,
  RUB_PER_STEP,
  XP_PER_STEP,
  xpFromEarned,
  buildState,
  getStateForUser
};
