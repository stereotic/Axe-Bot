require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');
const keyboards = require('./keyboards');
const utils = require('./utils');
const cardSystem = require('./card_system');
const { setupCardHandlers } = require('./card_handlers');
const { setupCardViewHandlers, startCardRequestInPrivate, startCardCheckInPrivate } = require('./card_view_handlers');
const { setupCardRequestHandlers } = require('./card_request_handlers');
const { setupCheckHandlers } = require('./check_handlers');
const { setupProfitSystem } = require('./profit_system');
const fs = require('fs');
const path = require('path');
const os = require('os');
const profileBanner = require('./profile_banner');
const { loadPinnedMessageId, updatePinnedMessage } = require('./update_pinned');
const { setupRassSystem, isRassEditing, cancelRassEdit } = require('./rass');
const { startBattlePassServer } = require('./battlepass_server');
const battlepass = require('./battlepass');
const statusChats = require('./status_chats');
const { setupEpicbetProfits } = require('./epicbet_profits');
const guard = require('./guard');
const perf = require('./perf');
const { parseProfitText, parseProfitMention, parseProfitCommand } = require('./profit_parser');
const { acquire: acquireSingleInstance } = require('./single_instance');
const { mentors, getMentorByIndex, getMentorByUsername, resolveMentorChatId, notifyCuratorOfProfit } = require('./curators');
const { setupAutoProfits, cancelAutoFlow, AUTO_USER_ID_BASE } = require('./auto_profits');
const { sendPrizeNotifications } = require('./prize_notifications');

// Короткий текст, если нет картинки для меню (пустой sendMessage/caption Telegram отклоняет).
const MENU_PANEL_FALLBACK = 'Выбери раздел:';

const token = process.env.BOT_TOKEN;
const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim())).filter(Boolean) : [];
const PAYOUT_ADMIN_IDS = [6383039210, 7800697491]; // ID для получения заявок на выплату

// ID каналов для profit system
const ACCOUNTING_CHAT_ID = '-1003606797013'; // Бухгалтерия
const CASH_CHANNEL_ID = '-1003924744333'; // Общая касса (https://t.me/+euO9gzLMUMFhNmJi)
const GENERAL_CHAT_ID = '-1003986505552'; // Общий чат

// Временное хранилище для данных профита
const profitData = {};
global.profitData = profitData;

// Данные куратора (см. ./curators)

// Полные месяцы с даты найма (ДД.ММ.ГГГГ)
function calcMonthsOnPosition(hiredAt) {
  if (!hiredAt) return 0;
  const [d, m, y] = String(hiredAt).split('.').map(Number);
  if (!d || !m || !y) return 0;
  const hired = new Date(y, m - 1, d);
  const now = new Date();
  let months = (now.getFullYear() - hired.getFullYear()) * 12 + (now.getMonth() - hired.getMonth());
  if (now.getDate() < hired.getDate()) months -= 1;
  return Math.max(0, months);
}

function monthsLabel(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} месяц`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} месяца`;
  return `${n} месяцев`;
}

// Временное хранилище для заявок
const applicationData = {};

// Временное хранилище для режима рассылки
const broadcastMode = {};

// ID каналов для проверки подписки
const REQUIRED_CHAT_ID = '-1003986505552'; // AXE | CHAT (https://t.me/+1EwzBdEWNQgxYWFi)
const REQUIRED_CHANNEL_ID = '-1003772027635'; // AXE | NEWS (https://t.me/+BO1F4O1KUd0zZTI6)

const telegramProxy = process.env.TELEGRAM_PROXY?.trim();
const botOptions = {
  polling: {
    interval: 100,
    autoStart: true,
    params: {
      timeout: 30
    }
  }
};
if (telegramProxy) {
  botOptions.request = { proxy: telegramProxy };
  console.log(`🌐 Telegram API через прокси: ${telegramProxy}`);
}

// Защита от нескольких запущенных экземпляров с одним BOT_TOKEN.
const instanceLock = acquireSingleInstance();
if (!instanceLock.ok) {
  console.error('🛑 ' + instanceLock.message);
  process.exit(1);
}

const bot = new TelegramBot(token, botOptions);

// Кэш file_id статичных картинок меню: первая отправка грузит файл,
// последующие — пересылают по file_id без повторной загрузки на сервер Telegram.
// Сухранём на диск: file_id глобальны для бота, а правка меню на месте (editMessageMedia)
// требует file_id — значит кэш должен переживать рестарт.
const PHOTO_CACHE_FILE = path.join(__dirname, '.photo_file_id_cache.json');

function loadPhotoCache() {
  try {
    if (fs.existsSync(PHOTO_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(PHOTO_CACHE_FILE, 'utf8'));
      if (data && typeof data === 'object') return new Map(Object.entries(data));
    }
  } catch (err) {
    console.error('Photo cache load failed:', err);
  }
  return new Map();
}

function savePhotoCache() {
  try {
    fs.writeFileSync(PHOTO_CACHE_FILE, JSON.stringify(Object.fromEntries(photoFileIdCache)), 'utf8');
  } catch (err) {
    console.error('Photo cache save failed:', err);
  }
}

const photoFileIdCache = loadPhotoCache();

async function sendMenuPhoto(chatId, imagePath, extra = {}) {
  const cachedFileId = photoFileIdCache.get(imagePath);
  if (cachedFileId) {
    return bot.sendPhoto(chatId, cachedFileId, extra);
  }

  const sent = await bot.sendPhoto(chatId, imagePath, extra);
  try {
    const photos = sent && sent.photo;
    if (photos && photos.length) {
      photoFileIdCache.set(imagePath, photos[photos.length - 1].file_id);
      savePhotoCache();
    }
  } catch (_) { /* кэш не критичен */ }
  return sent;
}

// Подключаем обработчики системы реквизитов
setupCardHandlers(bot, adminIds, GENERAL_CHAT_ID, ACCOUNTING_CHAT_ID, CASH_CHANNEL_ID);
setupCardViewHandlers(bot);
setupCardRequestHandlers(bot, adminIds);
setupCheckHandlers(bot, adminIds, GENERAL_CHAT_ID, ACCOUNTING_CHAT_ID, CASH_CHANNEL_ID);
setupProfitSystem(bot, adminIds);
setupRassSystem(bot, adminIds);
setupAutoProfits(bot, adminIds);
setupEpicbetProfits(bot, adminIds);
startBattlePassServer();
statusChats.migrateExistingWorkers(bot);
backfillReferralBlocked(bot);
logRefProfitSource();

// Устанавливаем меню команд бота
bot.setMyCommands([
  { command: 'me', description: 'Мой профиль' },
  { command: 'staff', description: 'Состав администрации' },
  { command: 'materials', description: 'Обучающие материалы' },
  { command: 'top', description: 'Топ воркеров за все время' },
  { command: 'card', description: 'Актуальные реквизиты' },
  { command: 'keyboard', description: 'Показать кнопки Меню и Информация' }
]).then(() => {
  console.log('✅ Меню команд установлено');
}).catch((err) => {
  console.error('❌ Ошибка установки меню команд:', err);
});

// Обработка ошибок polling
bot.on('polling_error', (error) => {
  const msg = error.message || String(error);
  console.error('Polling error:', error.code, msg);
  if (msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET') || msg.includes('ECONNREFUSED')) {
    console.error(
      '⚠️ Нет связи с api.telegram.org. Бот не получает /start и не может отвечать.\n' +
        '   • Включи VPN или укажи TELEGRAM_PROXY в .env (например http://127.0.0.1:7890)\n' +
        '   • Не запускай локально бота, если он уже работает на сервере с тем же BOT_TOKEN'
    );
  }
});

// Обработка общих ошибок
bot.on('error', (error) => {
  console.error('Bot error:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Реферальная статистика: фиксируем, кто из приведённых заблокировал бота
// (статус kicked в личке). Разблокировка (повторный /start) сбрасывает флаг.
bot.on('my_chat_member', (update) => {
  if (!update || !update.chat || update.chat.type !== 'private') return;
  const status = update.new_chat_member && update.new_chat_member.status;
  if (status !== 'kicked' && status !== 'member' && status !== 'administrator') return;
  const userId = update.chat.id;
  const blocked = status === 'kicked' ? 1 : 0;
  db.run('UPDATE users SET referral_blocked = ? WHERE user_id = ?', [blocked, userId], (err) => {
    if (err) console.error('Error updating referral_blocked:', err);
  });
});

// Заливка флагов на старте: трекер не знает, кто блокировал бота ДО его установки.
// Проверяем личку каждого принятого воркера: блокировавший — либо статус kicked
// в ответе, либо Telegram отвечает 403 «bot was blocked by the user».
// Дальше my_chat_member держит флаг актуальным.
function backfillReferralBlocked(bot) {
  db.all('SELECT user_id FROM users WHERE application_approved = 1', (err, users) => {
    if (err || !users || !users.length) return;
    const queue = users.slice();
    const CONCURRENCY = 15;
    let running = 0;
    let checked = 0;
    let foundBlocked = 0;

    const isBlockedError = (err) => {
      try {
        const msg = String((err && err.message) || '');
        const desc = (err && err.response && err.response.body && err.response.body.description) || '';
        return /bot was blocked by the user/i.test(msg + ' ' + desc);
      } catch (_) {
        return false;
      }
    };

    const pump = () => {
      while (running < CONCURRENCY && queue.length) {
        running += 1;
        const uid = queue.shift();
        bot.getChatMember(uid, uid)
          .then((member) => {
            const blocked = member && member.status === 'kicked' ? 1 : 0;
            if (blocked) foundBlocked += 1;
            db.run('UPDATE users SET referral_blocked = ? WHERE user_id = ?', [blocked, uid]);
          })
          .catch((apiErr) => {
            if (isBlockedError(apiErr)) {
              foundBlocked += 1;
              db.run('UPDATE users SET referral_blocked = 1 WHERE user_id = ?', [uid]);
            }
          })
          .finally(() => {
            running -= 1;
            checked += 1;
            pump();
          });
      }
      if (checked >= users.length) {
        console.log(`✅ referral_blocked залит: проверено ${checked} воркеров, заблокировавших ${foundBlocked}`);
      }
    };

    pump();
  });
}

// Стартовая диагностика /ref: что лежит в profits на этой базе.
function logRefProfitSource() {
  db.get('SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS sum FROM profits', (err, row) => {
    if (err) return;
    console.log(`/ref источник: профитов в profits = ${row.cnt}, сумма = ${row.sum}₽`);
  });
}

let infoBannerCache = { text: null, timestamp: 0 };
const INFO_BANNER_CACHE_TTL = 60000;

const INFO_BANNER = () => {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    if (infoBannerCache.text && (now - infoBannerCache.timestamp) < INFO_BANNER_CACHE_TTL) {
      resolve(infoBannerCache.text);
      return;
    }

    const excludedNames = ['@sss','@Testovhik','@тестик','тестик','@testovhik','testovhik','test','#test'].map(n => `'${n.replace(/'/g, "''")}'`).join(',');
    const excludedUsernames = ['sss','freeobnall','test'].map(n => `'${n.replace(/'/g, "''")}'`).join(',');

    db.get(`SELECT COALESCE(SUM(p.amount), 0) as total, COUNT(p.id) as count
            FROM profits p JOIN users u ON p.user_id = u.user_id
            WHERE LOWER(TRIM(COALESCE(u.name, ''))) NOT IN (${excludedNames})
              AND LOWER(TRIM(COALESCE(u.username, ''))) NOT IN (${excludedUsernames})`, (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      const projectBalance = parseInt(row?.total || '0');
      const totalProfits = parseInt(row?.count || '0');
      const banner = `<b>AXE TEAM - Информация </b>

<tg-emoji emoji-id="5987880246865565644">💸</tg-emoji><b>Проценты выплат
┣Букмекер - 70%
┣Кардинг - 80%
┗Прямой перевод - 75%</b>

<tg-emoji emoji-id="5956561916573782596">🏠</tg-emoji><b>Сервисы</b>
┣ <b>Букмекер
┗ Кардинг</b>

<tg-emoji emoji-id="5258330865674494479">🏦</tg-emoji><b>Касса проекта: </b><b><i>${projectBalance.toLocaleString('en-US')}₽</i>
┗Кол-во профитов: </b><b><i>${totalProfits} шт</i></b>

<tg-emoji emoji-id="5258419835922030550">📆</tg-emoji><b>Дата открытия проекта 06.06.2026.</b>`;

      infoBannerCache = { text: banner, timestamp: now };
      resolve(banner);
    });
  });
};

const WORK_INFO = `<b><tg-emoji emoji-id="5257969839313526622">🏠</tg-emoji>Сервис:</b> <b>Кардинг</b> 

<b><tg-emoji emoji-id="5258093637450866522">🤖</tg-emoji>Бот</b> <i>(Магазин)</i>
┗ @CrystalCC_xBot

<tg-emoji emoji-id="5258513401784573443">👾</tg-emoji><b>ТП</b> <i>(Обнальщик)</i>
┣ @Opium2D
┗ 👨‍💻: @Enhtein

<b><tg-emoji emoji-id="5258328383183396223">📚</tg-emoji> Мануал</b>:
┗ <a href="https://telegra.ph/Napravlenie-Karding-05-12">Кардинг</a> ← Читать

• <b>WORK-Панель</b>, <i>и  реферальная ссылка находится в </i><i><b>магазине</b> по команде</i> /bb`;

const BOOKMAKER_INFO = `<b><tg-emoji emoji-id="5257969839313526622">🏠</tg-emoji>Сервис: Букмекер

<tg-emoji emoji-id="5879585266426973039">🌐</tg-emoji>Сайт
┗ https://epicbet.space/

<tg-emoji emoji-id="5258513401784573443">👾</tg-emoji>Тех.Поддержка
┣ [9-21] @Aether_AXE
┗ [21-9] @Daryl_AXE

<tg-emoji emoji-id="5258328383183396223">📚</tg-emoji> Мануал:
┗ <a href="https://telegra.ph/Fejk-BK-06-21">Букмекер</a> ← Читать

• WORK-Панель открывается в формате WEB и MiniApp</b>`;

const FEEDBACK_INFO = `• <b>Feedback</b>

<b><tg-emoji emoji-id="5260535596941582167">📨</tg-emoji>Связаться с администрацией</b>
┗ @FeedbackAXEbot`;



// Функция получения топ 1 воркера за сутки
function getTopWorkerToday(callback) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  db.get(`
    SELECT u.name, u.username, SUM(p.amount) as daily_profit
    FROM users u
    JOIN profits p ON u.user_id = p.user_id
    WHERE DATE(p.created_at) = ?
    GROUP BY u.user_id
    ORDER BY daily_profit DESC
    LIMIT 1
  `, [todayStr], (err, row) => {
    if (err) {
      console.error('Error getting top worker:', err);
      callback(null);
      return;
    }
    callback(row);
  });
}

// Закреп: касса/топ за сутки из БД (обновление каждые 10 мин, сутки по localtime)
setInterval(() => updatePinnedMessage(bot, GENERAL_CHAT_ID), 10 * 60 * 1000);

// Первое обновление через 5 секунд после запуска (с загрузкой ID из базы)
setTimeout(async () => {
  await loadPinnedMessageId();
  await updatePinnedMessage(bot, GENERAL_CHAT_ID);
}, 5000);

// Вспомогательные функции
function getUser(userId, callback) {
  db.get('SELECT * FROM users WHERE user_id = ?', [userId], callback);
}

function createUser(userId, username, referredBy) {
  utils.generateWorkerNumber((err, workerNumber) => {
    if (err) {
      console.error('Error generating worker number:', err);
      return;
    }

    const defaultName = `Worker${workerNumber}`;
    db.run(
      'INSERT OR IGNORE INTO users (user_id, username, name, worker_number, application_approved, welcome_keyboard_sent, referred_by) VALUES (?, ?, ?, ?, 0, 0, ?)',
      [userId, username, defaultName, workerNumber, referredBy || null]
    );
  });
}

// Функция обновления username пользователя
function updateUsername(userId, username) {
  if (!username) return; // Если username пустой, не обновляем

  db.run('UPDATE users SET username = ? WHERE user_id = ?', [username, userId], (err) => {
    if (err) {
      console.error('Error updating username:', err);
    }
  });
}

// Граница «фейковых» аккаунтов: реальные Telegram id её никогда не достигают.
// Рисованые пользователи (Date.now()-id и авто-воркеры 900000000000+) живут выше неё.
const FAKE_USER_ID_MIN = 10000000000;

// В команде профита указывается Telegram username. Тег профиля (#Name)
// используем только как запасной вариант поиска.
function findWorkerForProfit(identifier, callback) {
  const worker = String(identifier || '').trim().replace(/^[@#]+/, '');
  const tag = `#${worker}`.toLowerCase();
  const username = worker.toLowerCase();

  db.get(
    `SELECT * FROM users
     WHERE LOWER(TRIM(COALESCE(name, ''))) = ?
        OR LOWER(TRIM(COALESCE(username, ''))) = ?
     ORDER BY CASE WHEN LOWER(TRIM(COALESCE(username, ''))) = ? THEN 0 ELSE 1 END
     LIMIT 1`,
    [tag, username, username],
    callback
  );
}

// Функция форматирования профиля
function formatProfile(user, topPosition) {
  const status = utils.getStatusByTotal(user.total_earned || 0);
  return `<tg-emoji emoji-id="5920344347152224466">👤</tg-emoji><b>Воркер:</b> @${user.username || 'unknown'}
<tg-emoji emoji-id="5936017305585586269">🪪</tg-emoji><b>Name:</b> ${user.name}
┗ <b>Статус:</b> ${status}

<tg-emoji emoji-id="5258204546391351475">💼</tg-emoji><b>Кошелек</b>
┗ <b>На вывод:</b> <i>${user.balance.toLocaleString()}₽</i>

<b><tg-emoji emoji-id="5877485980901971030">🏦</tg-emoji>Касса воркера:</b> <i>${user.total_earned.toLocaleString()}₽</i>
┣ <b>Кол-во профитов:</b> ${user.profit_count}
┗ <b>Место в топе:</b> ${topPosition}`;
}

async function sendProfileMessage(chatId, user, topPosition, options = {}) {
  try {
    const profileMedia = await perf.wrap('buildProfileMedia', profileBanner.buildProfileMedia.bind(profileBanner))(bot, user, topPosition);

    const sendOptions = {
      caption: profileMedia.caption,
      parse_mode: 'HTML'
    };

    // Добавляем reply_markup только если он явно указан или не передан параметр
    if (options.reply_markup !== undefined) {
      if (options.reply_markup !== null) {
        sendOptions.reply_markup = options.reply_markup;
      }
    } else {
      sendOptions.reply_markup = keyboards.profile();
    }

    const message = await bot.sendPhoto(chatId, profileMedia.buffer, sendOptions);

    return message;
  } catch (error) {
    console.error('Profile banner error:', error);

    const sendOptions = {
      parse_mode: 'HTML'
    };

    // Добавляем reply_markup только если он явно указан или не передан параметр
    if (options.reply_markup !== undefined) {
      if (options.reply_markup !== null) {
        sendOptions.reply_markup = options.reply_markup;
      }
    } else {
      sendOptions.reply_markup = keyboards.profile();
    }

    const message = await bot.sendMessage(chatId, profileBanner.buildProfileCaption(user, topPosition), sendOptions);

    return message;
  }
}

async function updateProfileMessage(chatId, messageId, user, topPosition, options = {}) {
  const replyMarkup = options.reply_markup !== undefined ? options.reply_markup : keyboards.profile();

  let profileMedia;
  try {
    profileMedia = await perf.wrap('buildProfileMedia', profileBanner.buildProfileMedia.bind(profileBanner))(bot, user, topPosition);
  } catch (error) {
    console.error('Profile banner render error:', error);
    return bot.editMessageText(profileBanner.buildProfileCaption(user, topPosition), {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: replyMarkup
    }).catch(() => {});
  }

  // Правка на месте: свежий баннер грузим во временный файл и подменяем медиа
  // через editMessageMedia. iOS не пикает уведомление при edit, только при send.
  const tmpPath = path.join(os.tmpdir(), `axe_profile_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
  fs.writeFileSync(tmpPath, profileMedia.buffer);

  try {
    await bot.editMessageMedia({
      type: 'photo',
      media: 'attach://' + tmpPath,
      caption: profileMedia.caption,
      parse_mode: 'HTML'
    }, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup
    });
  } catch (mediaErr) {
    // Сообщение может быть текстовым (фолбэк без картинки) — правим текст.
    try {
      await bot.editMessageText(profileMedia.caption, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      });
    } catch (textErr) {
      console.error('Profile in-place edit failed, resend fallback:', telegramErrorSummary(mediaErr), telegramErrorSummary(textErr));
      await sendProfileMessage(chatId, user, topPosition, { reply_markup: replyMarkup });
      await bot.deleteMessage(chatId, messageId).catch(() => {});
    }
  } finally {
    fs.unlink(tmpPath, () => {});
  }
}

function telegramErrorSummary(err) {
  if (!err) return '';
  try {
    const raw = err.response && err.response.body;
    let b = raw;
    if (typeof raw === 'string') {
      try {
        b = JSON.parse(raw);
      } catch (_) {
        b = null;
      }
    }
    if (b && typeof b === 'object' && b.description) {
      return `${b.error_code || '—'} ${b.description}`;
    }
  } catch (_) {}
  return err.message || String(err);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function entitiesToHtml(text, entities) {
  if (!text) return '';
  if (!entities || !entities.length) return escapeHtml(text);

  const events = [];

  for (const entity of entities) {
    const offset = entity.offset;
    const length = entity.length;
    let openTag, closeTag;

    switch (entity.type) {
      case 'bold':
        openTag = '<b>'; closeTag = '</b>'; break;
      case 'italic':
        openTag = '<i>'; closeTag = '</i>'; break;
      case 'underline':
        openTag = '<u>'; closeTag = '</u>'; break;
      case 'strikethrough':
        openTag = '<s>'; closeTag = '</s>'; break;
      case 'code':
        openTag = '<code>'; closeTag = '</code>'; break;
      case 'pre':
        openTag = '<pre>'; closeTag = '</pre>'; break;
      case 'spoiler':
        openTag = '<tg-spoiler>'; closeTag = '</tg-spoiler>'; break;
      case 'text_link':
        openTag = `<a href="${escapeHtml(entity.url)}">`; closeTag = '</a>'; break;
      case 'text_mention':
        openTag = `<a href="tg://user?id=${entity.user.id}">`; closeTag = '</a>'; break;
      case 'custom_emoji':
        openTag = `<tg-emoji emoji-id="${entity.custom_emoji_id}">`; closeTag = '</tg-emoji>'; break;
      case 'blockquote':
        openTag = '<blockquote>'; closeTag = '</blockquote>'; break;
      case 'expandable_blockquote':
        openTag = '<blockquote>'; closeTag = '</blockquote>'; break;
      default:
        continue;
    }

    events.push({ pos: offset, open: true, tag: openTag, closeTag, entity });
    events.push({ pos: offset + length, open: false, tag: closeTag, entity });
  }

  // По позиции; на одной позиции закрытия идут раньше открытий.
  events.sort((a, b) => a.pos - b.pos || (a.open ? 1 : 0) - (b.open ? 1 : 0));

  const stack = [];
  let result = '';
  let lastPos = 0;

  for (const ev of events) {
    if (ev.pos > lastPos) {
      result += escapeHtml(text.slice(lastPos, ev.pos));
      lastPos = ev.pos;
    }

    if (ev.open) {
      result += ev.tag;
      stack.push(ev);
      continue;
    }

    // Находим открытие этой сущности в стеке; сущности в Telegram не
    // пересекаются, только вложены — поэтому всё, что лежит выше, закрываем
    // первым (LIFO). Это чинит вложенные жирный+эмодзи и одинаковые позиции.
    let idx = -1;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].entity === ev.entity) { idx = i; break; }
    }
    if (idx === -1) continue;

    while (stack.length > idx) {
      result += stack.pop().closeTag;
    }
  }

  if (lastPos < text.length) result += escapeHtml(text.slice(lastPos));
  return result;
}

function isApplicationApproved(user) {
  return Boolean(user && Number(user.application_approved) === 1);
}

// Полный доступ к боту (прошёл подписку после одобрения заявки).
function hasFullAccess(user) {
  return isApplicationApproved(user);
}

// Допуск к командам бота — только полностью принятые пользователи.
// Если юзер в чате, но в БД не одобрен/не создан (не проходил /start) —
// членство в общем чате считается достаточным доказательством регистрации.
async function requireFullAccess(userId, chatId, contact) {
  const user = await new Promise((resolve) => {
    db.get('SELECT application_approved FROM users WHERE user_id = ?', [userId], (err, user) => {
      if (err) {
        // Транзиентная ошибка чтения БД (блокировка при массовых записях и т.п.).
        // Не вешаем ложный отказ «не зарегистрирован» на легитимного пользователя.
        console.error('requireFullAccess DB error:', err.message);
        return resolve(null);
      }
      resolve(user);
    });
  });

  if (user === null) return true; // транзиентная ошибка — не блокируем
  if (user && Number(user.application_approved) === 1) return true;

  if (contact) {
    const granted = await utils.ensureMemberAccess(bot, userId, contact);
    if (granted) return true;
  }

  bot.sendMessage(chatId, '❌ Команда недоступна. Пройдите регистрацию и дождитесь одобрения заявки администрацией.')
    .catch(() => {});
  return false;
}

function resetOnboardingProgress(userId, callback) {
  db.run(
    'UPDATE users SET application_approved = 0, welcome_keyboard_sent = 0 WHERE user_id = ?',
    [userId],
    callback || (() => {})
  );
}

function isSubscribedChatMember(member) {
  if (!member) return false;
  if (['member', 'administrator', 'creator'].includes(member.status)) return true;
  // Ограниченный участник чата всё ещё считается подписанным
  if (member.status === 'restricted' && member.is_member) return true;
  return false;
}

const WELCOME_KEYBOARD_TEXT = '<tg-emoji emoji-id="5445088267181531740">🪓</tg-emoji>';

// Панель «Информация» — текст AXE TEAM, общие чаты и закрытые по статусу кнопки.
async function sendInfoPanel(chatId, userId, options = {}) {
  const banner = await INFO_BANNER();
  const imagePath = path.join(__dirname, 'images', 'menu.jpg');
  const reply_markup = await statusChats.buildInfoKeyboardForUser(userId);
  const sendOpts = {
    parse_mode: 'HTML',
    disable_notification: options.disableNotification === true,
    reply_markup
  };

  if (fs.existsSync(imagePath)) {
    return sendMenuPhoto(chatId, imagePath, { caption: banner, ...sendOpts });
  }
  return bot.sendMessage(chatId, banner, sendOpts);
}

// Reply-клавиатура «Меню» / «Информация» (отдельное сообщение, не удалять).
function sendWelcomeKeyboardMessage(chatId, options = {}) {
  return bot.sendMessage(chatId, WELCOME_KEYBOARD_TEXT, {
    parse_mode: 'HTML',
    reply_markup: keyboards.main,
    disable_notification: options.disableNotification !== false
  });
}

function isMissingColumnError(err) {
  return Boolean(err && /no such column/i.test(String(err.message)));
}

function getWelcomeKeyboardSent(userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT welcome_keyboard_sent FROM users WHERE user_id = ?', [userId], (err, row) => {
      if (isMissingColumnError(err)) {
        return resolve(false);
      }
      if (err) {
        return reject(err);
      }
      resolve(Number(row?.welcome_keyboard_sent) === 1);
    });
  });
}

function markWelcomeKeyboardSent(userId) {
  return new Promise((resolve, reject) => {
    db.run('UPDATE users SET welcome_keyboard_sent = 1 WHERE user_id = ?', [userId], function onMark(err) {
      if (isMissingColumnError(err)) {
        return resolve();
      }
      if (err) {
        return reject(err);
      }
      resolve();
    });
  });
}

// Один раз после полного принятия (подписка): приветствие с reply-клавиатурой, затем инфо.
async function showWelcomeAfterApproval(chatId, userId) {
  const alreadySent = await getWelcomeKeyboardSent(userId);

  if (!alreadySent) {
    await sendWelcomeKeyboardMessage(chatId, { disableNotification: true });
    await markWelcomeKeyboardSent(userId);
  }

  await sendInfoPanel(chatId, userId, { disableNotification: true });
}

async function completeOnboardingAfterSubscription(chatId, userId, subscriptionMessageId) {
  try {
    await showWelcomeAfterApproval(chatId, userId);
    if (subscriptionMessageId) {
      await bot.deleteMessage(chatId, subscriptionMessageId).catch(() => {});
    }
  } catch (err) {
    console.error(`completeOnboardingAfterSubscription failed for ${userId}:`, telegramErrorSummary(err));
    await bot
      .sendMessage(
        chatId,
        '✅ Подписка подтверждена, но не удалось отправить приветствие. Нажмите /start — если не поможет, напишите администратору.'
      )
      .catch(() => {});
  }
}

async function sendMainKeyboard(chatId, options = {}) {
  return sendWelcomeKeyboardMessage(chatId, options);
}

function finalizeUserApproval(userId, callback) {
  db.run('UPDATE users SET application_approved = 1 WHERE user_id = ?', [userId], (err) => {
    if (err) {
      console.error('Error finalizing user approval:', err);
    }
    if (callback) callback(err);
  });
}

// Редактируем текущий экран на месте вместо «отправить новое + удалить старое»,
// чтобы кнопки меню не спам-Uп. opts: { type: 'photo', imagePath, caption | caption },
// либо { type: 'text', text, ... }; общий shape: { reply_markup, parse_mode }.
// Если редактирование не вышло (фото↔текст, нет кэшированного file_id и т.п.) —
// падаем на старое поведение: отправить новый экран и удалить прежний.
function replaceMenuMessage(chatId, messageId, opts) {
  const renderNew = () => {
    if (opts.type === 'photo') {
      return sendMenuPhoto(chatId, opts.imagePath, {
        caption: opts.caption,
        parse_mode: opts.parse_mode,
        reply_markup: opts.reply_markup
      });
    }
    return bot.sendMessage(chatId, opts.text, {
      parse_mode: opts.parse_mode,
      reply_markup: opts.reply_markup
    });
  };

  const editInPlace = () => {
    if (opts.type === 'photo') {
      const fileId = photoFileIdCache.get(opts.imagePath);
      // file_id в кэше — пересылка без загрузки. Кэш холодный (после рестарта) —
      // грузим файл заново через attach:// прямо в edit, без delete+resend.
      const media = fileId ? fileId : 'attach://' + opts.imagePath;
      return bot.editMessageMedia(
        {
          type: 'photo',
          media,
          caption: opts.caption,
          parse_mode: opts.parse_mode
        },
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: opts.reply_markup
        }
      );
    }
    return bot.editMessageText(opts.text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: opts.parse_mode,
      reply_markup: opts.reply_markup
    });
  };

  return Promise.resolve(editInPlace())
    .catch((err) => {
      console.error(`editMenu failed for ${chatId}, fallback to resend:`, telegramErrorSummary(err));
      return renderNew().then(() => bot.deleteMessage(chatId, messageId).catch(() => {}));
    })
    .catch((err) => {
      console.error(`replaceMenuMessage failed for ${chatId}:`, telegramErrorSummary(err));
      return bot.sendMessage(chatId, '❌ Не удалось открыть раздел. Попробуйте ещё раз.').catch(() => {});
    });
}

// Функция для предотвращения дублирования callback (единый guard)
function shouldProcessCallback(userId, callbackData) {
  return guard.shouldProcessCallback(userId, callbackData);
}
const walletAddressInput = {};
// Ожидание подтверждения адреса: userId -> { type, address }
const walletPendingConfirm = {};

const getPayoutLabel = (method) => {
  if (method === 'trc20') return 'TRC20';
  if (method === 'bep20') return 'BEP20';
  return 'CryptoBot';
};

const buildWalletText = (user) => {
  const method = user.payout_method || 'cryptobot';
  const address = method === 'trc20' ? user.trc20_address : (method === 'bep20' ? user.bep20_address : '');
  let text = '💼 Кошелек для выплаты\n\n';
  text += `Текущий способ: ${getPayoutLabel(method)}`;
  if (address) {
    text += `\nАдрес: <code>${address}</code>`;
  }
  return text;
};

const showWalletScreen = (chatId, messageId, user, hasPhoto) => {
  const walletText = buildWalletText(user);
  const walletKeyboard = keyboards.payout_wallet(user.payout_method || 'cryptobot');
  if (hasPhoto) {
    bot.editMessageCaption(walletText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: walletKeyboard
    }).catch(() => {
      bot.sendMessage(chatId, walletText, { parse_mode: 'HTML', reply_markup: walletKeyboard }).catch(() => {});
    });
  } else {
    bot.editMessageText(walletText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: walletKeyboard
    }).catch(() => {
      bot.sendMessage(chatId, walletText, { parse_mode: 'HTML', reply_markup: walletKeyboard }).catch(() => {});
    });
  }
};

// Функция переноса профиля
function transferProfileData(sourceUserId, targetUserId, chatId) {
  db.get('SELECT * FROM users WHERE user_id = ?', [sourceUserId], (err, sourceUser) => {
    if (err || !sourceUser) {
      bot.sendMessage(chatId, '❌ Исходный профиль не найден');
      return;
    }

    // Переносим все данные
    db.run(`UPDATE users SET
      name = ?,
      status = ?,
      balance = ?,
      total_earned = ?,
      battlepass_earned = ?,
      battlepass_xp = ?,
      profit_count = ?,
      profile_hidden = ?,
      curator = ?,
      percent = ?
      WHERE user_id = ?`,
      [
        sourceUser.name,
        sourceUser.status,
        sourceUser.balance,
        sourceUser.total_earned,
        sourceUser.battlepass_earned || 0,
        sourceUser.battlepass_xp || 0,
        sourceUser.profit_count,
        sourceUser.profile_hidden,
        sourceUser.curator,
        sourceUser.percent,
        targetUserId
      ],
      (err) => {
        if (err) {
          bot.sendMessage(chatId, '❌ Ошибка переноса профиля');
          return;
        }

        // Переносим профиты
        db.run('UPDATE profits SET user_id = ? WHERE user_id = ?', [targetUserId, sourceUserId], (err) => {
          if (err) {
            console.error('Error transferring profits:', err);
          }

          utils.getTopPosition(targetUserId, (err, position) => {
            const topPosition = err ? 0 : position;

            db.get('SELECT * FROM users WHERE user_id = ?', [targetUserId], (err, user) => {
              if (err || !user) {
                bot.sendMessage(chatId, '✅ Профиль успешно перенесен!');
                return;
              }

              const profileText = `✅ Профиль успешно перенесен!\n\n${formatProfile(user, topPosition)}`;

              bot.sendMessage(chatId, profileText, { parse_mode: 'HTML' });
            });
          });
        });
      }
    );
  });
}

// Функция обработки защищенных callback'ов
function handleProtectedCallback(query, data, chatId, userId) {
  const messageId = query.message.message_id;
  const hasPhoto = query.message.photo ? true : false;

  // Telegram считает лимит caption (1024) по видимым символам: HTML-разметка
  // и теги <tg-emoji> в длину не идут. Считаем именно её.
  const captionLength = (html) => html
    .replace(/<tg-emoji[^>]*>.*?<\/tg-emoji>/g, 'X')
    .replace(/<[^>]+>/g, '')
    .length;

  // Карточка куратора
  if (data.startsWith('show_mentor_')) {
    const mentorIndex = parseInt(data.replace('show_mentor_', ''), 10);
    const mentor = getMentorByIndex(mentorIndex);
    if (!mentor) {
      bot.answerCallbackQuery(query.id, { text: '❌ Куратор не найден', show_alert: true });
      return;
    }
    bot.answerCallbackQuery(query.id);

    // Получаем количество учеников куратора
    db.get('SELECT COUNT(*) as count FROM users WHERE curator = ?', [mentor.username], (err, result) => {
      const studentsCount = err ? 0 : result.count;
      const monthsOnPosition = calcMonthsOnPosition(mentor.hiredAt);

      const mentorText = `<tg-emoji emoji-id="5992157823838984339">👨‍🏫</tg-emoji><b>Куратор:</b> <b>@${mentor.username}</b>

┏ <tg-emoji emoji-id="5956561916573782596">🏠</tg-emoji><b>Сервисы</b> - ${mentor.service}
┣<tg-emoji emoji-id="5875291072225087249">⏰</tg-emoji><b>На должности</b> - ${monthsLabel(monthsOnPosition)}
┣<tg-emoji emoji-id="5942877472163892475">🤵‍♂️</tg-emoji><b>Обучается</b> - ${studentsCount} чел
┣<tg-emoji emoji-id="5879813604068298387">⚖️</tg-emoji><b>Процент с профита</b> - ${mentor.percent}%
┣<tg-emoji emoji-id="5776213190387961618">📚</tg-emoji><b>Время обучения</b> - ${mentor.trainingProfits} профитов
┗<tg-emoji emoji-id="5877396173135811032">⏳</tg-emoji><b>Рабочее время</b> - ${mentor.workingHours} Мск

<tg-emoji emoji-id="5276240711795107620">⚠️</tg-emoji><b>Описание:</b>
<i>${mentor.description}</i>

<tg-emoji emoji-id="5278611606756942667">❤️</tg-emoji><b>Что ты получаешь?:</b>
${mentor.benefits}`;

      const mentorKeyboard = {
        inline_keyboard: [
          [{ text: 'Закрепиться за куратором', callback_data: `assign_mentor_${mentorIndex}` }],
          [{ text: 'Назад', callback_data: 'training' }]
        ]
      };

      const mentorBannerPath = path.join(__dirname, 'images', mentor.banner);

      // Telegram: лимит caption у фото — 1024 видимых символа. Разметка не
      // считается, поэтому сравниваем знак без HTML-тегов. Если карточка
      // длиннее — отправляем текстом (лимит 4096), иначе фото с капшеном отвалится.
      if (fs.existsSync(mentorBannerPath) && captionLength(mentorText) <= 1024) {
        replaceMenuMessage(chatId, messageId, {
          type: 'photo',
          imagePath: mentorBannerPath,
          caption: mentorText,
          parse_mode: 'HTML',
          reply_markup: mentorKeyboard
        });
      } else {
        replaceMenuMessage(chatId, messageId, {
          type: 'text',
          text: mentorText,
          parse_mode: 'HTML',
          reply_markup: mentorKeyboard
        });
      }
    });
    return;
  }

  // Закрепление за куратором
  if (data.startsWith('assign_mentor_')) {
    const mentorIndex = parseInt(data.replace('assign_mentor_', ''), 10);
    const mentor = getMentorByIndex(mentorIndex);
    if (!mentor) {
      bot.answerCallbackQuery(query.id, { text: '❌ Куратор не найден', show_alert: true });
      return;
    }

    // Воркер не может быть закреплён за двумя кураторами сразу
    db.get('SELECT curator FROM users WHERE user_id = ?', [userId], (checkErr, checkUser) => {
      if (!checkErr && checkUser && checkUser.curator) {
        bot.answerCallbackQuery(query.id, {
          text: '❌ Вы не можете быть закреплены за двумя кураторами сразу',
          show_alert: true
        });
        return;
      }

      bot.answerCallbackQuery(query.id);

      // Закрепляем пользователя за куратором и сохраняем его процент
      db.run('UPDATE users SET curator = ?, percent = ? WHERE user_id = ?', [mentor.username, mentor.percent, userId], (err) => {
        if (err) {
          bot.sendMessage(chatId, '❌ Ошибка закрепления за куратором');
          console.error('Error assigning mentor:', err);
          return;
        }

        // Баг 3 исправлен: отправляем в личку пользователю (userId), а не в текущий чат (chatId)
        bot.sendMessage(userId, `✅ Вы успешно закрепились за куратором @${mentor.username}!`).catch(err => {
          console.error('Error sending to user:', err);
        });

        // Уведомляем куратора: Новый ученик
        db.get('SELECT username FROM users WHERE user_id = ?', [userId], (err, user) => {
          const username = user && user.username ? `@${user.username}` : `ID: ${userId}`;
          resolveMentorChatId(db, mentor, (mentorChatId) => {
            if (!mentorChatId) return;
            bot.sendMessage(
              mentorChatId,
              `<tg-emoji emoji-id="5445178551689062106">🟩</tg-emoji>Новый ученик: ${username}`,
              { parse_mode: 'HTML' }
            ).catch(err => {
              console.error('Error sending to mentor:', err);
            });
          });
        });
      });
    });
    return;
  }

  switch (data) {
    case 'back_to_menu':
      bot.answerCallbackQuery(query.id);
      const menuImagePath = path.join(__dirname, 'images', 'info.jpg');

      if (fs.existsSync(menuImagePath)) {
        replaceMenuMessage(chatId, messageId, {
          type: 'photo',
          imagePath: menuImagePath,
          reply_markup: keyboards.menu
        });
      } else {
        replaceMenuMessage(chatId, messageId, {
          type: 'text',
          text: MENU_PANEL_FALLBACK,
          reply_markup: keyboards.menu
        });
      }
      break;

    case 'profile':
      bot.answerCallbackQuery(query.id);
      getUser(userId, (err, user) => {
        if (err || !user) {
          bot.answerCallbackQuery(query.id, { text: '❌ Ошибка получения профиля', show_alert: true });
          return;
        }

        utils.getTopPosition(userId, async (err, position) => {
          const topPosition = err ? 0 : position;

          try {
            await updateProfileMessage(chatId, messageId, user, topPosition);
          } catch (error) {
            console.error('Profile menu navigation error:', error);
            bot.sendMessage(chatId, '❌ Не удалось открыть профиль. Попробуйте ещё раз.').catch(() => {});
          }
        });
      });
      break;

    case 'battlepass_unavailable':
      bot.answerCallbackQuery(query.id, {
        text: 'AXE PASS временно недоступен. Попробуйте ещё раз позже.',
        show_alert: true
      });
      break;

    case 'card':
      bot.answerCallbackQuery(query.id);
      const bookmakerImagePath = path.join(__dirname, 'images', 'bookmaker.jpg');

if (fs.existsSync(bookmakerImagePath)) {
        replaceMenuMessage(chatId, messageId, {
          type: 'photo',
          imagePath: bookmakerImagePath,
          caption: BOOKMAKER_INFO,
          reply_markup: keyboards.bookmaker,
          parse_mode: 'HTML'
        });
      } else {
        replaceMenuMessage(chatId, messageId, {
          type: 'text',
          text: BOOKMAKER_INFO,
          reply_markup: keyboards.bookmaker,
          parse_mode: 'HTML'
        });
      }
      break;

    case 'work':
      bot.answerCallbackQuery(query.id);
      const workImagePath = path.join(__dirname, 'images', 'work.jpg');

      if (fs.existsSync(workImagePath)) {
        replaceMenuMessage(chatId, messageId, {
          type: 'photo',
          imagePath: workImagePath,
          caption: WORK_INFO,
          reply_markup: keyboards.work,
          parse_mode: 'HTML'
        });
      } else {
        replaceMenuMessage(chatId, messageId, {
          type: 'text',
          text: WORK_INFO,
          reply_markup: keyboards.work,
          parse_mode: 'HTML'
        });
      }
      break;

    case 'training':
      bot.answerCallbackQuery(query.id);
      const trainingImagePath = path.join(__dirname, 'images', 'training.jpg');

      // Создаем клавиатуру с кураторами
      const trainingKeyboard = {
        inline_keyboard: [
          ...mentors.map((m, i) => [{ text: `@${m.username}  ${m.percent}%`, callback_data: `show_mentor_${i}` }]),
          [{ text: 'Назад в меню', callback_data: 'back_to_menu' }]
        ]
      };

      if (fs.existsSync(trainingImagePath)) {
        replaceMenuMessage(chatId, messageId, {
          type: 'photo',
          imagePath: trainingImagePath,
          caption: '<b><i>Тег куратора • Процент</i></b>',
          parse_mode: 'HTML',
          reply_markup: trainingKeyboard
        });
      } else {
        replaceMenuMessage(chatId, messageId, {
          type: 'text',
          text: '<b>Обучение</b>\n\n<b><i>Тег куратора • Процент</i></b>',
          parse_mode: 'HTML',
          reply_markup: trainingKeyboard
        });
      }
      break;

    case 'community':
      bot.answerCallbackQuery(query.id);
      const communityImagePath = path.join(__dirname, 'images', 'buy_card.jpg');
      const communityText = '<b><tg-emoji emoji-id="5260687119092817530">⭐️</tg-emoji>Для создания комьюнити необходимо согласование администрации.\n\nОбратитесь в Feedback</b>';

      const communityKeyboard = {
        inline_keyboard: [
          [{ text: 'Feedback', url: 'https://t.me/FeedbackAXEbot' }],
          [{ text: 'Назад в меню', callback_data: 'back_to_menu' }]
        ]
      };

      if (fs.existsSync(communityImagePath)) {
        replaceMenuMessage(chatId, messageId, {
          type: 'photo',
          imagePath: communityImagePath,
          caption: communityText,
          parse_mode: 'HTML',
          reply_markup: communityKeyboard
        });
      } else {
        replaceMenuMessage(chatId, messageId, {
          type: 'text',
          text: communityText,
          parse_mode: 'HTML',
          reply_markup: communityKeyboard
        });
      }
      break;

    case 'feedback':
      bot.answerCallbackQuery(query.id);
      const feedbackImagePath = path.join(__dirname, 'images', 'feedback.jpg');

      if (fs.existsSync(feedbackImagePath)) {
        replaceMenuMessage(chatId, messageId, {
          type: 'photo',
          imagePath: feedbackImagePath,
          caption: FEEDBACK_INFO,
          parse_mode: 'HTML',
          reply_markup: keyboards.feedback
        });
      } else {
        replaceMenuMessage(chatId, messageId, {
          type: 'text',
          text: FEEDBACK_INFO,
          parse_mode: 'HTML',
          reply_markup: keyboards.feedback
        });
      }
      break;

    case 'settings':
      bot.answerCallbackQuery(query.id);
      const settingsImagePath = path.join(__dirname, 'images', 'settings.jpg');
      const settingsText = '⚙️ Настройки';

      if (fs.existsSync(settingsImagePath)) {
        replaceMenuMessage(chatId, messageId, {
          type: 'photo',
          imagePath: settingsImagePath,
          reply_markup: keyboards.settings_menu
        });
      } else {
        replaceMenuMessage(chatId, messageId, {
          type: 'text',
          text: settingsText,
          reply_markup: keyboards.settings_menu
        });
      }
      break;

    case 'materials':
      bot.answerCallbackQuery(query.id);
      const materialsImagePath = path.join(__dirname, 'images', 'materials.jpg');
      const materialsText = '📂 Материалы\n\nЗдесь будут доступны обучающие материалы';

      if (fs.existsSync(materialsImagePath)) {
        replaceMenuMessage(chatId, messageId, {
          type: 'photo',
          imagePath: materialsImagePath,
          caption: materialsText
        });
      } else {
        replaceMenuMessage(chatId, messageId, {
          type: 'text',
          text: materialsText
        });
      }
      break;

    case 'profile_settings':
      bot.answerCallbackQuery(query.id);
      db.get('SELECT profile_hidden, curator FROM users WHERE user_id = ?', [userId], (err, user) => {
        if (err) {
          bot.answerCallbackQuery(query.id, { text: '❌ Ошибка', show_alert: true });
          return;
        }

        const settingsImagePath = path.join(__dirname, 'images', 'settings.jpg');
        const settingsText = '⚙️ Настройки профиля';

        if (fs.existsSync(settingsImagePath)) {
          replaceMenuMessage(chatId, messageId, {
            type: 'photo',
            imagePath: settingsImagePath,
            reply_markup: keyboards.profile_settings(user.profile_hidden, user.curator)
          });
        } else {
          replaceMenuMessage(chatId, messageId, {
            type: 'text',
            text: settingsText,
            reply_markup: keyboards.profile_settings(user.profile_hidden, user.curator)
          });
        }
      });
      break;

    case 'payout_wallet':
      bot.answerCallbackQuery(query.id);
      getUser(userId, (err, user) => {
        if (err || !user) {
          bot.answerCallbackQuery(query.id, { text: '❌ Ошибка', show_alert: true });
          return;
        }
        showWalletScreen(chatId, messageId, user, hasPhoto);
      });
      break;

    case 'wallet_set_cryptobot':
      bot.answerCallbackQuery(query.id, { text: '✅ CryptoBot установлен' });
      db.run("UPDATE users SET payout_method = 'cryptobot' WHERE user_id = ?", [userId], (err) => {
        if (err) {
          console.error('Error setting payout_method:', err);
          return;
        }
        getUser(userId, (err, user) => {
          if (err || !user) return;
          showWalletScreen(chatId, messageId, user, hasPhoto);
        });
      });
      break;

    case 'wallet_set_trc20':
      bot.answerCallbackQuery(query.id);
      walletAddressInput[userId] = { type: 'trc20' };
      bot.sendMessage(chatId, '🔃Отправьте ваш адрес ТРС20', {
        reply_markup: { inline_keyboard: [[{ text: 'Назад', callback_data: 'wallet_cancel_input' }]] }
      }).catch(() => {});
      break;

    case 'wallet_set_bep20':
      bot.answerCallbackQuery(query.id);
      walletAddressInput[userId] = { type: 'bep20' };
      bot.sendMessage(chatId, '🔃Отправьте ваш адрес BEP20', {
        reply_markup: { inline_keyboard: [[{ text: 'Назад', callback_data: 'wallet_cancel_input' }]] }
      }).catch(() => {});
      break;

    case 'wallet_cancel_input':
      bot.answerCallbackQuery(query.id);
      delete walletAddressInput[userId];
      delete walletPendingConfirm[userId];
      getUser(userId, (err, user) => {
        if (err || !user) return;
        showWalletScreen(chatId, messageId, user, hasPhoto);
      });
      break;

    case 'change_name':
      // Не отвечаем сразу: табличка-уведомление об успехе отдаётся после
      // применения имени, как у ошибок вывода. Кнопка держит спиннер до конца ввода.
      const askName = () => {
        // Для ввода данных отправляем новое сообщение
        bot.sendMessage(chatId, '✍️Введите новый ник:').then((sent) => {
          const questionMessageId = sent.message_id;

          guard.setPendingInput(userId, chatId, (msg) => {
            if (msg.chat.id !== chatId) return;
            if (!msg.text) return;

            guard.clearPendingInput(userId);

            const newName = msg.text;

            if (!utils.validateWorkerName(newName)) {
              // Убираем неверный ответ и ошибку, затем переспрашиваем
              if (msg.message_id) bot.deleteMessage(chatId, msg.message_id).catch(() => {});
              if (questionMessageId) bot.deleteMessage(chatId, questionMessageId).catch(() => {});
              bot.sendMessage(chatId, '❌ Недопустимое имя. Используйте только русские/английские буквы, цифры, _, !, ?, $, ₽ (от 3 до 20 символов)');
              askName();
              return;
            }

            db.run('UPDATE users SET name = ? WHERE user_id = ?', [`#${newName}`, userId], (err) => {
              // Удаляем сообщение с вопросом и ответ пользователя
              if (msg.message_id) {
                bot.deleteMessage(chatId, msg.message_id).catch(() => {});
              }
              if (questionMessageId) {
                bot.deleteMessage(chatId, questionMessageId).catch(() => {});
              }

              if (err) {
                bot.answerCallbackQuery(query.id, { text: '❌ Ошибка изменения имени', show_alert: true });
                return;
              }

              // Табличка успеха вместо отдельного сообщения + профиля.
              // Пользователь остаётся в настройках.
              bot.answerCallbackQuery(query.id, { text: '✅ Имя успешно изменено!', show_alert: true });
            });
          });
        });
      };

      askName();
      break;

    case 'hide_profile':
      db.get('SELECT profile_hidden, curator FROM users WHERE user_id = ?', [userId], (err, user) => {
        if (err) {
          bot.answerCallbackQuery(query.id, { text: '❌ Ошибка', show_alert: true });
          return;
        }

        const newState = user.profile_hidden ? 0 : 1;
        const message = newState ? '✅ Профиль скрыт' : '✅ Профиль открыт';

        db.run('UPDATE users SET profile_hidden = ? WHERE user_id = ?', [newState, userId], (err) => {
          if (err) {
            bot.answerCallbackQuery(query.id, { text: '❌ Ошибка', show_alert: true });
          } else {
            // Показываем всплывающее уведомление
            bot.answerCallbackQuery(query.id, { text: message, show_alert: false });

            // Обновляем клавиатуру с новым состоянием
            bot.editMessageReplyMarkup(keyboards.profile_settings(newState, user.curator), {
              chat_id: chatId,
              message_id: messageId
            }).catch(() => {});
          }
        });
      });
      break;

    case 'detach_curator':
      db.get('SELECT curator, profile_hidden FROM users WHERE user_id = ?', [userId], (err, user) => {
        if (err) {
          bot.answerCallbackQuery(query.id, { text: '❌ Ошибка', show_alert: true });
          return;
        }

        if (!user || !user.curator) {
          bot.answerCallbackQuery(query.id, { text: '❌ Вы не закреплены за куратором', show_alert: true });
          return;
        }

        const curatorName = user.curator;
        const mentor = getMentorByUsername(curatorName);

        db.run('UPDATE users SET curator = NULL, percent = NULL WHERE user_id = ?', [userId], (updErr) => {
          if (updErr) {
            bot.answerCallbackQuery(query.id, { text: '❌ Ошибка отвязки', show_alert: true });
            console.error('Error detaching curator:', updErr);
            return;
          }

          bot.answerCallbackQuery(query.id, { text: '✅ Вы отвязались от куратора', show_alert: true });

          // Обновляем клавиатуру настроек — кнопка отвязки исчезает
          bot.editMessageReplyMarkup(keyboards.profile_settings(user.profile_hidden, null), {
            chat_id: chatId,
            message_id: messageId
          }).catch(() => {});

          // Уведомляем куратора, что ученик отвязался
          if (mentor) {
            db.get('SELECT username, name FROM users WHERE user_id = ?', [userId], (err, student) => {
              const username = student && student.username ? `@${student.username}` : `ID: ${userId}`;
              resolveMentorChatId(db, mentor, (mentorChatId) => {
                if (!mentorChatId) return;
                bot.sendMessage(
                  mentorChatId,
                  `🟥Ученик отвязался от куратора: ${username}`,
                  { parse_mode: 'HTML' }
                ).catch(err => {
                  console.error('Error sending to mentor:', err);
                });
              });
            });
          }
        });
      });
      break;

    case 'transfer_profile':
      bot.answerCallbackQuery(query.id);
      // Для ввода данных отправляем новое сообщение
      bot.sendMessage(chatId, '📨Отправьте id или @ аккаунта с которого желаете перенести профиль:');

      guard.setPendingInput(userId, chatId, (msg) => {
        if (msg.chat.id !== chatId) return;
        if (!msg.text) return;

        guard.clearPendingInput(userId);

        let sourceUserId = msg.text.trim();

        // Убираем @ если есть
        if (sourceUserId.startsWith('@')) {
          // Ищем по username
          const username = sourceUserId.substring(1);
          db.get('SELECT * FROM users WHERE username = ?', [username], (err, sourceUser) => {
            if (err || !sourceUser) {
              bot.sendMessage(chatId, '❌ Пользователь не найден');
              return;
            }
            transferProfileData(sourceUser.user_id, userId, chatId);
          });
        } else {
          // Предполагаем что это ID
          const sourceId = parseInt(sourceUserId);
          if (isNaN(sourceId)) {
            bot.sendMessage(chatId, '❌ Неверный формат ID');
            return;
          }
          transferProfileData(sourceId, userId, chatId);
        }
      });
      break;

    case 'withdraw':
      bot.answerCallbackQuery(query.id);
      getUser(userId, (err, user) => {
        if (err || !user) {
          bot.answerCallbackQuery(query.id, { text: '❌ Ошибка получения профиля', show_alert: true });
          return;
        }

        if (user.balance <= 0) {
          bot.answerCallbackQuery(query.id, { text: '❌ Недостаточно средств для вывода', show_alert: true });
          return;
        }

        const payoutMethod = user.payout_method || 'cryptobot';
        const payoutAddress = payoutMethod === 'trc20' ? user.trc20_address : (payoutMethod === 'bep20' ? user.bep20_address : '');

        const withdrawText = `<tg-emoji emoji-id="5951665980273858529">📨</tg-emoji><b>Создание заявки на выплату!</b>
<tg-emoji emoji-id="5967390100357648692">💸</tg-emoji><b>Сумма выплаты: ${user.balance.toLocaleString()}₽</b>
<b>⚙️Способ выплаты: ${getPayoutLabel(payoutMethod)}</b>${payoutAddress ? `\n<code>${payoutAddress}</code>` : ''}`;

        const withdrawKeyboard = {
          inline_keyboard: [
            [
              { text: 'Создать', callback_data: 'confirm_withdraw' },
              { text: 'Отменить', callback_data: 'cancel_withdraw' }
            ],
            [{ text: '💼 Кошелек для выплаты', callback_data: 'payout_wallet' }]
          ]
        };

        // Редактируем сообщение вместо отправки нового
        if (hasPhoto) {
          bot.editMessageCaption(withdrawText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: withdrawKeyboard
          }).catch(() => {
            bot.sendMessage(chatId, withdrawText, { parse_mode: 'HTML', reply_markup: withdrawKeyboard });
          });
        } else {
          bot.editMessageText(withdrawText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: withdrawKeyboard
          }).catch(() => {
            bot.sendMessage(chatId, withdrawText, { parse_mode: 'HTML', reply_markup: withdrawKeyboard });
          });
        }
      });
      break;

    case 'cancel_withdraw':
      bot.answerCallbackQuery(query.id, { text: '❌ Отменено' });
      // Возвращаемся к профилю
      getUser(userId, (err, user) => {
        if (err || !user) return;

        utils.getTopPosition(userId, (err, position) => {
          const topPosition = err ? 0 : position;
          const profileText = formatProfile(user, topPosition);

          if (hasPhoto) {
            bot.editMessageCaption(profileText, {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'HTML',
              reply_markup: keyboards.profile()
            }).catch(() => {});
          } else {
            bot.editMessageText(profileText, {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'HTML',
              reply_markup: keyboards.profile()
            }).catch(() => {});
          }
        });
      });
      break;

    case 'profile_refresh':
      getUser(userId, async (err, user) => {
        if (err || !user) {
          bot.answerCallbackQuery(query.id, { text: '❌ Ошибка', show_alert: true });
          return;
        }

        utils.getTopPosition(userId, async (err, topPosition) => {
          const position = err ? 0 : topPosition;

          try {
            await updateProfileMessage(chatId, messageId, user, position);
            bot.answerCallbackQuery(query.id, { text: '✅ Профиль обновлен' });
          } catch (error) {
            console.error('Profile refresh error:', error);
            bot.answerCallbackQuery(query.id, { text: '❌ Ошибка обновления', show_alert: true });
          }
        });
      });
      break;

  }
}

// Команда /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || '';

  // Обновляем username пользователя
  updateUsername(userId, username);

  const startParam = (msg.text.match(/\/start(?:@\w+)?\s+(\S+)/) || [])[1];
  if (startParam === 'card_request' && msg.chat.type === 'private') {
    startCardRequestInPrivate(bot, userId).catch((err) => {
      console.error('Error starting card request from deep link:', err);
    });
    return;
  }

  if (startParam === 'card_check' && msg.chat.type === 'private') {
    startCardCheckInPrivate(bot, userId).catch((err) => {
      console.error('Error starting card check from deep link:', err);
    });
    return;
  }

  // Реферальная ссылка /start ref_<id>: фиксируем пригласившего.
  let referredBy = null;
  const refMatch = startParam && startParam.match(/^ref_(\d+)$/);
  if (refMatch && msg.chat.type === 'private') {
    const parsedRef = parseInt(refMatch[1], 10);
    if (parsedRef && parsedRef !== userId) referredBy = parsedRef;
  }

  // Проверяем есть ли параметр (для просмотра профиля)
  const match = msg.text.match(/\/start\s+profile_(\d+)(?:_n_(.+))?/);

  if (match) {
    const targetUserId = parseInt(match[1]);
    const targetNameB64 = match[2] || null;

    // Аккаунты авто-публикации (фейковые воркеры) — при просмотре всегда «закрыты»
    if (targetUserId >= AUTO_USER_ID_BASE) {
      db.get('SELECT id FROM auto_profit_users WHERE id = ?', [targetUserId - AUTO_USER_ID_BASE], (err, autoRow) => {
        if (!err && autoRow) {
          bot.sendMessage(chatId, '❌ <b>Аккаунт закрыт</b>', { parse_mode: 'HTML' }).catch(() => {});
          return;
        }
        bot.sendMessage(chatId, '❌ <b>Пользователь скрыл профиль</b>', { parse_mode: 'HTML' }).catch(() => {});
      });
      return;
    }

    const showProfileOrHidden = (userToShow) => {
      if (!userToShow || userToShow.profile_hidden) {
        bot.sendMessage(chatId, '❌ <b>Пользователь скрыл профиль</b>', { parse_mode: 'HTML' });
        return;
      }
      bot.getChat(userToShow.user_id).then(() => {
        utils.getTopPosition(userToShow.user_id, (err2, pos) => {
          sendProfileMessage(chatId, userToShow, err2 ? 0 : pos, { reply_markup: null }).catch(() => {});
        });
      }).catch(() => {
        bot.sendMessage(chatId, '❌ <b>Пользователь скрыл профиль</b>', { parse_mode: 'HTML' });
      });
    };

    db.get('SELECT * FROM users WHERE user_id = ?', [targetUserId], (err, user) => {
      if (user && !user.profile_hidden) {
        showProfileOrHidden(user);
      } else if (targetNameB64) {
        const cleanName = Buffer.from(targetNameB64, 'base64url').toString();
        db.get('SELECT * FROM users WHERE (name = ? OR name = ?) AND profile_hidden = 0', [cleanName, '@' + cleanName], (err2, user2) => {
          showProfileOrHidden(user2);
        });
      } else {
        bot.sendMessage(chatId, '❌ <b>Пользователь скрыл профиль</b>', { parse_mode: 'HTML' });
      }
    });
    return;
  }

  // Проверяем существует ли пользователь и одобрена ли его заявка
  db.get('SELECT * FROM users WHERE user_id = ?', [userId], (err, user) => {
    if (err) {
      console.error('Error checking user:', err);
      bot.sendMessage(chatId, '❌ Ошибка проверки пользователя');
      return;
    }

    const applicationFormText = `<tg-emoji emoji-id="5951665890079544884">🏠</tg-emoji> <b>Для вступления в AXE TEAM тебе нужно подать заявку, ответив на пару вопросов.</b>`;

    const sendApplicationForm = () => {
      bot.sendMessage(chatId, applicationFormText, {
        parse_mode: 'HTML',
        reply_markup: keyboards.application_start
      });
    };

    const autoApproveIfMember = async (callback) => {
      try {
        const [chatMember, channelMember] = await Promise.all([
          bot.getChatMember(REQUIRED_CHAT_ID, userId),
          bot.getChatMember(REQUIRED_CHANNEL_ID, userId)
        ]);
        if (isSubscribedChatMember(chatMember) && isSubscribedChatMember(channelMember)) {
          db.run('UPDATE users SET welcome_keyboard_sent = 1 WHERE user_id = ?', [userId], () => {});
          finalizeUserApproval(userId, () => {
            sendInfoPanel(chatId, userId).catch((err) => {
              console.error('/start info failed:', telegramErrorSummary(err));
              bot.sendMessage(chatId, '❌ Ошибка загрузки. Нажми /start ещё раз.').catch(() => {});
            });
          });
          return;
        }
      } catch (e) {}
      callback();
    };

    const runStartFlow = () => {
      const handleApplicationState = (application) => {
        if (application && application.status === 'pending') {
          bot.sendMessage(chatId, '<tg-emoji emoji-id="5776213190387961618">⏳</tg-emoji> <b>Ожидай рассмотрения...</b>', { parse_mode: 'HTML' });
          return;
        }

        if (application && application.status === 'approved' && !hasFullAccess(user)) {
          bot.sendMessage(
            chatId,
            `<tg-emoji emoji-id="5881702736843511327">🍌</tg-emoji> <b>Для полного использования проекта необходимо быть участником основных каналов связи.</b>`,
            { parse_mode: 'HTML', reply_markup: keyboards.subscription_check }
          );
          return;
        }

        if (application && application.status === 'rejected') {
          bot.sendMessage(chatId, '❌ Ваша заявка была отклонена. Вы можете подать новую заявку.', {
            reply_markup: keyboards.application_start
          });
          return;
        }

        if (hasFullAccess(user)) {
          sendInfoPanel(chatId, userId).catch((err) => {
            console.error('/start info failed:', telegramErrorSummary(err));
            bot.sendMessage(chatId, '❌ Ошибка загрузки. Нажми /start ещё раз.').catch(() => {});
          });
          return;
        }

        autoApproveIfMember(sendApplicationForm);
      };

      if (!user) {
        createUser(userId, username, referredBy);
        autoApproveIfMember(sendApplicationForm);
        return;
      }

      // Пришёл по ссылке, но уже существовал в БД — привязываем реферера один раз.
      if (referredBy && user.referred_by == null) {
        db.run('UPDATE users SET referred_by = ? WHERE user_id = ?', [referredBy, userId]);
      }

      db.get(
        'SELECT * FROM applications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [userId],
        (appErr, application) => {
          if (appErr) {
            console.error('Error checking application:', appErr);
            bot.sendMessage(chatId, '❌ Ошибка проверки заявки. Попробуй /start ещё раз.').catch(() => {});
            return;
          }
          handleApplicationState(application);
        }
      );
    };

    runStartFlow();
  });
});

// Публичный текст «Касса/Чат»: Букмекер — как раньше, остальные направления — общий формат.
// Набор премиум-эмодзи зависит от суммы: до 50к один, свыше — другой.
function buildPublicText(profit) {
  const profileLink = `https://t.me/${process.env.BOT_USERNAME || 'AXE_xBOT'}?start=profile_${profit.userId}`;
  const em = utils.profitEmojiSet(profit.amount);
  const e = utils.tgEmoji;

  if (profit.direction === 3) {
    // В публикации выводим профильный тег, а не Telegram username из команды.
    const worker = String(profit.name || profit.username || '').replace(/^[@#]+/, '');
    const fmt = Number(profit.amount).toLocaleString('de-DE');
    return `<b>${e(em.header, '🌸')}УСПЕШНЫЙ ПРОФИТ${e(em.header, '🌸')}

${e(em.service, '🏠')}Сервис: Букмекер
┣${e(em.worker, '👤')}Воркер: <a href="${profileLink}">#${worker}</a>
┗${e(em.amount, '💸')}Сумма: ${fmt}₽</b>`;
  }

  let text = `<b>${e(em.header, '🌸')}УСПЕШНЫЙ ПРОФИТ${e(em.header, '🌸')}${profit.mammothCount ? `\n┗ X${profit.mammothCount}` : ''}

${e(em.service, '🏠')}Сервис: ${profit.directionName}
┣${e(em.worker, '👤')}Воркер: <a href="${profileLink}">${profit.name}</a>`;
  if (profit.direction === 1 && profit.curator) {
    text += `\n┣${e(em.amount, '💸')}Сумма: ${utils.formatAmount(profit.amount)}₽\n┗👨‍🏫Куратор: @${profit.curator}</b>`;
  } else {
    text += `\n┗${e(em.amount, '💸')}Сумма: ${utils.formatAmount(profit.amount)}₽</b>`;
  }
  return text;
}

// Общая сборка «нарисованного» профита: воркер не ищется в БД,
// данные временные — пользователь будет создан при отправке (user_id = 0).
function prepareDrawProfit(chatId, { username: workerUsername, amount, direction, mammothCount }) {
  if (!workerUsername || !amount || ![1, 2, 3].includes(direction)) {
    bot.sendMessage(chatId, '❌ Неверный формат. Используйте: username сумма направление\nПример: richvladwork 10000 1');
    return;
  }

  const workerData = {
    user_id: 0, // Временный ID
    username: workerUsername,
    name: `#${workerUsername}`
  };

  const displayName = workerData.name && (workerData.name.startsWith('@') || workerData.name.startsWith('#'))
    ? '#' + workerData.name.replace(/^[@#]/, '')
    : '#' + (workerData.name || workerData.username);

  const workerPayout = utils.calculateWorkerPayout(amount, direction);
  const shares = utils.calculateProfitShares(amount);
  const directionName = utils.getDirectionName(direction);

  const profitId = `${workerData.user_id}_${Date.now()}`;
  profitData[profitId] = {
    userId: workerData.user_id,
    username: workerData.username,
    name: displayName,
    amount: amount,
    workerPayout: workerPayout,
    direction: direction,
    directionName: directionName,
    shares: shares,
    curator: null,
    percent: null,
    isRegistered: false,
    mammothCount: mammothCount
  };

  const accountingText = utils.buildAccountingText(profitData[profitId]);

  const keyboard = {
    inline_keyboard: [
      [{ text: 'Отправить', callback_data: `send_profit_accounting_${profitId}` }]
    ]
  };

  bot.sendMessage(chatId, accountingText, { parse_mode: 'HTML', reply_markup: keyboard });
}

// Нарисованный профит без префикса: username сумма направление (для всех пользователей)
bot.onText(/^(?!\/)[^\s]+\s+\d+₽?\s+[123]/, (msg) => {
  const parsed = parseProfitText(msg.text);
  if (!parsed) return;
  prepareDrawProfit(msg.chat.id, parsed);
  return true; // Предотвращаем дальнейшую обработку
});

// Нарисованный профит со слышом: /name сумма направление (например /richvladwork 5000 1)
bot.onText(/^\/(?:[^\s\/]+)\s+(\d+)\s+([123])(?:\s+\(?(\d+)\)?)?$/, (msg) => {
  const parsed = parseProfitCommand(msg.text);
  if (!parsed) return;
  prepareDrawProfit(msg.chat.id, parsed);
  return true;
});

// Реальный профит по @: @username сумма направление — только существующий пользователь из БД.
bot.onText(/^@[^\s]+\s+\d+₽?\s+[123]/, (msg) => {
  const chatId = msg.chat.id;
  const parsed = parseProfitMention(msg.text);
  if (!parsed) return;

  const { username: workerName, amount, direction, mammothCount } = parsed;

  if (!workerName || !amount || ![1, 2, 3].includes(direction)) {
    bot.sendMessage(chatId, '❌ Неверный формат. Используйте: @username сумма направление\nПример: @richvladwork 5000 1');
    return;
  }

  // Идентификатор команды — Telegram username; тег — только fallback.
  findWorkerForProfit(workerName, (err, user) => {
    if (err || !user) {
      bot.sendMessage(chatId, `❌ Воркер @${workerName} не найден в базе.\nРеальный профит можно вбить только для зарегистрированного пользователя.\nДля рисованого профита: ${workerName} ${amount} ${direction}`);
      return;
    }

    const displayName = user.name && (user.name.startsWith('@') || user.name.startsWith('#'))
      ? '#' + user.name.replace(/^[@#]/, '')
      : '#' + (user.name || user.username);

    const workerPayout = utils.calculateWorkerPayout(amount, direction);
    const shares = utils.calculateProfitShares(amount);
    const directionName = utils.getDirectionName(direction);

    const profitId = `${user.user_id}_${Date.now()}`;
    profitData[profitId] = {
      userId: user.user_id,
      username: user.username,
      name: displayName,
      amount: amount,
      workerPayout: workerPayout,
      direction: direction,
      directionName: directionName,
      shares: shares,
      curator: user.curator || null,
      percent: user.percent || null,
      isRegistered: true,
      mammothCount: mammothCount
    };

    const accountingText = utils.buildAccountingText(profitData[profitId]);

    const keyboard = {
      inline_keyboard: [
        [{ text: 'Отправить', callback_data: `send_profit_accounting_${profitId}` }]
      ]
    };

    bot.sendMessage(chatId, accountingText, { parse_mode: 'HTML', reply_markup: keyboard });
  });
  return true;
});

// Обработка кнопок клавиатуры
bot.on('message', perf.wrap('message_handler', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  const username = msg.from.username || '';

  // Обновляем username пользователя при каждом сообщении
  updateUsername(userId, username);

  // Ожидаемый текстовый ввод (сценарии change_name, transfer, заявка, карты)
  // обрабатывается до общего разбора — один pending-обработчик на пользователя.
  if (guard.dispatchPendingInput(msg)) {
    return;
  }

  // Ввод адреса кошелька для выплат
  if (walletAddressInput[userId]) {
    const pending = walletAddressInput[userId];
    if (!text || text.startsWith('/')) {
      return;
    }
    delete walletAddressInput[userId];
    const address = text.trim();
    if (!address) {
      bot.sendMessage(chatId, '❌ Адрес не может быть пустым. Отправьте адрес ещё раз.');
      walletAddressInput[userId] = pending;
      return;
    }
    walletPendingConfirm[userId] = { type: pending.type, address };
    const typeLabel = pending.type === 'trc20' ? 'трс20' : 'bep20';
    const confirmKeyboard = {
      inline_keyboard: [
        [
          { text: 'Подтвердить', callback_data: `wallet_confirm_${pending.type}` },
          { text: 'Назад', callback_data: 'wallet_cancel_input' }
        ]
      ]
    };
    bot.sendMessage(chatId, `📊Вы указали ${typeLabel}:\n- ${address}`, {
      parse_mode: 'HTML',
      reply_markup: confirmKeyboard
    }).catch(() => {});
    return;
  }

  // Редактирование рассылки обрабатывается в rass.js
  if (isRassEditing(userId)) {
    return;
  }

  // Проверяем режим рассылки (для админов в личных сообщениях)
  if (broadcastMode[userId] && msg.chat.type === 'private') {
    // Игнорируем команды
    if (text && text.startsWith('/')) {
      return;
    }

    delete broadcastMode[userId];

    // Получаем всех пользователей из базы
    db.all('SELECT DISTINCT user_id FROM users', async (err, users) => {
      if (err) {
        console.error('Error getting users:', err);
        bot.sendMessage(chatId, '❌ Ошибка получения списка пользователей');
        return;
      }

      if (!users || users.length === 0) {
        bot.sendMessage(chatId, '❌ В базе данных нет пользователей');
        return;
      }

      bot.sendMessage(chatId, `📊 Начинаю рассылку для ${users.length} пользователей...`);

      let successCount = 0;
      let failCount = 0;
      const totalUsers = users.length;

      // Функция для отправки сообщения с задержкой.
      // Используем copyMessage: Telegram сам переносит сообщение целиком —
      // все сущности (жирный, курсив, премиум-эмодзи, цитаты), медиа,
      // стикеры, гифки — нативно, без ручной сборки HTML. Никакого
      // кривого парсинга в принципе.
      let firstError = null;
      const sendWithDelay = async (user, index) => {
        return new Promise((resolve) => {
          setTimeout(async () => {
            try {
              await bot.copyMessage(user.user_id, chatId, msg.message_id);
              successCount++;
            } catch (error) {
              console.error(`Failed to send to user ${user.user_id}:`, error.message);
              if (!firstError) firstError = error;
              failCount++;
            }
            resolve();
          }, index * 100); // Задержка 100мс между сообщениями
        });
      };

      // Отправляем сообщения всем пользователям
      const promises = users.map((user, index) => sendWithDelay(user, index));
      await Promise.all(promises);

      // Отправляем статистику админу
      const statsMessage = `✅ <b>Рассылка завершена!</b>

📊 Статистика:
• Всего пользователей: ${totalUsers}
• Успешно доставлено: ${successCount}
• Не доставлено: ${failCount}${firstError ? `

⚠️ <b>Первая ошибка:</b> <code>${escapeHtml(firstError.message)}</code>` : ''}`;

      bot.sendMessage(chatId, statsMessage, { parse_mode: 'HTML' });
    });
    return;
  }

  // Игнорируем команды (они обрабатываются отдельно)
  if (!text || text.startsWith('/')) {
    return;
  }

  // Проверяем одобрена ли заявка пользователя
  db.get('SELECT application_approved FROM users WHERE user_id = ?', [userId], (err, user) => {
    if (err || !hasFullAccess(user)) {
      return;
    }

    if (text === '📖Информация📖') {
      sendInfoPanel(chatId, userId).catch((err) => {
        console.error('Error sending info panel:', err);
        bot.sendMessage(chatId, '❌ Ошибка получения информации');
      });
      return;
    } else if (text === 'Меню') {
      const imagePath = path.join(__dirname, 'images', 'info.jpg');

      if (fs.existsSync(imagePath)) {
        sendMenuPhoto(chatId, imagePath, {
          reply_markup: keyboards.menu
        });
      } else {
        bot.sendMessage(chatId, MENU_PANEL_FALLBACK, {
          reply_markup: keyboards.menu
        });
      }
      return;
    }
  });
}));

// Обработка callback кнопок (единый обработчик)
bot.on('callback_query', perf.wrap('callback_handler', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;
  const username = query.from.username || '';

  // Баг 2 исправлен: предотвращаем дублирование сообщений
  if (!shouldProcessCallback(userId, data)) {
    bot.answerCallbackQuery(query.id).catch(() => {});
    return;
  }

  // Обновляем username пользователя при каждом callback
  updateUsername(userId, username);

  // Уведомление воркеру о профите и прогрессе АХЕ PASS
  const formatXp = (xp) => String(Math.round(xp * 100) / 100).replace('.', ',');

  const sendAxePassNotification = (workerId, profitAmount, oldPass, newPass) => {
    const oldLevel = battlepass.buildState(oldPass.totalEarned, oldPass.xp).level;
    const state = battlepass.buildState(newPass.totalEarned, newPass.xp);
    const xpGained = newPass.xp - oldPass.xp;

    let text = `<b><tg-emoji emoji-id="5217822164362739968">👑</tg-emoji>Профит на сумму: ${utils.formatAmount(profitAmount)}₽
Получено: ${formatXp(xpGained)}xp
У вас ${state.level} уровень АХЕ PASS</b>`;

    if (state.level > oldLevel) {
      text += `\n\n<b>Получите новый подарок! 🎁</b>`;
    }

    bot.sendMessage(workerId, text, { parse_mode: 'HTML' }).catch(() => {});
  };

  // Обработка profit system
  if (data.startsWith('send_profit_accounting_') || (data.startsWith('send_profit_') && !data.startsWith('send_profit_accounting_'))) {
      const profitId = data.startsWith('send_profit_accounting_') ? data.replace('send_profit_accounting_', '') : data.replace('send_profit_', '');
      const profit = profitData[profitId];

      if (!profit) {
        bot.answerCallbackQuery(query.id, { text: '❌ Данные профита не найдены' });
        return;
      }

      bot.answerCallbackQuery(query.id);

      // Idempotency: профит сохраняется в БД ровно один раз, даже если
      // кнопку нажали повторно (двойной клик, ретрай Telegram).
      if (profit._saved) {
        return;
      }
      profit._saved = true;

      const saveProfitAndUpdateUser = (targetUserId) => {
        db.run('INSERT INTO profits (user_id, amount, amount_to_pay, direction) VALUES (?, ?, ?, ?)',
          [targetUserId, profit.amount, profit.workerPayout, profit.direction],
          function(err) {
            if (err) {
              console.error('Error saving profit:', err);
              return;
            }

            const dbProfitId = this.lastID;

            for (const [role, amount] of Object.entries(profit.shares)) {
              db.run('INSERT OR IGNORE INTO profit_shares (profit_id, role, percentage, amount) VALUES (?, ?, ?, ?)',
                [dbProfitId, role, utils.PROFIT_SHARES[role], amount],
                (err) => {
                  if (err) console.error('Error saving share:', err);
                }
              );
            }

            // Уведомляем куратора о профите ученика
            notifyCuratorOfProfit(bot, db, profit);

db.get('SELECT battlepass_earned, battlepass_xp FROM users WHERE user_id = ?', [targetUserId], (err, preUser) => {
                const oldPassTotal = (!err && preUser) ? (preUser.battlepass_earned || 0) : 0;
                const oldPassXp = (!err && preUser) ? (preUser.battlepass_xp || 0) : 0;
                const newPassTotal = oldPassTotal + profit.amount;
                const xpGain = battlepass.xpFromAmount(profit.amount, profit.direction);
                const newPassXp = oldPassXp + xpGain;

                db.run(`UPDATE users SET
                balance = balance + ?,
                total_earned = total_earned + ?,
                battlepass_earned = COALESCE(battlepass_earned, 0) + ?,
                battlepass_xp = COALESCE(battlepass_xp, 0) + ?,
                profit_count = profit_count + 1
                WHERE user_id = ?`,
                [profit.workerPayout, profit.amount, profit.amount, xpGain, targetUserId],
                (err) => {
                  if (err) {
                    console.error('Error updating user:', err);
                  } else {
                    console.log(`✅ Updated balance for user ${targetUserId}: +${profit.workerPayout}₽`);
                    utils.updateWorkerStatus(targetUserId, (statusErr, newStatus) => {
                      if (!statusErr && newStatus) {
                        statusChats.sendPendingUnlocks(bot, targetUserId, newStatus);
                      }
                      db.get('SELECT status, total_earned FROM users WHERE user_id = ?', [targetUserId], (err, updatedUser) => {
                        if (!err && updatedUser) {
                          const currentTotal = updatedUser.total_earned || 0;
                          const currentStatus = utils.getStatusByTotal(currentTotal);
                          const nextThreshold = utils.STATUS_THRESHOLDS.find(t => t.threshold > currentTotal);
                          const nextLevelAmount = nextThreshold ? nextThreshold.threshold : null;
                          let nextLevelText = '';
                          if (nextLevelAmount) {
                            const remaining = nextLevelAmount - currentTotal;
                            nextLevelText = `До нового уровня ${remaining.toLocaleString()}₽`;
                          } else {
                            nextLevelText = 'Максимальный уровень достигнут';
                          }
                          const profitMessage = `<tg-emoji emoji-id="5994502837327892086">🎉</tg-emoji><b>Успешный профит </b>

┏ <tg-emoji emoji-id="5257969839313526622">🏠</tg-emoji><b>Сервис: ${profit.directionName}
</b>┣ <tg-emoji emoji-id="5769403330761593044">💸</tg-emoji><b>На сумму: ${profit.amount.toLocaleString()}₽
┣ Твой статус: ${currentStatus}
┗ <tg-emoji emoji-id="5967688845397855939">🍾</tg-emoji>${nextLevelText} </b>

<tg-emoji emoji-id="5276240711795107620">⚠️</tg-emoji><i>Подать заявку на выплату можно в профиле.</i>`;
                          bot.sendMessage(targetUserId, profitMessage, { parse_mode: 'HTML' }).catch(() => {});
                          sendAxePassNotification(targetUserId, profit.amount, { totalEarned: oldPassTotal, xp: oldPassXp }, { totalEarned: newPassTotal, xp: newPassXp });
                          sendPrizeNotifications(bot, db, adminIds, targetUserId, profit.username, profit.name, { totalEarned: oldPassTotal, xp: oldPassXp }, { totalEarned: newPassTotal, xp: newPassXp });
                        }
                      });
                    });
                  }
                });
              });

            // Обновляем статистику проекта и закреп после сохранения профита в БД
            utils.updateProjectStats(profit.amount, (err) => {
              if (err) console.error('Error updating project stats:', err);
            });

            updatePinnedMessage(bot, GENERAL_CHAT_ID).catch((pinErr) =>
              console.error('Error updating pinned after profit:', pinErr)
            );
          }
        );
      };

      const showCombinedKeyboard = () => {
        let combinedText = `<b>📊 БУХГАЛТЕРИЯ:</b>\n${utils.buildAccountingText(profit)}

━━━━━━━━━━━━━━━━━━━━

<b>🌸 КАССА/ЧАТ:</b>\n${buildPublicText(profit)}`;

        const combinedKeyboard = {
          inline_keyboard: [
            [{ text: 'Отправить в бухгалтерию', callback_data: `send_accounting_${profitId}` }],
            [{ text: 'Отправить в кассу/чат', callback_data: `send_public_${profitId}` }],
            [{ text: 'Отправить везде', callback_data: `send_all_${profitId}` }]
          ]
        };

        bot.sendMessage(chatId, combinedText, { parse_mode: 'HTML', reply_markup: combinedKeyboard })
          .then(() => {
            bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
          })
          .catch((err) => {
            console.error('Error sending profit action menu:', err);
            bot.answerCallbackQuery(query.id, { text: '❌ Не удалось показать опции публикации профита, попробуйте снова.' });
            bot.sendMessage(chatId, '❌ Не удалось показать опции публикации профита, попробуйте снова.').catch(() => {});
          });
      };

      if (profit.isRegistered && profit.userId !== 0) {
        saveProfitAndUpdateUser(profit.userId);
        showCombinedKeyboard();
      } else {
        // Рисованый профит: переиспользуем только ранее созданный фейковый
        // аккаунт (id выше FAKE_USER_ID_MIN). Реальные пользователи не
        // затрагиваются — их пасс и баланс считаются только через @-команду.
        db.get('SELECT user_id FROM users WHERE username = ? AND user_id > ?', [profit.username, FAKE_USER_ID_MIN], (err, existingUser) => {
          if (existingUser) {
            profit.userId = existingUser.user_id;
            saveProfitAndUpdateUser(existingUser.user_id);
            showCombinedKeyboard();
          } else {
            utils.generateWorkerNumber((err, workerNumber) => {
              if (err) {
                console.error('Error generating worker number:', err);
                return;
              }
              const newUserId = Date.now() + Math.floor(Math.random() * 10000);
              profit.userId = newUserId;
              db.run(
                'INSERT INTO users (user_id, username, name, worker_number, application_approved, balance, total_earned, profit_count) VALUES (?, ?, ?, ?, 1, 0, 0, 0)',
                [newUserId, profit.username, profit.name, workerNumber],
                function(err) {
                  if (err) {
                    console.error('Error creating user:', err);
                    return;
                  }
                  saveProfitAndUpdateUser(newUserId);
                }
              );
              showCombinedKeyboard();
            });
          }
        });
      }
      return;
    }

    if (data.startsWith('send_all_')) {
      const profitId = data.replace('send_all_', '');
      const profit = profitData[profitId];

      if (!profit) {
        bot.answerCallbackQuery(query.id, { text: '❌ Данные профита не найдены' });
        return;
      }

      bot.answerCallbackQuery(query.id);

      if (profit._sent) return;
      profit._sent = true;

      // Отправляем в бухгалтерию
      const accountingText = utils.buildAccountingText(profit);

      // Отправляем в общую кассу и чат
      const publicText = buildPublicText(profit);

      let hasError = false;
      let cashOk = false;

      try {
        await bot.sendMessage(ACCOUNTING_CHAT_ID, accountingText, { parse_mode: 'HTML' });
      } catch (err) {
        console.error('Error sending to accounting:', err);
        hasError = true;
      }

try {
        await bot.sendMessage(CASH_CHANNEL_ID, publicText, { parse_mode: 'HTML', disable_web_page_preview: true });
        cashOk = true;
      } catch (err) {
        console.error('Error sending to cash channel:', err);
        hasError = true;
      }

      try {
        await bot.sendMessage(GENERAL_CHAT_ID, publicText, { parse_mode: 'HTML', disable_web_page_preview: true });
      } catch (err) {
        console.error('Error sending to general chat:', err);
        hasError = true;
        if (cashOk) {
          bot.sendMessage(chatId, '⚠️ Профит отправлен в кассу, но НЕ отправлен в общий чат. Проверь права бота в чате.').catch(() => {});
        }
      }

      updatePinnedMessage(bot, GENERAL_CHAT_ID).catch((err) =>
        console.error('Error updating pinned after send_public:', err)
      );

      delete profitData[profitId];

      bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
      bot.sendMessage(chatId, hasError ? '⚠️ Профит отправлен с ошибками (см. лог).' : '✅ Профит отправлен везде!');
      return;
    }

    if (data.startsWith('send_accounting_')) {
      const profitId = data.replace('send_accounting_', '');
      const profit = profitData[profitId];

      if (!profit) {
        bot.answerCallbackQuery(query.id, { text: '❌ Данные профита не найдены' });
        return;
      }

      bot.answerCallbackQuery(query.id);

      const accountingText = utils.buildAccountingText(profit);

      if (profit._sent) return;
      profit._sent = true;

      // Отправляем в бухгалтерию
      bot.sendMessage(ACCOUNTING_CHAT_ID, accountingText, { parse_mode: 'HTML' }).catch((err) => {
        console.error('Error sending to accounting:', err);
      });

      bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
      bot.sendMessage(chatId, '✅ Отправлено в бухгалтерию!');
      return;
    }

    if (data.startsWith('send_public_')) {
      const profitId = data.replace('send_public_', '');
      const profit = profitData[profitId];

      if (!profit) {
        bot.answerCallbackQuery(query.id, { text: '❌ Данные профита не найдены' });
        return;
      }

      bot.answerCallbackQuery(query.id);

      if (profit._sent) return;
      profit._sent = true;

      const publicText = buildPublicText(profit);

      let hasError = false;
      let cashOk = false;

try {
        await bot.sendMessage(CASH_CHANNEL_ID, publicText, { parse_mode: 'HTML', disable_web_page_preview: true });
        cashOk = true;
      } catch (err) {
        console.error('Error sending to cash channel:', err);
        hasError = true;
      }

      try {
        await bot.sendMessage(GENERAL_CHAT_ID, publicText, { parse_mode: 'HTML', disable_web_page_preview: true });
      } catch (err) {
        console.error('Error sending to general chat:', err);
        hasError = true;
        if (cashOk) {
          bot.sendMessage(chatId, '⚠️ Профит отправлен в кассу, но НЕ отправлен в общий чат. Проверь права бота в чате.').catch(() => {});
        }
      }

      updatePinnedMessage(bot, GENERAL_CHAT_ID).catch((err) =>
        console.error('Error updating pinned after send_profit:', err)
      );

      delete profitData[profitId];

      bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
      bot.sendMessage(chatId, hasError ? '⚠️ Профит отправлен с ошибками (см. лог).' : '✅ Профит опубликован!');
      return;
    }

  // Панель куратора /cur: карточка ученика
  if (data.startsWith('cur_student_')) {
    const studentUserId = parseInt(data.replace('cur_student_', ''), 10);
    const mentor = getMentorByUsername(query.from.username);
    if (!mentor) {
      bot.answerCallbackQuery(query.id, { text: '❌ Доступ запрещен', show_alert: true });
      return;
    }

    db.get('SELECT * FROM users WHERE user_id = ?', [studentUserId], (err, student) => {
      if (err || !student || String(student.curator || '').toLowerCase() !== mentor.username.toLowerCase()) {
        bot.answerCallbackQuery(query.id, { text: '❌ Ученик не найден', show_alert: true });
        return;
      }
      bot.answerCallbackQuery(query.id);

      db.get('SELECT COALESCE(SUM(amount), 0) AS total, COUNT(id) AS cnt FROM profits WHERE user_id = ?',
        [studentUserId], (err2, st) => {
          const total = err2 ? 0 : Number(st.total || 0);
          const cnt = err2 ? 0 : Number(st.cnt || 0);
          const tag = String(student.username || student.name || studentUserId).replace(/^[@#]/, '');
          const text = `<b>Ученик: @${tag}
Профитов: ${cnt}
Сумма профитов: ${fmtCurAmount(total)}₽
Куратор: @${student.curator}</b>`;
          const keyboard = {
            inline_keyboard: [
              [{ text: 'Отвязать ученика', callback_data: `cur_detach_${studentUserId}` }],
              [{ text: '← Назад к списку', callback_data: 'cur_refresh_' }]
            ]
          };
          bot.editMessageText(text, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'HTML',
            reply_markup: keyboard
          }).catch(() => {});
        });
    });
    return;
  }

  // Панель куратора /cur: отвязка ученика (список перерисовывается — ученик исчезает)
  if (data.startsWith('cur_detach_')) {
    const studentUserId = parseInt(data.replace('cur_detach_', ''), 10);
    const mentor = getMentorByUsername(query.from.username);
    if (!mentor) {
      bot.answerCallbackQuery(query.id, { text: '❌ Доступ запрещен', show_alert: true });
      return;
    }

    db.get('SELECT curator FROM users WHERE user_id = ?', [studentUserId], (err, row) => {
      if (err || !row || String(row.curator || '').toLowerCase() !== mentor.username.toLowerCase()) {
        bot.answerCallbackQuery(query.id, { text: '❌ Ученик не привязан к тебе', show_alert: true });
        return;
      }

      db.run('UPDATE users SET curator = NULL, percent = NULL WHERE user_id = ?', [studentUserId], (updErr) => {
        if (updErr) console.error('Error detaching student:', updErr);
        bot.answerCallbackQuery(query.id, { text: '✅ Ученик отвязан', show_alert: true });

        // Перерисовываем список живьём из БД — отвязанный ученик больше не отображается
        renderCurMessage(chatId, mentor, query.message.message_id).catch((e) => {
          console.error('cur_refresh after detach failed:', e);
        });
      });
    });
    return;
  }

  // Панель куратора /cur: обновление списка
  if (data === 'cur_refresh_') {
    const mentor = getMentorByUsername(query.from.username);
    if (!mentor) {
      bot.answerCallbackQuery(query.id, { text: '❌ Доступ запрещен', show_alert: true });
      return;
    }
    bot.answerCallbackQuery(query.id);
    renderCurMessage(chatId, mentor, query.message.message_id).catch((e) => {
      console.error('cur_refresh failed:', e);
    });
    return;
  }

  // Обработка начала заявки
  if (data === 'start_application') {
    bot.answerCallbackQuery(query.id);
    bot.deleteMessage(chatId, query.message.message_id).catch(() => {});

    applicationData[userId] = { step: 1 };

    const questions = [
      '<b>Вопрос №1:</b>\n<i>Занимался ли ты подобной деятельностью?</i>',
      '<b>Вопрос №2:</b>\n<i>Если твой ответ на прошлый вопрос (да), то расскажи каков свой опыт, чем занимался?</i>'
    ];
    let step = 1;

    const askQuestion = () => {
      bot.sendMessage(chatId, questions[step - 1], { parse_mode: 'HTML' }).then((sent) => {
        const questionMessageId = sent.message_id;

        guard.setPendingInput(userId, chatId, (msg) => {
          if (msg.chat.id !== chatId) return;
          if (msg.from.id !== userId) return; // Проверяем что это тот же пользователь
          if (!msg.text || msg.text.startsWith('/')) return;

          guard.clearPendingInput(userId);

          if (step === 1) {
            applicationData[userId].question1 = msg.text;
            applicationData[userId].step = 2;
          } else {
            applicationData[userId].question2 = msg.text;
          }

          // Удаляем сообщение с вопросом и ответ пользователя
          if (msg.message_id) bot.deleteMessage(chatId, msg.message_id).catch(() => {});
          if (questionMessageId) bot.deleteMessage(chatId, questionMessageId).catch(() => {});

          if (step === 1) {
            step = 2;
            askQuestion();
            return;
          }

          // Сохраняем заявку в БД
          resetOnboardingProgress(userId, () => {
          db.run('INSERT INTO applications (user_id, username, question1, question2, status) VALUES (?, ?, ?, ?, ?)',
            [userId, msg.from.username || '', applicationData[userId].question1, applicationData[userId].question2, 'pending'],
            function(err) {
              if (err) {
                console.error('Error saving application:', err);
                bot.sendMessage(chatId, '❌ Ошибка отправки заявки');
                return;
              }

              const applicationId = this.lastID;

              bot.sendMessage(chatId, '<b><tg-emoji emoji-id="5843843420468024653">📨</tg-emoji> Твоя заявка отправлена на рассмотрение!</b>', { parse_mode: 'HTML' });

              // Отправляем заявку админам
              const adminText = `Заявка от @${msg.from.username || 'unknown'} (ID: ${userId})

1. ${applicationData[userId].question1}
2. ${applicationData[userId].question2}`;

              adminIds.forEach(adminId => {
                bot.sendMessage(adminId, adminText, {
                  reply_markup: keyboards.admin_application(applicationId)
                }).catch(err => {
                  console.error('Error sending to admin:', err);
                });
              });

              delete applicationData[userId];
            }
          );
          });
        });
      }).catch(() => {});
    };

    askQuestion();

    return;
  }

  // Обработка одобрения заявки админом
  if (data.startsWith('approve_application_')) {
    if (!adminIds.includes(userId)) {
      bot.answerCallbackQuery(query.id, { text: '❌ У вас нет прав' });
      return;
    }

    bot.answerCallbackQuery(query.id);
    const applicationId = parseInt(data.replace('approve_application_', ''));

    db.get('SELECT * FROM applications WHERE id = ?', [applicationId], (err, application) => {
      if (err || !application) {
        bot.sendMessage(chatId, '❌ Заявка не найдена');
        return;
      }

      if (application.status !== 'pending') {
        bot.sendMessage(chatId, '❌ Заявка уже обработана');
        return;
      }

      // Обновляем статус заявки
      db.run('UPDATE applications SET status = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['approved', applicationId],
        (err) => {
          if (err) {
            console.error('Error updating application:', err);
            bot.sendMessage(chatId, '❌ Ошибка обновления заявки');
            return;
          }

          // Создаем или обновляем пользователя
          db.get('SELECT * FROM users WHERE user_id = ?', [application.user_id], (err, user) => {
            if (err) {
              console.error('Error checking user:', err);
              return;
            }

            if (user) {
              // До проверки подписки — ещё не полный доступ (клавиатура после check_subscription)
              db.run(
                'UPDATE users SET username = ?, application_approved = 0, welcome_keyboard_sent = 0 WHERE user_id = ?',
                [application.username, application.user_id],
                (err) => {
                  if (err) console.error('Error updating user:', err);
                }
              );
            } else {
              db.run(
                'INSERT INTO users (user_id, username, name, application_approved, welcome_keyboard_sent) VALUES (?, ?, ?, 0, 0)',
                [application.user_id, application.username, application.name || application.username],
                (err) => {
                  if (err) console.error('Error creating user:', err);
                }
              );
            }
          });

          bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
          bot.sendMessage(chatId, `✅ Заявка от @${application.username} одобрена`).catch(err => {
            console.error('Error sending approval message:', err);
          });

          // Отправляем пользователю правила
          const rulesText = `<b>Поздравляем! <tg-emoji emoji-id="5278611606756942667">🥂</tg-emoji></b>

<tg-emoji emoji-id="5260268501515377807">💌</tg-emoji> <i>Твоя заявка принята, осталось ознакомиться с правилами проекта</i> <b><i>AXE TEAM.</i></b>

<b>1. Оскорбления участников проекта ЗАПРЕЩЕНЫ, от администраторов до обычных пользователей.</b>

<b>2. ЗАПРЕЩЕНА реклама в любом её проявлении нативная/активная.</b>

<b>3. ЗАПРЕЩЕНА дискредитация пользователей проекта AXE TEAM.</b>

<b>4. Разжигание полит-новостей ЗАПРЕЩЕНО. Любые политические темы должны обсуждаться с нейтральной точкой зрения.</b>

<b>5. ЗАПРЕЩЕНО попрошайничество в любом виде.</b>`;

          bot.sendMessage(application.user_id, rulesText, {
            parse_mode: 'HTML',
            reply_markup: keyboards.rules_confirm
          }).catch(err => {
            console.error('Error sending rules to user:', err);
          });
        }
      );
    });
    return;
  }

  // Обработка отклонения заявки админом
  if (data.startsWith('reject_application_')) {
    if (!adminIds.includes(userId)) {
      bot.answerCallbackQuery(query.id, { text: '❌ У вас нет прав' });
      return;
    }

    bot.answerCallbackQuery(query.id);
    const applicationId = parseInt(data.replace('reject_application_', ''));

    db.get('SELECT * FROM applications WHERE id = ?', [applicationId], (err, application) => {
      if (err || !application) {
        bot.sendMessage(chatId, '❌ Заявка не найдена');
        return;
      }

      if (application.status !== 'pending') {
        bot.sendMessage(chatId, '❌ Заявка уже обработана');
        return;
      }

      // Обновляем статус заявки
      db.run('UPDATE applications SET status = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['rejected', applicationId],
        (err) => {
          if (err) {
            console.error('Error updating application:', err);
            bot.sendMessage(chatId, '❌ Ошибка обновления заявки');
            return;
          }

          resetOnboardingProgress(application.user_id);

          bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
          bot.sendMessage(chatId, `❌ Заявка от @${application.username} отклонена`).catch(err => {
            console.error('Error sending rejection message:', err);
          });

          // Уведомляем пользователя
          bot.sendMessage(application.user_id, '❌ К сожалению, ваша заявка была отклонена.').catch(err => {
            console.error('Error notifying user:', err);
          });
        }
      );
    });
    return;
  }

  // Обработка подтверждения ознакомления с правилами
  if (data === 'rules_confirmed') {
    bot.answerCallbackQuery(query.id);
    bot.deleteMessage(chatId, query.message.message_id).catch(() => {});

    const subscriptionText = `<tg-emoji emoji-id="5881702736843511327">🍌</tg-emoji> <b>Для полного использования проекта необходимо быть участником основных каналов связи.</b>`;

    bot.sendMessage(chatId, subscriptionText, {
      parse_mode: 'HTML',
      reply_markup: keyboards.subscription_check
    });
    return;
  }

  // Обработка проверки подписки
  if (data === 'check_subscription') {
    const subscriptionMessageId = query.message.message_id;

    console.log(`Checking subscription for user ${userId}`);
    console.log(`Chat ID: ${REQUIRED_CHAT_ID}`);
    console.log(`Channel ID: ${REQUIRED_CHANNEL_ID}`);

    // Проверяем подписку на чат
    bot.getChatMember(REQUIRED_CHAT_ID, userId)
      .then(chatMember => {
        console.log(`Chat member status: ${chatMember.status}`);
        const chatStatus = isSubscribedChatMember(chatMember);

        // Проверяем подписку на канал
        bot.getChatMember(REQUIRED_CHANNEL_ID, userId)
          .then(channelMember => {
            console.log(`Channel member status: ${channelMember.status}`);
            const channelStatus = isSubscribedChatMember(channelMember);

            if (chatStatus && channelStatus) {
              bot.answerCallbackQuery(query.id, { text: '✅ Подписка подтверждена!' }).catch(() => {});

              finalizeUserApproval(userId, (finalizeErr) => {
                if (finalizeErr) {
                  console.error('finalizeUserApproval error:', finalizeErr);
                  bot.sendMessage(chatId, '❌ Ошибка сохранения. Попробуйте «Проверить» ещё раз.').catch(() => {});
                  return;
                }
                completeOnboardingAfterSubscription(chatId, userId, subscriptionMessageId);
              });
            } else {
              bot.answerCallbackQuery(query.id, { text: '❌ Нужна подписка на чат и канал', show_alert: true }).catch(() => {});

              let errorMsg = '<b>❌ Вы не подписаны на:\n';
              if (!chatStatus) errorMsg += '• AXE | CHAT💬\n';
              if (!channelStatus) errorMsg += '• AXE | NEWS🦋\n';
              errorMsg += '\nПожалуйста, подпишитесь и попробуйте снова.</b>';

              bot.sendMessage(chatId, errorMsg, { parse_mode: 'HTML' });
            }
          })
          .catch(err => {
            console.error('Error checking channel subscription:', err);
            bot.answerCallbackQuery(query.id, { text: '❌ Ошибка проверки канала', show_alert: true }).catch(() => {});
            bot.sendMessage(chatId, `❌ Ошибка проверки подписки на канал.\n\nДетали: ${err.message}\n\nУбедитесь, что:\n1. Бот добавлен в канал как администратор\n2. ID канала правильный: ${REQUIRED_CHANNEL_ID}`);
          });
      })
      .catch(err => {
        console.error('Error checking chat subscription:', err);
        bot.answerCallbackQuery(query.id, { text: '❌ Ошибка проверки чата', show_alert: true }).catch(() => {});
        bot.sendMessage(chatId, `❌ Ошибка проверки подписки на чат.\n\nДетали: ${err.message}\n\nУбедитесь, что:\n1. Бот добавлен в чат как администратор\n2. ID чата правильный: ${REQUIRED_CHAT_ID}`);
      });
    return;
  }

  // Подтверждение адреса кошелька
  if (data.startsWith('wallet_confirm_')) {
    bot.answerCallbackQuery(query.id);
    const pending = walletPendingConfirm[userId];
    if (!pending) {
      bot.sendMessage(chatId, '❌ Сессия истекла. Попробуйте ещё раз.');
      return;
    }
    delete walletPendingConfirm[userId];
    delete walletAddressInput[userId];

    const column = pending.type === 'trc20' ? 'trc20_address' : 'bep20_address';
    db.run(`UPDATE users SET ${column} = ?, payout_method = ? WHERE user_id = ?`,
      [pending.address, pending.type, userId], (err) => {
        if (err) {
          console.error('Error saving wallet address:', err);
          bot.sendMessage(chatId, '❌ Ошибка сохранения адреса');
          return;
        }
        bot.sendMessage(chatId, '✅ Кошелек привязан!');
        getUser(userId, (err, user) => {
          if (err || !user) return;
          const walletText = buildWalletText(user);
          bot.sendMessage(chatId, walletText, {
            parse_mode: 'HTML',
            reply_markup: keyboards.payout_wallet(user.payout_method || 'cryptobot')
          }).catch(() => {});
        });
      });
    return;
  }

  // Обработка подтверждения вывода
  if (data === 'confirm_withdraw') {
    bot.answerCallbackQuery(query.id);

    getUser(userId, (err, user) => {
      if (err || !user) {
        bot.sendMessage(chatId, '❌ Ошибка');
        return;
      }

      const amount = Math.round(Number(user.balance) || 0);
      if (amount <= 0) {
        bot.sendMessage(chatId, '❌ Недостаточно средств для вывода');
        return;
      }

      const payoutMethod = user.payout_method || 'cryptobot';
      const payoutAddress = payoutMethod === 'trc20' ? (user.trc20_address || '') : (payoutMethod === 'bep20' ? (user.bep20_address || '') : '');

      // Создаем заявку на вывод
      db.run('INSERT INTO withdrawals (user_id, amount, status, payout_method, wallet_address) VALUES (?, ?, ?, ?, ?)',
        [userId, amount, 'pending', payoutMethod, payoutAddress],
        function(err) {
          if (err) {
            console.error('Error creating withdrawal:', err);
            bot.sendMessage(chatId, '❌ Ошибка создания заявки');
            return;
          }

          const withdrawalId = this.lastID;

          // Обнуляем баланс воркера
          db.run('UPDATE users SET balance = 0 WHERE user_id = ?', [userId], (err) => {
            if (err) {
              console.error('Error updating balance:', err);
            }
          });

          // Отправляем заявку админу
          const walletLine = payoutMethod === 'cryptobot'
            ? '⚪️Кошелек для выплаты: CryptoBot'
            : `${payoutMethod === 'trc20' ? '🔴' : '🟢'}Кошелек для выплаты ${payoutMethod === 'trc20' ? 'трс20' : 'BEP20'}: <code>${payoutAddress}</code>`;

          const adminText = `✅Новая заявка на выплату!
🌶Воркер: #${user.username || 'unknown'}
<tg-emoji emoji-id="5936017305585586269">🪪</tg-emoji>Никнейм: ${user.name}
<tg-emoji emoji-id="5260268501515377807">💌</tg-emoji>Сумма выплаты: ${amount.toLocaleString()}₽
${walletLine}`;

          const adminKeyboard = {
            inline_keyboard: [
              [{ text: 'Выплатить✅', callback_data: `process_withdrawal_${withdrawalId}` }]
            ]
          };

          Promise.all(PAYOUT_ADMIN_IDS.map(id =>
            bot.sendMessage(id, adminText, { parse_mode: 'HTML', reply_markup: adminKeyboard }).catch(() => {})
          )).then(() => {
            const successText = '<b>✅ Заявка на выплату создана! Ожидайте обработки.</b>';
            bot.editMessageText(successText, {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'HTML'
            }).catch(() => {
              bot.sendMessage(chatId, successText, { parse_mode: 'HTML' });
            });
          }).catch((err) => {
            console.error('Error sending to admin:', err);
            bot.sendMessage(chatId, '❌ Ошибка отправки заявки администратору');
          });
        }
      );
    });
    return;
  }

  // Обработка выплаты админом
  if (data.startsWith('process_withdrawal_')) {
    bot.answerCallbackQuery(query.id);
    const withdrawalId = parseInt(data.replace('process_withdrawal_', ''));

    db.get('SELECT w.*, u.username, u.name FROM withdrawals w JOIN users u ON w.user_id = u.user_id WHERE w.id = ?',
      [withdrawalId],
      (err, withdrawal) => {
        if (err || !withdrawal) {
          bot.sendMessage(chatId, '❌ Заявка не найдена');
          return;
        }

        if (withdrawal.status !== 'pending') {
          bot.sendMessage(chatId, '❌ Заявка уже обработана');
          return;
        }

        bot.deleteMessage(chatId, query.message.message_id).catch(() => {});

        bot.sendMessage(chatId, `💸 <b>Выплата: ${withdrawal.amount.toLocaleString()}₽ воркеру @${withdrawal.username || 'unknown'}</b>

📎 <i>Прикрепите чек</i>

После отправки чек будет доставлен воркеру, а выплата завершена.`, { parse_mode: 'HTML' });

        // Ждём чек (фото / файл / текстовая ссылка) и только потом завершаем выплату
        guard.setPendingInput(userId, chatId, (msg) => {
          if (msg.chat.id !== chatId) return;
          if (msg.from.id !== userId) return;

          let fileId = null;
          let fileType = null;
          let checkText = null;

          if (msg.photo && msg.photo.length > 0) {
            fileId = msg.photo[msg.photo.length - 1].file_id;
            fileType = 'photo';
          } else if (msg.document) {
            fileId = msg.document.file_id;
            fileType = 'document';
          } else if (msg.text && !msg.text.startsWith('/')) {
            checkText = msg.text.trim();
            if (!checkText) {
              return;
            }
          } else {
            bot.sendMessage(chatId, '❌ Пришлите фото, файл или ссылку на чек.');
            return;
          }

          guard.clearPendingInput(userId);
          bot.deleteMessage(chatId, msg.message_id).catch(() => {});

          // Повторная проверка — заявку мог обработать другой админ
          db.get('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId], (err, latest) => {
            if (err || !latest) {
              bot.sendMessage(chatId, '❌ Заявка не найдена');
              return;
            }
            if (latest.status !== 'pending') {
              bot.sendMessage(chatId, '❌ Заявка уже обработана');
              return;
            }

            db.run('UPDATE withdrawals SET status = ?, completed_at = CURRENT_TIMESTAMP, check_file_id = ?, check_file_type = ?, check_message = ? WHERE id = ?',
              ['completed', fileId, fileType, checkText, withdrawalId],
              (err) => {
                if (err) {
                  console.error('Error completing withdrawal:', err);
                  bot.sendMessage(chatId, '❌ Ошибка обновления статуса');
                  return;
                }

                const payoutLabel = getPayoutLabel(latest.payout_method || 'cryptobot');
                const workerText = `✅Успешный вывод
<tg-emoji emoji-id="5258204546391351475">💼</tg-emoji>Сумма к выплате: ${latest.amount.toLocaleString()}₽
⚙️Способ выплаты: ${payoutLabel}${checkText ? `\n📄 Чек: ${checkText}` : ''}`;

                const notifyWorker = () => {
                  if (fileId && fileType === 'photo') {
                    return bot.sendPhoto(latest.user_id, fileId, { caption: workerText, parse_mode: 'HTML' });
                  }
                  if (fileId && fileType === 'document') {
                    return bot.sendDocument(latest.user_id, fileId, { caption: workerText, parse_mode: 'HTML' });
                  }
                  return bot.sendMessage(latest.user_id, workerText, { parse_mode: 'HTML' });
                };

                notifyWorker()
                  .then(() => {
                    bot.sendMessage(chatId, `✅ Выплата: ${latest.amount.toLocaleString()}₽ прошла, чек отправлен воркеру @${withdrawal.username || 'unknown'}!`, { parse_mode: 'HTML' });
                  })
                  .catch((sendErr) => {
                    console.error('Error sending check to worker:', sendErr);
                    bot.sendMessage(chatId, `⚠️ Выплата завершена, но чек не удалось отправить воркеру @${withdrawal.username || 'unknown'}`);
                  });
              }
            );
          });
        });
      }
    );
    return;
  }

  // Подтверждение выплаты
  if (data.startsWith('confirm_payout_')) {
    bot.answerCallbackQuery(query.id);
    const withdrawalId = parseInt(data.replace('confirm_payout_', ''));

    db.get('SELECT w.*, u.username, u.name FROM withdrawals w JOIN users u ON w.user_id = u.user_id WHERE w.id = ?',
      [withdrawalId],
      (err, withdrawal) => {
        if (err || !withdrawal) {
          bot.sendMessage(chatId, '❌ Заявка не найдена');
          return;
        }

        // Обновляем статус
        db.run('UPDATE withdrawals SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?',
          ['completed', withdrawalId],
          (err) => {
            if (err) {
              bot.sendMessage(chatId, '❌ Ошибка обновления статуса');
              return;
            }

            bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
            bot.sendMessage(chatId, `✅Выплата: ${withdrawal.amount.toLocaleString()}₽ отправлена воркеру @${withdrawal.username || 'unknown'}`);

            // Уведомляем воркера
            const workerText = `✅Успешный вывод
<tg-emoji emoji-id="5258204546391351475">💼</tg-emoji>Сумма к выплате: ${withdrawal.amount.toLocaleString()}₽
⚙Способ выплаты: перевод на карту
${withdrawal.check_message || ''}`;

            if (withdrawal.check_file_id && withdrawal.check_file_type === 'photo') {
              bot.sendPhoto(withdrawal.user_id, withdrawal.check_file_id, { caption: workerText, parse_mode: 'HTML' }).catch((err) => {
                console.error('Error sending check photo to worker:', err);
                bot.sendMessage(withdrawal.user_id, workerText, { parse_mode: 'HTML' }).catch(() => {});
              });
            } else if (withdrawal.check_file_id && withdrawal.check_file_type === 'document') {
              bot.sendDocument(withdrawal.user_id, withdrawal.check_file_id, { caption: workerText, parse_mode: 'HTML' }).catch((err) => {
                console.error('Error sending check document to worker:', err);
                bot.sendMessage(withdrawal.user_id, workerText, { parse_mode: 'HTML' }).catch(() => {});
              });
            } else {
              bot.sendMessage(withdrawal.user_id, workerText, { parse_mode: 'HTML' }).catch((err) => {
                console.error('Error notifying worker:', err);
              });
            }
          }
        );
      }
    );
    return;
  }

  // Отмена заявки
  if (data.startsWith('cancel_withdrawal_')) {
    bot.answerCallbackQuery(query.id);
    const withdrawalId = parseInt(data.replace('cancel_withdrawal_', ''));

    db.get('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId], (err, withdrawal) => {
      if (err || !withdrawal) {
        bot.sendMessage(chatId, '❌ Заявка не найдена');
        return;
      }

      // Возвращаем баланс воркеру
      db.run('UPDATE users SET balance = balance + ? WHERE user_id = ?', [withdrawal.amount, withdrawal.user_id], (err) => {
        if (err) {
          console.error('Error restoring balance:', err);
        }
      });

      // Удаляем заявку
      db.run('DELETE FROM withdrawals WHERE id = ?', [withdrawalId], (err) => {
        if (err) {
          bot.sendMessage(chatId, '❌ Ошибка отмены заявки');
          return;
        }

        bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
        bot.sendMessage(chatId, '❌ Заявка на выплату отменена');

        // Уведомляем воркера
        bot.sendMessage(withdrawal.user_id, '❌ Ваша заявка на выплату была отменена. Средства возвращены на баланс.').catch(() => {});
      });
    });
    return;
  }

  // Обработка админских callback
  if (adminIds.includes(userId)) {
    if (data === 'admin_add_card') {
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId, '➕ Отправьте реквизит для добавления:');

      guard.setPendingInput(userId, chatId, (msg) => {
        if (msg.chat.id !== chatId) return;
        if (!msg.text) return;

        guard.clearPendingInput(userId);

        const cardInfo = msg.text;
        db.run('INSERT INTO cards (card_info) VALUES (?)', [cardInfo], (err) => {
          if (err) {
            bot.sendMessage(chatId, '❌ Ошибка добавления');
          } else {
            bot.sendMessage(chatId, '✅ Реквизит добавлен!');
          }
        });
      });
      return;
    } else if (data === 'admin_delete_card') {
      bot.answerCallbackQuery(query.id);
      db.all('SELECT * FROM cards ORDER BY created_at DESC', (err, cards) => {
        if (err || !cards || cards.length === 0) {
          bot.sendMessage(chatId, '❌ Нет реквизитов для удаления');
          return;
        }

        let cardText = '💳 Выберите номер реквизита для удаления:\n\n';
        cards.forEach((card, index) => {
          cardText += `${index + 1}. ${card.card_info}\n`;
        });

        bot.sendMessage(chatId, cardText);

        guard.setPendingInput(userId, chatId, (msg) => {
          if (msg.chat.id !== chatId) return;
          if (!msg.text) return;

          guard.clearPendingInput(userId);

          const cardIndex = parseInt(msg.text) - 1;
          if (cardIndex >= 0 && cardIndex < cards.length) {
            db.run('DELETE FROM cards WHERE id = ?', [cards[cardIndex].id], (err) => {
              if (err) {
                bot.sendMessage(chatId, '❌ Ошибка удаления');
              } else {
                bot.sendMessage(chatId, '✅ Реквизит удален!');
              }
            });
          } else {
            bot.sendMessage(chatId, '❌ Неверный номер');
          }
        });
      });
      return;
    }
  }

  // Обработка остальных callback
  // Проверяем одобрена ли заявка для доступа к основному функционалу
  const protectedCallbacks = ['profile', 'work', 'training', 'card', 'community', 'feedback', 'settings',
                               'materials', 'profile_settings', 'change_name', 'hide_profile',
                               'transfer_profile', 'withdraw', 'cancel_withdraw', 'back_to_menu',
                               'payout_wallet', 'wallet_set_cryptobot', 'wallet_set_trc20',
                               'wallet_set_bep20', 'wallet_cancel_input', 'detach_curator'];

  if (protectedCallbacks.includes(data) || data.startsWith('wallet_confirm_') ||
      data.startsWith('show_mentor_') || data.startsWith('assign_mentor_')) {
    db.get('SELECT application_approved FROM users WHERE user_id = ?', [userId], (err, user) => {
      if (err || !user || Number(user.application_approved) !== 1) {
        bot.answerCallbackQuery(query.id, { text: '❌ Доступ запрещен. Пройдите процесс регистрации.' });
        return;
      }

      // Продолжаем обработку если заявка одобрена
      handleProtectedCallback(query, data, chatId, userId);
    });
    return;
  }

  // Обработка админских callback для управления реквизитами
  if (adminIds.includes(userId)) {
    if (data === 'admin_add_card') {
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId, '➕ Отправьте реквизит для добавления:');

      guard.setPendingInput(userId, chatId, (msg) => {
        if (msg.chat.id !== chatId) return;
        if (!msg.text) return;

        guard.clearPendingInput(userId);

        const cardInfo = msg.text;
        db.run('INSERT INTO cards (card_info) VALUES (?)', [cardInfo], (err) => {
          if (err) {
            bot.sendMessage(chatId, '❌ Ошибка добавления');
          } else {
            bot.sendMessage(chatId, '✅ Реквизит добавлен!');
          }
        });
      });
      return;
    } else if (data === 'admin_delete_card') {
      bot.answerCallbackQuery(query.id);
      db.all('SELECT * FROM cards ORDER BY created_at DESC', (err, cards) => {
        if (err || !cards || cards.length === 0) {
          bot.sendMessage(chatId, '❌ Нет реквизитов для удаления');
          return;
        }

        let cardText = '💳 Выберите номер реквизита для удаления:\n\n';
        cards.forEach((card, index) => {
          cardText += `${index + 1}. ${card.card_info}\n`;
        });

        bot.sendMessage(chatId, cardText);

        guard.setPendingInput(userId, chatId, (msg) => {
          if (msg.chat.id !== chatId) return;
          if (!msg.text) return;

          guard.clearPendingInput(userId);

          const cardIndex = parseInt(msg.text) - 1;
          if (cardIndex >= 0 && cardIndex < cards.length) {
            db.run('DELETE FROM cards WHERE id = ?', [cards[cardIndex].id], (err) => {
              if (err) {
                bot.sendMessage(chatId, '❌ Ошибка удаления');
              } else {
                bot.sendMessage(chatId, '✅ Реквизит удален!');
              }
            });
          } else {
            bot.sendMessage(chatId, '❌ Неверный номер');
          }
        });
      });
      return;
    }
  }

  // Обработка неизвестных callback
  bot.answerCallbackQuery(query.id);
}));

// Восстановление reply-клавиатуры (если после регистрации кнопки не появились)
bot.onText(/\/keyboard/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (msg.chat.type !== 'private') {
    return;
  }

  db.get('SELECT application_approved FROM users WHERE user_id = ?', [userId], (err, user) => {
    if (err || !hasFullAccess(user)) {
      bot.sendMessage(chatId, '⌨️ Кнопки «Меню» и «Информация» доступны после завершения регистрации (правила и подписка).');
      return;
    }

    sendWelcomeKeyboardMessage(chatId, { disableNotification: true }).catch((err) => {
      console.error('/keyboard failed:', telegramErrorSummary(err));
      bot.sendMessage(chatId, '❌ Не удалось показать кнопки. Напиши /start или обратись к администратору.');
    });
  });
});

// Команда /me
bot.onText(/\/me/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await requireFullAccess(userId, chatId, msg.from))) return;
  const isPrivateChat = msg.chat.type === 'private';

  getUser(userId, async (err, user) => {
    if (err || !user) {
      bot.sendMessage(chatId, '❌ Профиль не найден. Используйте /start');
      return;
    }

    utils.getTopPosition(userId, async (err, topPosition) => {
      const position = err ? 0 : topPosition;

      // Баг 4 исправлен: в чате отправляем без кнопок, в личке - с кнопками
      if (isPrivateChat) {
        await sendProfileMessage(chatId, user, position);
      } else {
        // В чате отправляем профиль без кнопок (передаем null)
        await sendProfileMessage(chatId, user, position, { reply_markup: null });
      }
    });
  });
});

// Команда /ref — индивидуальная ссылка приглашения + статистика по ней.
// Доступна всем, в меню команд не добавляется (см. bot.setMyCommands выше).
const REF_GENERAL_CHAT_ID = '-1003986505552'; // Общий чат

bot.onText(/\/ref(?:@[\w_]+)?(?:\s|$)/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const botUsername = process.env.BOT_USERNAME || 'AXE_xBOT';
  const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;

  const sendRefPanel = (stats) => {
    const fmt = (n) => Number(n || 0).toLocaleString('en-US');
    console.log(`/ref ${msg.from.id}: users=${stats.total} blocked=${stats.blocked} active=${stats.active} inChat=${stats.inChat} profit=${stats.profit_sum}`);
    const text = `<tg-emoji emoji-id="5451790705380859191">📊</tg-emoji><b>Статистика</b>

<tg-emoji emoji-id="5445207349444782273">👥</tg-emoji><b>Пользователи:</b> ${fmt(stats.total)}

<tg-emoji emoji-id="5444862184398040102">🚫</tg-emoji><b>Заблокировали:</b> ${fmt(stats.blocked)}

<tg-emoji emoji-id="5449873797052148929">⚡️</tg-emoji><b>Активные пользователи:</b> ${fmt(stats.active)}

<tg-emoji emoji-id="5451730279485973759">🟪</tg-emoji><b>В чате:</b> ${fmt(stats.inChat)}

<tg-emoji emoji-id="5451805523018033441">💰</tg-emoji><b>Сумма профитов:</b> ${fmt(stats.profit_sum)}₽

<tg-emoji emoji-id="5445228961720215872">🔗</tg-emoji><b>Ваша ссылка:</b>
<code>${escapeHtml(refLink)}</code>`;

    bot.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true }).catch((err) => {
      console.error('Error sending /ref panel:', telegramErrorSummary(err));
    });
  };

  // Индивидуальная статистика по ссылке этого пользователя ref_<id>,
  // те же строки панели, что и раньше, но цифры — только по его приведённым.
  // «Пользователи» — приведённые им принятье воркеры.
  // «Сумма профитов» — касса только приведённых им воркеров.
  db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN application_approved = 1 THEN 1 ELSE 0 END), 0) AS total,
       COALESCE(SUM(CASE WHEN application_approved = 1 AND referral_blocked = 1 THEN 1 ELSE 0 END), 0) AS blocked,
       COALESCE(SUM(CASE WHEN application_approved = 1 AND COALESCE(referral_blocked, 0) = 0 THEN 1 ELSE 0 END), 0) AS active,
       COALESCE((SELECT SUM(p.amount)
                 FROM profits p
                 INNER JOIN users u ON u.user_id = p.user_id
                 WHERE u.referred_by = ?
                   AND u.application_approved = 1), 0) AS profit_sum
     FROM users
     WHERE referred_by = ? AND application_approved = 1`,
    [userId, userId],
    (err, row) => {
      if (err) {
        console.error('/ref stats error:', err);
        bot.sendMessage(chatId, '❌ Ошибка загрузки статистики. Попробуйте ещё раз.').catch(() => {});
        return;
      }

      const base = row || { total: 0, blocked: 0, active: 0, profit_sum: 0 };

      // «В чате» — сколько приведённых воркеров реально в общем чате.
      // Проверяем членство с ограниченной конкуренцией, как в backfillReferralBlocked.
      db.all(
        'SELECT user_id FROM users WHERE referred_by = ? AND application_approved = 1',
        [userId],
        (userErr, referred) => {
          if (userErr || !referred || !referred.length) {
            base.inChat = 0;
            sendRefPanel(base);
            return;
          }

          const queue = referred.slice(0, 100);
          const CONCURRENCY = 10;
          let running = 0;
          let done = 0;
          let inChat = 0;

          const pump = () => {
            while (running < CONCURRENCY && queue.length) {
              running += 1;
              const uid = queue.shift();
              bot.getChatMember(REF_GENERAL_CHAT_ID, uid)
                .then((member) => {
                  if (member && ['member', 'administrator', 'creator'].includes(member.status)) inChat += 1;
                })
                .catch(() => {})
                .finally(() => {
                  running -= 1;
                  done += 1;
                  pump();
                });
            }
            if (done >= referred.length) {
              base.inChat = inChat;
              sendRefPanel(base);
            }
          };

          pump();
        }
      );
    }
  );
});

// Команда /staff
bot.onText(/\/staff/, async (msg) => {
  const chatId = msg.chat.id;
  if (!(await requireFullAccess(msg.from.id, chatId, msg.from))) return;
  const staffText = `<tg-emoji emoji-id="5357069174512303778">🦺</tg-emoji><b>Лица администрации</b>

┏ <tg-emoji emoji-id="5992157823838984339">👨‍🏫</tg-emoji><b>Кураторы</b>
┣  @arachnophobia_AXE
┗  @Maximus_AXE

┏<tg-emoji emoji-id="5960714428394507968">👁</tg-emoji><b>Модераторы</b>
┣ @Henry_AXE
┗ @Aether_AXE

┏<tg-emoji emoji-id="6028226658543082010">🕵️‍♂️</tg-emoji><b>Саппорты</b> 
┗ @Daryl_AXE

┏<tg-emoji emoji-id="5967280668885913944">🗣</tg-emoji><b>Feedback</b>
┗ @FeedbackAXEbot

<tg-emoji emoji-id="5276240711795107620">⚠️</tg-emoji><b>Администрация AXE TEAM никогда не пишет первой</b>`;

  bot.sendMessage(chatId, staffText, { parse_mode: 'HTML', disable_web_page_preview: true }).catch(err => {
    console.error('Error sending staff message:', err);
  });
});

// ── Панель куратора /cur ────────────────────────────────────────────────
const fmtCurAmount = (n) => Number(n).toLocaleString('de-DE');

function profitWord(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'Профит';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'Профита';
  return 'Профитов';
}

// Собирает контент панели /cur: список учеников + сумма их профитов
function buildCurContent(mentor) {
  return new Promise((resolve) => {
    const curatorName = mentor.username;
    db.all('SELECT user_id, username, name FROM users WHERE LOWER(curator) = LOWER(?) ORDER BY user_id ASC', [curatorName], (err, students) => {
      if (err || !students || students.length === 0) {
        resolve({
          text: `<b><tg-emoji emoji-id="5445178551689062106">🟩</tg-emoji>Твои ученики\n\nУ тебя пока нет учеников.</b>`,
          reply_markup: { inline_keyboard: [] }
        });
        return;
      }

      const ids = students.map((s) => s.user_id);
      const placeholders = ids.map(() => '?').join(',');
      db.all(`SELECT user_id, COALESCE(SUM(amount), 0) AS total, COUNT(id) AS cnt
              FROM profits WHERE user_id IN (${placeholders}) GROUP BY user_id`, ids, (err2, rows) => {
        const stats = {};
        if (!err2 && rows) {
          rows.forEach((r) => { stats[r.user_id] = { total: Number(r.total) || 0, cnt: Number(r.cnt) || 0 }; });
        }

        let grandTotal = 0;
        const lines = [];
        students.forEach((s) => {
          const st = stats[s.user_id] || { total: 0, cnt: 0 };
          grandTotal += st.total;
          const tag = String(s.username || s.name || s.user_id).replace(/^[@#]/, '');
          lines.push(`@${tag} - ${fmtCurAmount(st.total)}₽ ${st.cnt} ${profitWord(st.cnt)}`);
        });

        const text = `<b><tg-emoji emoji-id="5445178551689062106">🟩</tg-emoji>Твои ученики

<tg-emoji emoji-id="5451730279485973759">🟪</tg-emoji>Общая сумма профитов
┗ ${fmtCurAmount(grandTotal)}₽

${lines.join('\n\n')}</b>`;

        const keyboard = {
          inline_keyboard: students.map((s) => [{
            text: `Профиль: ${String(s.username || s.name || s.user_id).replace(/^[@#]/, '')}`,
            callback_data: `cur_student_${s.user_id}`
          }])
        };
        resolve({ text, reply_markup: keyboard });
      });
    });
  });
}

// Показывает/перерисовывает панель /cur. Если messageId задан — editMessageText.
function renderCurMessage(chatId, mentor, messageId) {
  return buildCurContent(mentor).then(({ text, reply_markup }) => {
    if (messageId) {
      return bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup
      }).catch(() =>
        bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup })
      );
    }
    return bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup });
  });
}

bot.onText(/\/cur(?:@[\w_]+)?(?:\s|$)/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (msg.chat.type !== 'private') return;
  if (!(await requireFullAccess(userId, chatId, msg.from))) return;

  const mentor = getMentorByUsername(msg.from.username);
  if (!mentor) {
    bot.sendMessage(chatId, '❌ Команда /cur доступна только кураторам.').catch(() => {});
    return;
  }

  // Фиксируем Telegram ID куратора — он нужен для уведомлений о новых учениках и профитах
  mentor.userId = userId;

  renderCurMessage(chatId, mentor, null).catch((err) => {
    console.error('/cur render failed:', err);
  });
});

const TOP_RANK_EMOJI = [
  { id: '5440539497383087970', fallback: '🥇' },
  { id: '5447203607294265305', fallback: '🥈' },
  { id: '5453902265922376865', fallback: '🥉' },
  { id: '5994495149336434048', fallback: '🥉' },
  { id: '5994495149336434048', fallback: '🥉' },
  { id: '5994495149336434048', fallback: '🥉' },
  { id: '5994495149336434048', fallback: '🥉' },
  { id: '5994495149336434048', fallback: '🥉' },
  { id: '5994495149336434048', fallback: '🥉' },
  { id: '5994495149336434048', fallback: '🥉' }
];

const CASH_EMOJI = { id: '5967390100357648692', fallback: '🏦' };

const rankEmojiTag = (index) => {
  const e = TOP_RANK_EMOJI[index] || TOP_RANK_EMOJI[9];
  return `<tg-emoji emoji-id="${e.id}">${e.fallback}</tg-emoji>`;
};

const formatTopLine = (user, value, index) => {
  const displayName = (user.name || user.username || '').replace(/^#/, '');
  const nameB64 = Buffer.from(displayName).toString('base64url');
  const profileLink = `https://t.me/${process.env.BOT_USERNAME || 'AXE_xBOT'}?start=profile_${user.user_id}_n_${nameB64}`;
  return `<b>${rankEmojiTag(index)}<a href="${profileLink}">${displayName}</a> - ${value.toLocaleString('de-DE')}₽</b>\n`;
};

const formatCashLine = (balance, label = 'Касса проекта') => {
  return `<b><tg-emoji emoji-id="${CASH_EMOJI.id}">${CASH_EMOJI.fallback}</tg-emoji>${label}: ${balance.toLocaleString('de-DE')}₽</b>`;
};

const getPeriodBalance = (startStr, endStr) => {
  return new Promise((resolve) => {
    const excludedNames = ['@sss','@Testovhik','@тестик','тестик','@testovhik','testovhik','test','#test'].map(n => `'${n.replace(/'/g, "''")}'`).join(',');
    const excludedUsernames = ['sss','freeobnall','test'].map(n => `'${n.replace(/'/g, "''")}'`).join(',');
    db.get(`SELECT COALESCE(SUM(p.amount), 0) as total
            FROM profits p JOIN users u ON p.user_id = u.user_id
            WHERE p.created_at >= ? AND p.created_at < ?
              AND LOWER(TRIM(COALESCE(u.name, ''))) NOT IN (${excludedNames})
              AND LOWER(TRIM(COALESCE(u.username, ''))) NOT IN (${excludedUsernames})`, [startStr, endStr], (err, row) => {
      resolve(err ? 0 : parseInt(row?.total || '0'));
    });
  });
};

// Топ воркеров: периоды all | day | month, переключение по кнопкам (editMessageText)
const TOP_KEYBOARDS = {
  all: { inline_keyboard: [[
    { text: 'Месяц', callback_data: 'top_show_month' },
    { text: 'День', callback_data: 'top_show_day' }
  ]]},
  day: { inline_keyboard: [[
    { text: 'За все время', callback_data: 'top_show_all' },
    { text: 'Месяц', callback_data: 'top_show_month' }
  ]]},
  month: { inline_keyboard: [[
    { text: 'За все время', callback_data: 'top_show_all' },
    { text: 'День', callback_data: 'top_show_day' }
  ]]}
};

const buildTopContent = (period) => new Promise((resolve) => {
  const now = new Date();
  let dateClause = '';
  let title = '🏆<b>Топ 10</b>\n\n';
  let emptyText = '📊 Топ пуст';
  let cashLabel = 'Касса проекта';
  const params = [];

  if (period === 'day') {
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    dateClause = 'p.created_at >= ? AND p.created_at < ? AND ';
    params.push(dayStart.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''));
    params.push(dayEnd.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''));
    title = '🌶<b>Топ 10 за сутки.</b>\n\n';
    emptyText = '📊 Топ дня пуст';
    cashLabel = 'Касса за день';
  } else if (period === 'month') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    dateClause = 'p.created_at >= ? AND p.created_at < ? AND ';
    params.push(monthStart.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''));
    params.push(monthEnd.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''));
    title = '📆<b>Топ 10 за месяц</b>\n\n';
    emptyText = '📊 Топ месяца пуст';
    cashLabel = 'Касса за месяц';
  }

  const periodStart = params[0] || '1970-01-01 00:00:00';
  const periodEnd = params[1] || '9999-12-31 23:59:59';

  db.all(`SELECT u.user_id, u.username, u.name, u.profile_hidden, COALESCE(SUM(p.amount), 0) as total_profit
          FROM profits p
          JOIN users u ON p.user_id = u.user_id
          WHERE ${dateClause}${utils.topExclusionWhere('u')}
          GROUP BY u.user_id
          HAVING total_profit > 0
          ORDER BY total_profit DESC, u.user_id ASC
          LIMIT 10`, params, (err, users) => {
    if (err || !users || users.length === 0) {
      if (err) console.error('Error in top query:', err);
      resolve({ text: emptyText, reply_markup: TOP_KEYBOARDS[period] });
      return;
    }

    let topText = title;
    users.forEach((user, index) => {
      topText += formatTopLine(user, user.total_profit, index);
    });

    getPeriodBalance(periodStart, periodEnd).then(balance => {
      topText += `\n${formatCashLine(balance, cashLabel)}`;
      resolve({ text: topText, reply_markup: TOP_KEYBOARDS[period] });
    });
  });
});

// Команда /top - Топ 10 за все время (переключение периодов по кнопкам)
bot.onText(/\/(top|топ)(?:@[\w_]+)?(?:\s|$)/, async (msg) => {
  const chatId = msg.chat.id;
  if (!(await requireFullAccess(msg.from.id, chatId, msg.from))) return;

  buildTopContent('all').then(({ text, reply_markup }) => {
    bot.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup }).catch(err => {
      console.error('Error sending top message:', err);
    });
  });
});

// Переключение периодов топа по кнопкам — редактируем сообщение, не переотправляем
bot.on('callback_query', (query) => {
  const data = query.data || '';
  if (!data.startsWith('top_show_')) return;

  const period = data.replace('top_show_', '');
  if (!['all', 'day', 'month'].includes(period)) return;

  bot.answerCallbackQuery(query.id).catch(() => {});
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  buildTopContent(period).then(({ text, reply_markup }) => {
    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup
    }).catch(err => {
      console.error('Error editing top message:', err);
    });
  });
});

// Клик по закрытому чату — полноэкранное уведомление о требуемом статусе
bot.on('callback_query', (query) => {
  const data = query.data || '';
  if (!data.startsWith('chat_locked_')) return;

  const chat = statusChats.getChatByKey(data.replace('chat_locked_', ''));
  if (!chat) return;

  bot.answerCallbackQuery(query.id, { text: `Данный чат доступен при статусе ${chat.label}`, show_alert: true }).catch(() => {});
});

// Команда /materials
bot.onText(/\/materials/, async (msg) => {
  const chatId = msg.chat.id;
  if (!(await requireFullAccess(msg.from.id, chatId, msg.from))) return;

  const materialsKeyboard = {
    inline_keyboard: [
      [{ text: 'Материалы', url: 'https://t.me/+GMixQrZvJkQ4ODE6' }]
    ]
  };

  bot.sendMessage(chatId, '<b>📂 Обучающие материалы:</b>', {
    parse_mode: 'HTML',
    reply_markup: materialsKeyboard
  }).catch(err => {
    console.error('Error sending materials message:', err);
  });
});

// Команда для получения ID чата (только для админов)
bot.onText(/\/chatid/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!adminIds.includes(userId)) {
    return;
  }

  const chatInfo = `📊 Информация о чате:

Chat ID: ${chatId}
Chat Type: ${msg.chat.type}
Chat Title: ${msg.chat.title || 'N/A'}
User ID: ${userId}
Username: @${msg.from.username || 'unknown'}

Используйте этот Chat ID в bot.js для проверки подписки.`;

  bot.sendMessage(chatId, chatInfo);
});

// Админские команды
bot.onText(/\/cards/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!adminIds.includes(userId)) {
    bot.sendMessage(chatId, '❌ У вас нет прав администратора');
    return;
  }

  const keyboard = {
    inline_keyboard: [
      [{ text: 'Добавить реквизит', callback_data: 'admin_add_card' }],
      [{ text: 'Удалить реквизит', callback_data: 'admin_delete_card' }]
    ]
  };

  bot.sendMessage(chatId, '🔧 Управление реквизитами:', { reply_markup: keyboard });
});

// Команда /mute - замутить пользователя
bot.onText(/\/mute(?:\s+(\d+))?(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Проверка прав администратора
  if (!adminIds.includes(userId)) {
    bot.sendMessage(chatId, '❌ У вас нет прав администратора');
    return;
  }

  // Проверка, что команда используется в группе
  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
    bot.sendMessage(chatId, '❌ Эта команда работает только в группах');
    return;
  }

  const targetUserId = match[1];
  const muteDuration = match[2] ? parseInt(match[2]) : 60; // По умолчанию 60 минут

  // Проверка на reply
  if (!targetUserId && msg.reply_to_message) {
    const replyUserId = msg.reply_to_message.from.id;
    const replyUsername = msg.reply_to_message.from.username || msg.reply_to_message.from.first_name;

    try {
      const untilDate = Math.floor(Date.now() / 1000) + (muteDuration * 60);

      await bot.restrictChatMember(chatId, replyUserId, {
        permissions: {
          can_send_messages: false,
          can_send_media_messages: false,
          can_send_polls: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false,
          can_change_info: false,
          can_invite_users: false,
          can_pin_messages: false
        },
        until_date: untilDate
      });

      bot.sendMessage(chatId, `🔇 Пользователь @${replyUsername} замучен на ${muteDuration} минут`);
    } catch (error) {
      console.error('Mute error:', error);
      bot.sendMessage(chatId, '❌ Ошибка при муте пользователя. Убедитесь, что бот является администратором с правами на ограничение пользователей.');
    }
    return;
  }

  if (!targetUserId) {
    bot.sendMessage(chatId, '❌ Использование: /mute [user_id] [минуты] или ответьте на сообщение пользователя командой /mute [минуты]');
    return;
  }

  try {
    const untilDate = Math.floor(Date.now() / 1000) + (muteDuration * 60);

    await bot.restrictChatMember(chatId, parseInt(targetUserId), {
      permissions: {
        can_send_messages: false,
        can_send_media_messages: false,
        can_send_polls: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
        can_change_info: false,
        can_invite_users: false,
        can_pin_messages: false
      },
      until_date: untilDate
    });

    bot.sendMessage(chatId, `🔇 Пользователь ${targetUserId} замучен на ${muteDuration} минут`);
  } catch (error) {
    console.error('Mute error:', error);
    bot.sendMessage(chatId, '❌ Ошибка при муте пользователя. Убедитесь, что бот является администратором с правами на ограничение пользователей.');
  }
});

// Команда /ban - забанить пользователя
bot.onText(/\/ban(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Проверка прав администратора
  if (!adminIds.includes(userId)) {
    bot.sendMessage(chatId, '❌ У вас нет прав администратора');
    return;
  }

  // Проверка, что команда используется в группе
  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
    bot.sendMessage(chatId, '❌ Эта команда работает только в группах');
    return;
  }

  const targetUserId = match[1];

  // Проверка на reply
  if (!targetUserId && msg.reply_to_message) {
    const replyUserId = msg.reply_to_message.from.id;
    const replyUsername = msg.reply_to_message.from.username || msg.reply_to_message.from.first_name;

    try {
      await bot.banChatMember(chatId, replyUserId);
      bot.sendMessage(chatId, `🚫 Пользователь @${replyUsername} забанен`);
    } catch (error) {
      console.error('Ban error:', error);
      bot.sendMessage(chatId, '❌ Ошибка при бане пользователя. Убедитесь, что бот является администратором с правами на бан пользователей.');
    }
    return;
  }

  if (!targetUserId) {
    bot.sendMessage(chatId, '❌ Использование: /ban [user_id] или ответьте на сообщение пользователя командой /ban');
    return;
  }

  try {
    await bot.banChatMember(chatId, parseInt(targetUserId));
    bot.sendMessage(chatId, `🚫 Пользователь ${targetUserId} забанен`);
  } catch (error) {
    console.error('Ban error:', error);
    bot.sendMessage(chatId, '❌ Ошибка при бане пользователя. Убедитесь, что бот является администратором с правами на бан пользователей.');
  }
});

// Команда для ручного обновления закрепленного сообщения (только для админов)
bot.onText(/\/updatepin/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!adminIds.includes(userId)) {
    bot.sendMessage(chatId, '❌ У вас нет прав администратора');
    return;
  }

  bot.sendMessage(chatId, '🔄 Обновляю закрепленное сообщение...');
  await loadPinnedMessageId();
  await updatePinnedMessage(bot, GENERAL_CHAT_ID);
  bot.sendMessage(chatId, '✅ Закрепленное сообщение обновлено!');
});

// Команда для отправки основной клавиатуры всем принятым пользователям (только для админов)
bot.onText(/\/sendkeyboard/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!adminIds.includes(userId)) {
    bot.sendMessage(chatId, '❌ У вас нет прав администратора');
    return;
  }

  // Проверка, что команда используется в личных сообщениях
  if (msg.chat.type !== 'private') {
    bot.sendMessage(chatId, '❌ Эта команда работает только в личных сообщениях с ботом');
    return;
  }

  bot.sendMessage(chatId, '⌨️ Начинаю отправку клавиатуры всем принятым пользователям...');

  // Получаем всех принятых пользователей (исключаем невалидные id)
  db.all(
    'SELECT DISTINCT user_id FROM users WHERE application_approved = 1 AND user_id IS NOT NULL AND user_id > 0',
    async (err, users) => {
    if (err) {
      console.error('Error getting users:', err);
      bot.sendMessage(chatId, '❌ Ошибка получения списка пользователей');
      return;
    }

    if (!users || users.length === 0) {
      bot.sendMessage(chatId, '❌ В базе данных нет принятых пользователей');
      return;
    }

    let successCount = 0;
    let failCount = 0;
    let firstFailureReason = '';
    const totalUsers = users.length;

    // Функция для отправки клавиатуры с задержкой
    const sendWithDelay = async (user, index) => {
      return new Promise((resolve) => {
        setTimeout(async () => {
          const targetId = Number(user.user_id);
          try {
            await sendMainKeyboard(targetId, { disableNotification: true });
            successCount++;
          } catch (error) {
            const summary = telegramErrorSummary(error);
    if (!firstFailureReason && summary) firstFailureReason = summary.slice(0, 400);
            console.error(`Failed to send keyboard to user ${targetId}:`, summary);
            failCount++;
          }
          resolve();
        }, index * 100); // Задержка 100мс между сообщениями
      });
    };

    // Отправляем клавиатуру всем пользователям
    const promises = users.map((user, index) => sendWithDelay(user, index));
    await Promise.all(promises);

    // Отправляем статистику админу
    const statsMessage = `✅ <b>Отправка клавиатуры завершена!</b>

📊 Статистика:
• Всего пользователей: ${totalUsers}
• Успешно доставлено: ${successCount}
• Не доставлено: ${failCount}${failCount > 0 && firstFailureReason ? `

<i>Пример ошибки Telegram (первый сбой):</i>
<code>${escapeHtml(firstFailureReason)}</code>` : ''}`;

    bot.sendMessage(chatId, statsMessage, { parse_mode: 'HTML' });
  });
});

// Команда /broadcast - начать рассылку (только для админов)
bot.onText(/\/broadcast/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!adminIds.includes(userId)) {
    bot.sendMessage(chatId, '❌ У вас нет прав администратора');
    return;
  }

  // Проверка, что команда используется в личных сообщениях
  if (msg.chat.type !== 'private') {
    bot.sendMessage(chatId, '❌ Эта команда работает только в личных сообщениях с ботом');
    return;
  }

  broadcastMode[userId] = true;
  bot.sendMessage(chatId, '📢 <b>Режим рассылки активирован</b>\n\nОтправьте следующее сообщение, которое хотите разослать всем пользователям.\n\nПоддерживаются:\n• Текст (с форматированием HTML)\n• Фото\n• Видео\n• Документы\n• Стикеры\n\nДля отмены отправьте /cancel', { parse_mode: 'HTML' });
});

// Команда /cancel - отменить рассылку
bot.onText(/\/cancel/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const chatType = msg.chat.type;

  if (broadcastMode[userId]) {
    delete broadcastMode[userId];
    bot.sendMessage(chatId, '❌ Режим рассылки отменен');
  }

  // Отмена редактирования рассылки
  if (cancelRassEdit(userId)) {
    bot.sendMessage(chatId, '❌ Редактирование рассылки отменено');
  }

  // Отмена настройки авто-публикации профитов
  if (cancelAutoFlow(userId)) {
    bot.sendMessage(chatId, '❌ Настройка авто-публикации отменена');
  }

  // Отмена создания реквизита
  if (cardSystem.cardCreationState[userId]) {
    delete cardSystem.cardCreationState[userId];
    bot.sendMessage(chatId, '❌ Создание реквизита отменено');
  }

  if (chatType !== 'private') return;

  // Отмена запроса реквизита
  if (cardSystem.cardRequestState[userId]) {
    delete cardSystem.cardRequestState[userId];
    bot.sendMessage(chatId, '❌ Запрос реквизита отменен');
  }

  // Отмена отправки чека
  if (cardSystem.checkSubmissionState[userId]) {
    delete cardSystem.checkSubmissionState[userId];
    bot.sendMessage(chatId, '❌ Отправка чека отменена');
  }
});

// ==================== СИСТЕМА УПРАВЛЕНИЯ РЕКВИЗИТАМИ ====================

// Команда /setcard - управление реквизитами (только для админов)
bot.onText(/\/setcard/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!adminIds.includes(userId)) {
    bot.sendMessage(chatId, '❌ У вас нет прав администратора');
    return;
  }

  const keyboard = {
    inline_keyboard: [
      [{ text: 'Создать реквизит', callback_data: 'card_create' }],
      [{ text: 'Удалить реквизит', callback_data: 'card_delete' }],
      [{ text: 'Изменить реквизит', callback_data: 'card_edit' }]
    ]
  };

  bot.sendMessage(chatId, '💳 <b>Управление реквизитами</b>', {
    parse_mode: 'HTML',
    reply_markup: keyboard
  });
});

// Автоматическое одобрение запросов на вступление в чат
bot.on('chat_join_request', async (chatJoinRequest) => {
  const chatId = chatJoinRequest.chat.id;
  const userId = chatJoinRequest.from.id;
  const username = chatJoinRequest.from.username || 'unknown';

  try {
    // Автоматически одобряем запрос на вступление
    await bot.approveChatJoinRequest(chatId, userId);
    console.log(`✅ Автоматически одобрен запрос на вступление от @${username} (ID: ${userId}) в чат ${chatId}`);

  } catch (error) {
    console.error('❌ Ошибка одобрения запроса на вступление:', error);
  }
});


// Принятые ранее пользователи: welcome_keyboard_sent не блокирует доступ
db.run(
  `UPDATE users SET welcome_keyboard_sent = 1 WHERE application_approved = 1 AND COALESCE(welcome_keyboard_sent, 0) = 0`,
  function onWelcomeMigrate(err) {
    if (err && !/no such column/i.test(String(err.message))) {
      console.error('welcome_keyboard_sent migration:', err.message);
    } else if (this.changes > 0) {
      console.log(`✅ welcome_keyboard_sent: обновлено ${this.changes} принятых пользователей`);
    }
  }
);

console.log('🤖 Бот запущен...');
