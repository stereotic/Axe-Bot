require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');
const keyboards = require('./keyboards');
const utils = require('./utils');
const cardSystem = require('./card_system');
const { setupCardHandlers } = require('./card_handlers');
const { setupCardViewHandlers, openCardView, startCardRequestInPrivate, startCardCheckInPrivate } = require('./card_view_handlers');
const { setupCardRequestHandlers } = require('./card_request_handlers');
const { setupCheckHandlers } = require('./check_handlers');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const profileBanner = require('./profile_banner');
const { loadPinnedMessageId, updatePinnedMessage } = require('./update_pinned');

// Короткий текст, если нет картинки для меню (пустой sendMessage/caption Telegram отклоняет).
const MENU_PANEL_FALLBACK = 'Выбери раздел:';

const token = process.env.BOT_TOKEN;
const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim())).filter(Boolean) : [];
const PAYOUT_ADMIN_ID = 6383039210; // ID для получения заявок на выплату

// ID каналов для profit system
const ACCOUNTING_CHAT_ID = '-1003606797013'; // Бухгалтерия
const CASH_CHANNEL_ID = '-1003924744333'; // Общая касса (https://t.me/+euO9gzLMUMFhNmJi)
const GENERAL_CHAT_ID = '-1003986505552'; // Общий чат

// Временное хранилище для данных профита
const profitData = {};

// Данные куратора
const mentorData = {
  username: 'Henry_AXE',
  userId: null, // ID будет установлен при первом взаимодействии
  service: 'Кардинг',
  monthsOnPosition: 0, // Количество месяцев на должности
  currentStudents: 0, // Текущее количество учеников
  percent: 20,
  trainingProfits: 5, // Количество профитов для обучения
  workingHours: '14:00 - 00:00',
  description: `Активный воркер. Приучаю работать на качество, добиваюсь твоей стабильности в работе. Перед обращением ко мне обязательно знать теорию направления. За ручку не веду, иду сзади и корректирую каждый твой шаг. Большие профиты не покажутся тебе сказкой если, ты уделишь время моему курированию а так же проявишь усидчивость при работе.

Что ты получаешь?:

• Обучение без мануалов!
• Материалы для работы за твой %
• Четкий план работы.`
};

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

const bot = new TelegramBot(token, botOptions);

// Подключаем обработчики системы реквизитов
setupCardHandlers(bot, adminIds, GENERAL_CHAT_ID, ACCOUNTING_CHAT_ID, CASH_CHANNEL_ID);
setupCardViewHandlers(bot);
setupCardRequestHandlers(bot, adminIds);
setupCheckHandlers(bot, adminIds, GENERAL_CHAT_ID, ACCOUNTING_CHAT_ID, CASH_CHANNEL_ID);

// Устанавливаем меню команд бота
bot.setMyCommands([
  { command: 'me', description: 'Мой профиль' },
  { command: 'staff', description: 'Состав администрации' },
  { command: 'materials', description: 'Обучающие материалы' },
  { command: 'top', description: 'Топ воркеров за все время' },
  { command: 'topd', description: 'Топ воркеров за день' },
  { command: 'topm', description: 'Топ воркеров за месяц' },
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

// Баннеры с кешированием
let infoBannerCache = { text: null, timestamp: 0 };
const INFO_BANNER_CACHE_TTL = 60000;

const EXCLUDED_NAMES = ['#sss', '#Testovhik', '#тестик', 'тестик', '#testovhik', 'testovhik'];
const EXCLUDED_USERNAMES = ['sss', 'freeobnall'];

const INFO_BANNER = () => {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    if (infoBannerCache.text && (now - infoBannerCache.timestamp) < INFO_BANNER_CACHE_TTL) {
      resolve(infoBannerCache.text);
      return;
    }

    const excludedNameList = EXCLUDED_NAMES.map(n => `'${n.replace(/'/g, "''")}'`).join(',');
    const excludedUserList = EXCLUDED_USERNAMES.map(n => `'${n.replace(/'/g, "''")}'`).join(',');

    db.get(`SELECT SUM(amount) as total FROM profits p JOIN users u ON p.user_id = u.user_id WHERE LOWER(TRIM(COALESCE(u.name, ''))) NOT IN (${excludedNameList}) AND LOWER(TRIM(COALESCE(u.username, ''))) NOT IN (${excludedUserList})`, (err, profitRow) => {
      if (err) {
        reject(err);
        return;
      }

      db.get(`SELECT COUNT(*) as count FROM profits p JOIN users u ON p.user_id = u.user_id WHERE LOWER(TRIM(COALESCE(u.name, ''))) NOT IN (${excludedNameList}) AND LOWER(TRIM(COALESCE(u.username, ''))) NOT IN (${excludedUserList})`, (err, countRow) => {
        if (err) {
          reject(err);
          return;
        }

        const projectBalance = parseInt(profitRow?.total || '0');
        const totalProfits = parseInt(countRow?.count || '0');

        const banner = `<b>AXE TEAM - Информация 💎</b>

<b>Проценты выплат </b>💱
┣<b>Пополнение - 80%
┗Прямой перевод - 75%</b>

🏠<b>Сервисы</b>
┗ <b>Кардинг</b>

<b>🏦Касса проекта:</b> <i>${projectBalance.toLocaleString()}₽</i>
┗<b>Кол-во профитов:</b> <b><i>${totalProfits} шт</i></b>

<b>📆Дата открытия проекта 03.03.2026.</b>`;

        infoBannerCache = { text: banner, timestamp: now };
        resolve(banner);
      });
    });
  });
};

const WORK_INFO = `<b>🏠Сервис:</b> <b>Кардинг</b> 

<b>🤖Бот</b> <i>(Магазин)</i>
┗ @CrystalCC_xBot

👾<b>ТП</b> <i>(Обнальщик)</i>
┣ @Opium2D
┗ 👨‍💻: @Enhtein

<b>📚 Мануал</b>:
┗ <a href="https://telegra.ph/Napravlenie-Karding-05-12">Кардинг</a> ← Читать

• <b>WORK-Панель</b>, <i>и  реферальная ссылка находится в </i><i><b>магазине</b> по команде</i> /bb`;

const FEEDBACK_INFO = `• <b>Feedback</b>

<b>📨Связаться с администрацией</b>
┗ @FeedbackAXEbot`;



// Функция получения курса доллара
async function getUsdRate() {
  try {
    const response = await axios.get('https://www.cbr-xml-daily.ru/daily_json.js');
    const usdRate = response.data.Valute.USD.Value;
    return Math.round(usdRate * 100) / 100;
  } catch (error) {
    console.error('Error fetching USD rate:', error);
    return 95.50; // Значение по умолчанию
  }
}

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

function createUser(userId, username) {
  utils.generateWorkerNumber((err, workerNumber) => {
    if (err) {
      console.error('Error generating worker number:', err);
      return;
    }

    const defaultName = `Worker${workerNumber}`;
    db.run(
      'INSERT OR IGNORE INTO users (user_id, username, name, worker_number, application_approved, welcome_keyboard_sent) VALUES (?, ?, ?, ?, 0, 0)',
      [userId, username, defaultName, workerNumber]
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

// Функция форматирования профиля
function formatProfile(user, topPosition) {
  return `👤<b>Воркер:</b> @${user.username || 'unknown'}
🪪<b>Name:</b> ${user.name}
┗ <b>Статус:</b> ${user.status}

💼<b>Кошелек</b>
┗ <b>На вывод:</b> <i>${user.balance.toLocaleString()}₽</i>

<b>🏦Касса воркера:</b> <i>${user.total_earned.toLocaleString()}₽</i>
┣ <b>Кол-во профитов:</b> ${user.profit_count}
┗ <b>Место в топе:</b> ${topPosition}`;
}

async function sendProfileMessage(chatId, user, topPosition, options = {}) {
  try {
    const profileMedia = await profileBanner.buildProfileMedia(bot, user, topPosition);

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
      sendOptions.reply_markup = keyboards.profile;
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
      sendOptions.reply_markup = keyboards.profile;
    }

    const message = await bot.sendMessage(chatId, profileBanner.buildProfileCaption(user, topPosition), sendOptions);

    return message;
  }
}

async function updateProfileMessage(chatId, messageId, user, topPosition) {
  await bot.deleteMessage(chatId, messageId).catch(() => {});
  return sendProfileMessage(chatId, user, topPosition);
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

function isApplicationApproved(user) {
  return Boolean(user && Number(user.application_approved) === 1);
}

// Полный доступ к боту (прошёл подписку после одобрения заявки).
function hasFullAccess(user) {
  return isApplicationApproved(user);
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

const WELCOME_KEYBOARD_TEXT = '🦋 <b>Добро пожаловать в AXE TEAM</b>!';

// Панель «Информация» — текст AXE TEAM и 4 inline-кнопки (без reply-клавиатуры).
async function sendInfoPanel(chatId, options = {}) {
  const banner = await INFO_BANNER();
  const imagePath = path.join(__dirname, 'images', 'menu.jpg');
  const sendOpts = {
    parse_mode: 'HTML',
    disable_notification: options.disableNotification === true,
    reply_markup: keyboards.info
  };

  if (fs.existsSync(imagePath)) {
    return bot.sendPhoto(chatId, imagePath, { caption: banner, ...sendOpts });
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

  await sendInfoPanel(chatId, { disableNotification: true });
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

// Сначала отправляем новый экран, потом удаляем меню (чтобы не оставлять чат пустым).
function replaceMenuMessage(chatId, messageId, sendPromise) {
  return Promise.resolve(sendPromise)
    .then(() => bot.deleteMessage(chatId, messageId).catch(() => {}))
    .catch((err) => {
      console.error(`replaceMenuMessage failed for ${chatId}:`, telegramErrorSummary(err));
      return bot.sendMessage(chatId, '❌ Не удалось открыть раздел. Попробуйте ещё раз.').catch(() => {});
    });
}

const callbackDebounce = new Map();

// Функция для предотвращения дублирования callback (Баг 2)
function shouldProcessCallback(userId, callbackData) {
  const key = `${userId}_${callbackData}`;
  const now = Date.now();
  const lastCall = callbackDebounce.get(key) || 0;

  if (now - lastCall < 1000) return false;
  callbackDebounce.set(key, now);

  // Очищаем старые записи
  setTimeout(() => callbackDebounce.delete(key), 2000);
  return true;
}

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

  switch (data) {
    case 'back_to_menu':
      bot.answerCallbackQuery(query.id);
      const menuImagePath = path.join(__dirname, 'images', 'info.jpg');

      if (fs.existsSync(menuImagePath)) {
        replaceMenuMessage(chatId, messageId, bot.sendPhoto(chatId, menuImagePath, {
          reply_markup: keyboards.menu
        }));
      } else {
        replaceMenuMessage(chatId, messageId, bot.sendMessage(chatId, MENU_PANEL_FALLBACK, {
          reply_markup: keyboards.menu
        }));
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
            await sendProfileMessage(chatId, user, topPosition);
            await bot.deleteMessage(chatId, messageId).catch(() => {});
          } catch (error) {
            console.error('Profile menu navigation error:', error);
            bot.sendMessage(chatId, '❌ Не удалось открыть профиль. Попробуйте ещё раз.').catch(() => {});
          }
        });
      });
      break;

    case 'card':
      bot.answerCallbackQuery(query.id);
      openCardView(bot, chatId, userId, {
        deleteMessageId: messageId,
        showBackToMenu: true,
        chatType: query.message.chat.type
      });
      break;

    case 'work':
      bot.answerCallbackQuery(query.id);
      const workImagePath = path.join(__dirname, 'images', 'work.jpg');

      if (fs.existsSync(workImagePath)) {
        replaceMenuMessage(chatId, messageId, bot.sendPhoto(chatId, workImagePath, {
          caption: WORK_INFO,
          reply_markup: keyboards.work,
          parse_mode: 'HTML'
        }));
      } else {
        replaceMenuMessage(chatId, messageId, bot.sendMessage(chatId, WORK_INFO, {
          reply_markup: keyboards.work,
          parse_mode: 'HTML'
        }));
      }
      break;

    case 'training':
      bot.answerCallbackQuery(query.id);
      const trainingImagePath = path.join(__dirname, 'images', 'training.jpg');

      // Создаем клавиатуру с куратором
      const trainingKeyboard = {
        inline_keyboard: [
          [{ text: `@${mentorData.username}  ${mentorData.percent}%`, callback_data: 'show_mentor' }],
          [{ text: '◀️ Назад в меню', callback_data: 'back_to_menu' }]
        ]
      };

      if (fs.existsSync(trainingImagePath)) {
        replaceMenuMessage(chatId, messageId, bot.sendPhoto(chatId, trainingImagePath, {
          caption: '<b><i>Тег куратора • Процент</i></b>',
          parse_mode: 'HTML',
          reply_markup: trainingKeyboard
        }));
      } else {
        replaceMenuMessage(chatId, messageId, bot.sendMessage(chatId, '<b>Обучение</b>\n\n<b><i>Тег куратора • Процент</i></b>', {
          parse_mode: 'HTML',
          reply_markup: trainingKeyboard
        }));
      }
      break;

    case 'show_mentor':
      bot.answerCallbackQuery(query.id);

      // Получаем количество учеников куратора
      db.get('SELECT COUNT(*) as count FROM users WHERE curator = ?', [mentorData.username], (err, result) => {
        const studentsCount = err ? 0 : result.count;

        const mentorText = `👨‍🏫<b>Куратор:</b> <b>@${mentorData.username}</b>

<b>🏠Сервис</b>
┗  <b>${mentorData.service}</b>

⏰<b>На должности</b>
┗  ${mentorData.monthsOnPosition} месяцев

🤵‍♂️<b>Обучается</b>
┗  ${studentsCount}

⚖️<b>Процент</b>
┗  ${mentorData.percent}%

📚<b>Время обучения</b>
┗  ${mentorData.trainingProfits} профитов

⏳<b>Рабочее время</b>
┗  ${mentorData.workingHours}

⚠️<b>Описание:</b>
<i>${mentorData.description}</i>`;

        const mentorKeyboard = {
          inline_keyboard: [
            [{ text: '🖇Закрепиться за куратором', callback_data: 'assign_mentor' }],
            [{ text: '◀️ Назад', callback_data: 'training' }]
          ]
        };

        const mentorBannerPath = path.join(__dirname, 'images', 'mentor_banner.jpg');

        if (fs.existsSync(mentorBannerPath)) {
          replaceMenuMessage(chatId, messageId, bot.sendPhoto(chatId, mentorBannerPath, {
            caption: mentorText,
            parse_mode: 'HTML',
            reply_markup: mentorKeyboard
          }));
        } else {
          replaceMenuMessage(chatId, messageId, bot.sendMessage(chatId, mentorText, {
            parse_mode: 'HTML',
            reply_markup: mentorKeyboard
          }));
        }
      });
      break;

    case 'assign_mentor':
      bot.answerCallbackQuery(query.id);

      // Закрепляем пользователя за куратором
      db.run('UPDATE users SET curator = ? WHERE user_id = ?', [mentorData.username, userId], (err) => {
        if (err) {
          bot.sendMessage(chatId, '❌ Ошибка закрепления за куратором');
          console.error('Error assigning mentor:', err);
          return;
        }

        // Баг 3 исправлен: отправляем в личку пользователю (userId), а не в текущий чат (chatId)
        bot.sendMessage(userId, `✅ Вы успешно закрепились за куратором @${mentorData.username}!`).catch(err => {
          console.error('Error sending to user:', err);
        });

        // Отправляем уведомление куратору (если у нас есть его ID)
        if (mentorData.userId) {
          db.get('SELECT username FROM users WHERE user_id = ?', [userId], (err, user) => {
            const username = user && user.username ? `@${user.username}` : `ID: ${userId}`;
            bot.sendMessage(mentorData.userId, `🎓 За тобой закрепился пользователь ${username}`).catch(err => {
              console.error('Error sending to mentor:', err);
            });
          });
        }
      });
      break;

    case 'community':
      bot.answerCallbackQuery(query.id);
      const communityImagePath = path.join(__dirname, 'images', 'buy_card.jpg');
      const communityText = '<b>⭐️Для создания комьюнити необходимо согласование администрации.\n\nОбратитесь в Feedback</b>';

      const communityKeyboard = {
        inline_keyboard: [
          [{ text: '🗣Feedback', url: 'https://t.me/FeedbackAXEbot' }],
          [{ text: '◀️ Назад в меню', callback_data: 'back_to_menu' }]
        ]
      };

      if (fs.existsSync(communityImagePath)) {
        replaceMenuMessage(chatId, messageId, bot.sendPhoto(chatId, communityImagePath, {
          caption: communityText,
          parse_mode: 'HTML',
          reply_markup: communityKeyboard
        }));
      } else {
        replaceMenuMessage(chatId, messageId, bot.sendMessage(chatId, communityText, {
          parse_mode: 'HTML',
          reply_markup: communityKeyboard
        }));
      }
      break;

    case 'feedback':
      bot.answerCallbackQuery(query.id);
      const feedbackImagePath = path.join(__dirname, 'images', 'feedback.jpg');

      if (fs.existsSync(feedbackImagePath)) {
        replaceMenuMessage(chatId, messageId, bot.sendPhoto(chatId, feedbackImagePath, {
          caption: FEEDBACK_INFO,
          parse_mode: 'HTML',
          reply_markup: keyboards.feedback
        }));
      } else {
        replaceMenuMessage(chatId, messageId, bot.sendMessage(chatId, FEEDBACK_INFO, {
          parse_mode: 'HTML',
          reply_markup: keyboards.feedback
        }));
      }
      break;

    case 'settings':
      bot.answerCallbackQuery(query.id);
      const settingsImagePath = path.join(__dirname, 'images', 'settings.jpg');
      const settingsText = '⚙️ Настройки';

      if (fs.existsSync(settingsImagePath)) {
        replaceMenuMessage(chatId, messageId, bot.sendPhoto(chatId, settingsImagePath, {
          reply_markup: keyboards.settings_menu
        }));
      } else {
        replaceMenuMessage(chatId, messageId, bot.sendMessage(chatId, settingsText, {
          reply_markup: keyboards.settings_menu
        }));
      }
      break;

    case 'materials':
      bot.answerCallbackQuery(query.id);
      const materialsImagePath = path.join(__dirname, 'images', 'materials.jpg');
      const materialsText = '📂 Материалы\n\nЗдесь будут доступны обучающие материалы';

      if (fs.existsSync(materialsImagePath)) {
        replaceMenuMessage(chatId, messageId, bot.sendPhoto(chatId, materialsImagePath, {
          caption: materialsText
        }));
      } else {
        replaceMenuMessage(chatId, messageId, bot.sendMessage(chatId, materialsText));
      }
      break;

    case 'profile_settings':
      bot.answerCallbackQuery(query.id);
      db.get('SELECT profile_hidden FROM users WHERE user_id = ?', [userId], (err, user) => {
        if (err) {
          bot.answerCallbackQuery(query.id, { text: '❌ Ошибка', show_alert: true });
          return;
        }

        const settingsImagePath = path.join(__dirname, 'images', 'settings.jpg');
        const settingsText = '⚙️ Настройки профиля';

        if (fs.existsSync(settingsImagePath)) {
          replaceMenuMessage(chatId, messageId, bot.sendPhoto(chatId, settingsImagePath, {
            reply_markup: keyboards.profile_settings(user.profile_hidden)
          }));
        } else {
          replaceMenuMessage(chatId, messageId, bot.sendMessage(chatId, settingsText, {
            reply_markup: keyboards.profile_settings(user.profile_hidden)
          }));
        }
      });
      break;

    case 'change_name':
      bot.answerCallbackQuery(query.id);
      // Для ввода данных отправляем новое сообщение
      bot.sendMessage(chatId, '✍️Введите новый ник:');

      const nameListener = (msg) => {
        if (msg.chat.id !== chatId) return;
        if (!msg.text) return;

        bot.removeListener('message', nameListener);

        const newName = msg.text;

        if (!utils.validateWorkerName(newName)) {
          bot.sendMessage(chatId, '❌ Недопустимое имя. Используйте только русские/английские буквы, цифры, _, !, ?, $, ₽ (от 3 до 20 символов)');
          return;
        }

        db.run('UPDATE users SET name = ? WHERE user_id = ?', [`#${newName}`, userId], (err) => {
          if (err) {
            bot.sendMessage(chatId, '❌ Ошибка изменения имени');
          } else {
            getUser(userId, async (err, user) => {
              if (err || !user) {
                bot.sendMessage(chatId, '✅ Имя успешно изменено!');
                return;
              }

              utils.getTopPosition(userId, async (err, position) => {
                const topPosition = err ? 0 : position;

                bot.sendMessage(chatId, '✅ Имя успешно изменено!');
                await sendProfileMessage(chatId, user, topPosition);
              });
            });
          }
        });
      };

      bot.once('message', nameListener);
      break;

    case 'hide_profile':
      db.get('SELECT profile_hidden FROM users WHERE user_id = ?', [userId], (err, user) => {
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
            bot.editMessageReplyMarkup(keyboards.profile_settings(newState), {
              chat_id: chatId,
              message_id: messageId
            }).catch(() => {});
          }
        });
      });
      break;

    case 'transfer_profile':
      bot.answerCallbackQuery(query.id);
      // Для ввода данных отправляем новое сообщение
      bot.sendMessage(chatId, '📨Отправьте id или @ аккаунта с которого желаете перенести профиль:');

      const transferListener = (msg) => {
        if (msg.chat.id !== chatId) return;
        if (!msg.text) return;

        bot.removeListener('message', transferListener);

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
      };

      bot.once('message', transferListener);
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

        const withdrawText = `📨Создание заявки на выплату!
💸Сумма выплаты: ${user.balance.toLocaleString()}₽`;

        const withdrawKeyboard = {
          inline_keyboard: [
            [
              { text: '✅Создать', callback_data: `confirm_withdraw_${user.balance}` },
              { text: '❌Отменить', callback_data: 'cancel_withdraw' }
            ]
          ]
        };

        // Редактируем сообщение вместо отправки нового
        if (hasPhoto) {
          bot.editMessageCaption(withdrawText, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: withdrawKeyboard
          }).catch(() => {
            bot.sendMessage(chatId, withdrawText, { reply_markup: withdrawKeyboard });
          });
        } else {
          bot.editMessageText(withdrawText, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: withdrawKeyboard
          }).catch(() => {
            bot.sendMessage(chatId, withdrawText, { reply_markup: withdrawKeyboard });
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
              reply_markup: keyboards.profile
            }).catch(() => {});
          } else {
            bot.editMessageText(profileText, {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'HTML',
              reply_markup: keyboards.profile
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

    default:
      if (data.startsWith('confirm_withdraw_')) {
        bot.answerCallbackQuery(query.id);
        const amount = parseInt(data.replace('confirm_withdraw_', ''));

        getUser(userId, (err, user) => {
          if (err || !user) {
            bot.answerCallbackQuery(query.id, { text: '❌ Ошибка', show_alert: true });
            return;
          }

          // Создаем заявку на вывод
          db.run('INSERT INTO withdrawals (user_id, amount, status) VALUES (?, ?, ?)',
            [userId, amount, 'pending'],
            function(err) {
              if (err) {
                bot.answerCallbackQuery(query.id, { text: '❌ Ошибка создания заявки', show_alert: true });
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
              const adminText = `✅Новая заявка на выплату!
🌶Воркер: @${user.username || 'unknown'}
🪪Никнейм: ${user.name}
💌Сумма выплаты: ${amount.toLocaleString()}₽`;

              const adminKeyboard = {
                inline_keyboard: [
                  [{ text: 'Выплатить ✅', callback_data: `process_withdrawal_${withdrawalId}` }]
                ]
              };

              bot.sendMessage(PAYOUT_ADMIN_ID, adminText, { reply_markup: adminKeyboard })
                .then(() => {
                  // Редактируем сообщение вместо удаления и отправки нового
                  const successText = '✅ Заявка на выплату создана! Ожидайте обработки.';

                  if (hasPhoto) {
                    bot.editMessageCaption(successText, {
                      chat_id: chatId,
                      message_id: messageId
                    }).catch(() => {
                      bot.sendMessage(chatId, successText);
                    });
                  } else {
                    bot.editMessageText(successText, {
                      chat_id: chatId,
                      message_id: messageId
                    }).catch(() => {
                      bot.sendMessage(chatId, successText);
                    });
                  }
                })
                .catch((err) => {
                  console.error('Error sending to admin:', err);
                  bot.answerCallbackQuery(query.id, { text: '❌ Ошибка отправки заявки администратору', show_alert: true });
                });
            }
          );
        });
      }
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

  // Проверяем есть ли параметр (для просмотра профиля)
  const match = msg.text.match(/\/start\s+profile_(\d+)/);

  if (match) {
    const targetUserId = parseInt(match[1]);

    db.get('SELECT * FROM users WHERE user_id = ?', [targetUserId], (err, user) => {
      if (err || !user) {
        bot.sendMessage(chatId, '❌ Профиль не найден');
        return;
      }

      if (user.profile_hidden) {
        bot.sendMessage(chatId, '❌Пользователь скрыл профиль');
        return;
      }

      utils.getTopPosition(targetUserId, (err, position) => {
        const topPosition = err ? 0 : position;

        const profileText = formatProfile(user, topPosition);

        bot.sendMessage(chatId, profileText, { parse_mode: 'HTML' });
      });
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

    const applicationFormText = `🏠 <b>Для вступления в AXE TEAM тебе нужно подать заявку, ответив на пару вопросов.</b>`;

    const sendApplicationForm = () => {
      bot.sendMessage(chatId, applicationFormText, {
        parse_mode: 'HTML',
        reply_markup: keyboards.application_start
      });
    };

    const runStartFlow = () => {
      const handleApplicationState = (application) => {
        if (application && application.status === 'pending') {
          bot.sendMessage(chatId, '⏳ Ваша заявка находится на рассмотрении. Пожалуйста, ожидайте.');
          return;
        }

        if (application && application.status === 'approved' && !hasFullAccess(user)) {
          bot.sendMessage(
            chatId,
            `🍌 <b>Для полного использования проекта необходимо быть участником основных каналов связи.</b>`,
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
          sendInfoPanel(chatId).catch((err) => {
            console.error('/start info failed:', telegramErrorSummary(err));
            bot.sendMessage(chatId, '❌ Ошибка загрузки. Нажми /start ещё раз.').catch(() => {});
          });
          return;
        }

        sendApplicationForm();
      };

      if (!user) {
        createUser(userId, username);
        sendApplicationForm();
        return;
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

// Команда для публикации профита: username сумма направление (для всех пользователей)
bot.onText(/^([^\s]+)\s+(\d+)₽?\s+([12])$/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const workerUsername = match[1].replace(/^\/+/, '').replace(/@.+$/, '');
  const amount = parseInt(match[2]);
  const direction = parseInt(match[3]);

  if (!workerUsername || !amount || ![1, 2].includes(direction)) {
    bot.sendMessage(chatId, '❌ Неверный формат. Используйте: username сумма направление\nПример: richvladwork 10000 1');
    return;
  }

  // Ищем воркера в базе
  db.get('SELECT * FROM users WHERE username = ?', [workerUsername], (err, user) => {
    let workerData;

    if (err || !user) {
      // Если воркер не найден в базе - создаем временные данные
      workerData = {
        user_id: 0, // Временный ID
        username: workerUsername,
        name: `#${workerUsername}`
      };
    } else {
      workerData = user;
    }

    // Рассчитываем суммы
    const workerPayout = utils.calculateWorkerPayout(amount, direction);
    const shares = utils.calculateProfitShares(amount);
    const directionName = utils.getDirectionName(direction);
    const directionPercent = utils.DIRECTION_PERCENTAGES[direction];

    // Сохраняем данные для подтверждения
    const profitId = `${workerData.user_id}_${Date.now()}`;
    profitData[profitId] = {
      userId: workerData.user_id,
      username: workerData.username,
      name: workerData.name,
      amount: amount,
      workerPayout: workerPayout,
      direction: direction,
      directionName: directionName,
      shares: shares,
      curator: user ? user.curator : null, // Добавляем куратора
      isRegistered: !!user // Флаг - зарегистрирован ли воркер
    };

    // Формируем сообщение для бухгалтерии
    const accountingText = `<b>🚀${directionName}
👤Воркер: @${workerData.username}
💸Сумма профита: ${amount.toLocaleString()}₽
💼К выплате: ${workerPayout.toLocaleString()}₽ (${directionPercent}%)
👑Владелец: ${shares.owner.toLocaleString()}₽
👔Администратор: ${shares.admin.toLocaleString()}₽
🍌Инвестор: ${shares.investor.toLocaleString()}₽
🧑‍💻Кодер: ${shares.coder.toLocaleString()}₽</b>`;

    const keyboard = {
      inline_keyboard: [
        [{ text: '✅Отправить', callback_data: `send_profit_accounting_${profitId}` }]
      ]
    };

    bot.sendMessage(chatId, accountingText, { parse_mode: 'HTML', reply_markup: keyboard });
  });
  return true; // Предотвращаем дальнейшую обработку
});

// Команда для отправки профита в личку: /name сумма кол-во (например /richvladwork 5000 1)
bot.onText(/^\/([^\s]+)\s+(\d+)\s+(\d+)$/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const workerName = match[1];
  const amount = parseInt(match[2]);
  const profitCount = parseInt(match[3]);

  if (!workerName || !amount || !profitCount) {
    bot.sendMessage(chatId, '❌ Неверный формат. Используйте: /name сумма кол-во\nПример: /richvladwork 5000 1');
    return;
  }

  const searchUsername = workerName.toLowerCase();

  db.get('SELECT * FROM users WHERE LOWER(username) = ?', [searchUsername], (err, user) => {
    if (err || !user) {
      bot.sendMessage(chatId, `❌ Пользователь @${workerName} не найден`);
      return;
    }

    const direction = 1;
    const workerPayout = utils.calculateWorkerPayout(amount, direction);
    const shares = utils.calculateProfitShares(amount);

    // Сохраняем профит в БД
    db.run('INSERT INTO profits (user_id, amount, amount_to_pay, direction) VALUES (?, ?, ?, ?)',
      [user.user_id, amount, workerPayout, direction],
      function(err) {
        if (err) {
          console.error('Error saving profit:', err);
          bot.sendMessage(chatId, '❌ Ошибка сохранения профита');
          return;
        }

        const dbProfitId = this.lastID;

        for (const [role, shareAmount] of Object.entries(shares)) {
          db.run('INSERT OR IGNORE INTO profit_shares (profit_id, role, percentage, amount) VALUES (?, ?, ?, ?)',
            [dbProfitId, role, utils.PROFIT_SHARES[role], shareAmount]
          );
        }

        db.run(`UPDATE users SET
          balance = balance + ?,
          total_earned = total_earned + ?,
          profit_count = profit_count + 1
          WHERE user_id = ?`,
          [workerPayout, amount, user.user_id],
          (err) => {
            if (err) {
              console.error('Error updating user:', err);
            } else {
              utils.updateWorkerStatus(user.user_id, (err) => {
                if (err) console.error('Error updating status:', err);
              });
            }
          }
        );

        utils.updateProjectStats(amount, (err) => {
          if (err) console.error('Error updating project stats:', err);
          else {
            updatePinnedMessage(bot, GENERAL_CHAT_ID).catch((pinErr) =>
              console.error('Error updating pinned after profit:', pinErr)
            );
          }
        });
      }
    );

    const currentStatus = user.status || 'NEW';
    const currentTotal = user.total_earned || 0;

    const nextThreshold = utils.STATUS_THRESHOLDS.find(t => t.threshold > currentTotal);
    const nextLevelAmount = nextThreshold ? nextThreshold.threshold : null;

    let nextLevelText = '';
    if (nextLevelAmount) {
      const remaining = nextLevelAmount - currentTotal;
      nextLevelText = `До нового уровня ${nextLevelAmount.toLocaleString()}₽`;
    } else {
      nextLevelText = 'Максимальный уровень достигнут';
    }

    const profitMessage = `🎉<b>Успешный профит </b>🎉

┏ 🏠<b>Сервис: Кардинг
</b>┣ 🏦<b>На сумму: ${amount.toLocaleString()}₽
┣ 🔥Кол-во профитов: ${profitCount}
┣ 💼Твой статус: ${currentStatus}
┗ 🍾${nextLevelText} </b>

⚠️<i>Подать заявку на выплату можно в профиле. Напоминаем период выплаты каждые 3 часа.</i>`;

    bot.sendMessage(user.user_id, profitMessage, { parse_mode: 'HTML' })
      .then(() => {
        bot.sendMessage(chatId, `✅ Профит отправлен пользователю ${user.name}!\n💸 Сумма: ${amount.toLocaleString()}₽\n🔥 Кол-во профитов: ${profitCount}`);
      })
      .catch((err) => {
        console.error('Error sending profit to user:', err);
        bot.sendMessage(chatId, `❌ Не удалось отправить сообщение пользователю. Возможно, он не начинал диалог с ботом.`);
      });
  });
  return true;
});

// Обработка кнопок клавиатуры
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  const username = msg.from.username || '';

  // Обновляем username пользователя при каждом сообщении
  updateUsername(userId, username);

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

      // Функция для отправки сообщения с задержкой
      const sendWithDelay = async (user, index) => {
        return new Promise((resolve) => {
          setTimeout(async () => {
            try {
              // Определяем тип сообщения и отправляем соответствующим методом
              if (msg.photo) {
                const photo = msg.photo[msg.photo.length - 1].file_id;
                await bot.sendPhoto(user.user_id, photo, { caption: msg.caption, parse_mode: 'HTML' });
              } else if (msg.video) {
                await bot.sendVideo(user.user_id, msg.video.file_id, { caption: msg.caption, parse_mode: 'HTML' });
              } else if (msg.document) {
                await bot.sendDocument(user.user_id, msg.document.file_id, { caption: msg.caption, parse_mode: 'HTML' });
              } else if (msg.sticker) {
                await bot.sendSticker(user.user_id, msg.sticker.file_id);
              } else if (msg.text) {
                await bot.sendMessage(user.user_id, msg.text, { parse_mode: 'HTML' });
              }
              successCount++;
            } catch (error) {
              console.error(`Failed to send to user ${user.user_id}:`, error.message);
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
• Не доставлено: ${failCount}`;

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
      sendInfoPanel(chatId).catch((err) => {
        console.error('Error sending info panel:', err);
        bot.sendMessage(chatId, '❌ Ошибка получения информации');
      });
      return;
    } else if (text === '🦋Меню🦋') {
      const imagePath = path.join(__dirname, 'images', 'info.jpg');

      if (fs.existsSync(imagePath)) {
        bot.sendPhoto(chatId, imagePath, {
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
});

// Обработка callback кнопок (единый обработчик)
bot.on('callback_query', (query) => {
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

  const adminProfitAction = data.startsWith('send_all_') || data.startsWith('send_accounting_') || data.startsWith('send_public_');
  if (adminProfitAction && !adminIds.includes(userId)) {
    bot.answerCallbackQuery(query.id, { text: '❌ У вас нет прав на это действие' });
    return;
  }

  // Обработка profit system
  if (data.startsWith('send_profit_accounting_') || (data.startsWith('send_profit_') && !data.startsWith('send_profit_accounting_'))) {
      const profitId = data.startsWith('send_profit_accounting_') ? data.replace('send_profit_accounting_', '') : data.replace('send_profit_', '');
      const profit = profitData[profitId];

      if (!profit) {
        bot.answerCallbackQuery(query.id, { text: '❌ Данные профита не найдены' });
        return;
      }

      bot.answerCallbackQuery(query.id);

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

            db.run(`UPDATE users SET
              balance = balance + ?,
              total_earned = total_earned + ?,
              profit_count = profit_count + 1
              WHERE user_id = ?`,
              [profit.workerPayout, profit.amount, profit.userId],
              (err) => {
                if (err) {
                  console.error('Error updating user:', err);
                } else {
                  console.log(`✅ Updated balance for user ${profit.userId}: +${profit.workerPayout}₽`);
                  utils.updateWorkerStatus(profit.userId, (err) => {
                    if (err) console.error('Error updating status:', err);
                  });
                }
              }
            );

            // Обновляем статистику проекта и закреп после сохранения профита в БД
            utils.updateProjectStats(profit.amount, (err) => {
              if (err) console.error('Error updating project stats:', err);
              else {
                updatePinnedMessage(bot, GENERAL_CHAT_ID).catch((pinErr) =>
                  console.error('Error updating pinned after profit:', pinErr)
                );
              }
            });
          }
        );
      };

      if (profit.isRegistered && profit.userId !== 0) {
        saveProfitAndUpdateUser(profit.userId);
      } else {
        db.get('SELECT user_id FROM users WHERE username = ?', [profit.username], (err, existingUser) => {
          if (existingUser) {
            saveProfitAndUpdateUser(existingUser.user_id);
          } else {
            utils.generateWorkerNumber((err, workerNumber) => {
              if (err) {
                console.error('Error generating worker number:', err);
                return;
              }
              const newUserId = Date.now() + Math.floor(Math.random() * 10000);
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
            });
          }
        });
      }

      let combinedText = `<b>📊 БУХГАЛТЕРИЯ:</b>
🚀${profit.directionName}
👤Воркер: @${profit.username}
💸Сумма профита: ${profit.amount.toLocaleString()}₽
💼К выплате: ${profit.workerPayout.toLocaleString()}₽
👑Владелец: ${profit.shares.owner.toLocaleString()}₽
👔Администратор: ${profit.shares.admin.toLocaleString()}₽
🍌Инвестор: ${profit.shares.investor.toLocaleString()}₽
🧑‍💻Кодер: ${profit.shares.coder.toLocaleString()}₽

━━━━━━━━━━━━━━━━━━━━

<b>🌸 КАССА/ЧАТ:</b>
<b>🌸УСПЕШНЫЙ ПРОФИТ🌸

🏠Сервис: ${profit.directionName}
┣👤Воркер: ${profit.name}`;

      if (profit.direction === 1 && profit.curator) {
        combinedText += `\n┣💸Сумма: ${utils.formatAmount(profit.amount)}₽\n┗👨‍🏫Куратор: @${profit.curator}</b>`;
      } else {
        combinedText += `\n┗💸Сумма: ${utils.formatAmount(profit.amount)}₽</b>`;
      }

      const combinedKeyboard = {
        inline_keyboard: [
          [{ text: '📊 Отправить в бухгалтерию', callback_data: `send_accounting_${profitId}` }],
          [{ text: '🌸 Отправить в кассу/чат', callback_data: `send_public_${profitId}` }],
          [{ text: '✅ Отправить везде', callback_data: `send_all_${profitId}` }]
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
      return;
    }

    if (adminIds.includes(userId)) {
      if (data.startsWith('send_all_')) {
      const profitId = data.replace('send_all_', '');
      const profit = profitData[profitId];

      if (!profit) {
        bot.answerCallbackQuery(query.id, { text: '❌ Данные профита не найдены' });
        return;
      }

      bot.answerCallbackQuery(query.id);

      // Отправляем в бухгалтерию
      const accountingText = `<b>🚀${profit.directionName}
👤Воркер: @${profit.username}
💸Сумма профита: ${profit.amount.toLocaleString()}₽
💼К выплате: ${profit.workerPayout.toLocaleString()}₽
👑Владелец: ${profit.shares.owner.toLocaleString()}₽
👔Администратор: ${profit.shares.admin.toLocaleString()}₽
🍌Инвестор: ${profit.shares.investor.toLocaleString()}₽
🧑‍💻Кодер: ${profit.shares.coder.toLocaleString()}₽</b>`;

      bot.sendMessage(ACCOUNTING_CHAT_ID, accountingText, { parse_mode: 'HTML' }).catch((err) => {
        console.error('Error sending to accounting:', err);
      });

      // Отправляем в общую кассу и чат
      let publicText = `<b>🌸УСПЕШНЫЙ ПРОФИТ🌸

🏠Сервис: ${profit.directionName}
┣👤Воркер: ${profit.name}`;

      // Добавляем куратора, если он есть и направление = 1 (Кардинг)
      if (profit.direction === 1 && profit.curator) {
        publicText += `\n┣💸Сумма: ${utils.formatAmount(profit.amount)}₽\n┗👨‍🏫Куратор: @${profit.curator}</b>`;
      } else {
        publicText += `\n┗💸Сумма: ${utils.formatAmount(profit.amount)}₽</b>`;
      }

      bot.sendMessage(CASH_CHANNEL_ID, publicText, { parse_mode: 'HTML' }).catch((err) => {
        console.error('Error sending to cash channel:', err);
      });

      bot.sendMessage(GENERAL_CHAT_ID, publicText, { parse_mode: 'HTML' }).catch((err) => {
        console.error('Error sending to general chat:', err);
      });

      updatePinnedMessage(bot, GENERAL_CHAT_ID).catch((err) =>
        console.error('Error updating pinned after send_all:', err)
      );

      // Удаляем данные профита
      delete profitData[profitId];

      bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
      bot.sendMessage(chatId, '✅ Профит отправлен везде!');
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

      const accountingText = `<b>🚀${profit.directionName}
👤Воркер: @${profit.username}
💸Сумма профита: ${profit.amount.toLocaleString()}₽
💼К выплате: ${profit.workerPayout.toLocaleString()}₽
👑Владелец: ${profit.shares.owner.toLocaleString()}₽
👔Администратор: ${profit.shares.admin.toLocaleString()}₽
🍌Инвестор: ${profit.shares.investor.toLocaleString()}₽
🧑‍💻Кодер: ${profit.shares.coder.toLocaleString()}₽</b>`;

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

      let publicText = `<b>🌸УСПЕШНЫЙ ПРОФИТ🌸

🏠Сервис: ${profit.directionName}
┣👤Воркер: ${profit.name}`;

      // Добавляем куратора, если он есть и направление = 1 (Кардинг)
      if (profit.direction === 1 && profit.curator) {
        publicText += `\n┣💸Сумма: ${utils.formatAmount(profit.amount)}₽\n┗👨‍🏫Куратор: @${profit.curator}</b>`;
      } else {
        publicText += `\n┗💸Сумма: ${utils.formatAmount(profit.amount)}₽</b>`;
      }

      // Отправляем в общую кассу
      bot.sendMessage(CASH_CHANNEL_ID, publicText, { parse_mode: 'HTML' }).catch((err) => {
        console.error('Error sending to cash channel:', err);
      });

      // Отправляем в общий чат
      bot.sendMessage(GENERAL_CHAT_ID, publicText, { parse_mode: 'HTML' }).catch((err) => {
        console.error('Error sending to general chat:', err);
      });

      // Обновляем закрепленное сообщение
      updatePinnedMessage(bot, GENERAL_CHAT_ID).catch((err) =>
        console.error('Error updating pinned after send_public:', err)
      );

      // Удаляем данные профита
      delete profitData[profitId];

      bot.sendMessage(chatId, '✅ Профит опубликован!');
      bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
      return;
    }
  }

  // Обработка начала заявки
  if (data === 'start_application') {
    bot.answerCallbackQuery(query.id);
    bot.deleteMessage(chatId, query.message.message_id).catch(() => {});

    applicationData[userId] = { step: 1 };

    bot.sendMessage(chatId, '<b>Вопрос №1:</b>\n<i>Занимался ли ты подобной деятельностью?</i>', { parse_mode: 'HTML' });

    const question1Listener = (msg) => {
      if (msg.chat.id !== chatId) return;
      if (msg.from.id !== userId) return; // Проверяем что это тот же пользователь
      if (!msg.text || msg.text.startsWith('/')) return;

      bot.removeListener('message', question1Listener);

      applicationData[userId].question1 = msg.text;
      applicationData[userId].step = 2;

      bot.sendMessage(chatId, '<b>Вопрос №2:</b>\n<i>Если твой ответ на прошлый вопрос (да), то расскажи каков твой опыт, чем занимался?</i>', { parse_mode: 'HTML' });

      const question2Listener = (msg) => {
        if (msg.chat.id !== chatId) return;
        if (msg.from.id !== userId) return; // Проверяем что это тот же пользователь
        if (!msg.text || msg.text.startsWith('/')) return;

        bot.removeListener('message', question2Listener);

        applicationData[userId].question2 = msg.text;

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

            bot.sendMessage(chatId, '<b>📨 Твоя заявка отправлена на рассмотрение!</b>', { parse_mode: 'HTML' });

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
      };

      bot.once('message', question2Listener);
    };

    bot.once('message', question1Listener);
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
          bot.sendMessage(chatId, `✅ Заявка от @${application.username} одобрена`);

          // Отправляем пользователю правила
          const rulesText = `<b>Поздравляем! 🥂</b>

💌 <i>Твоя заявка принята, осталось ознакомиться с правилами проекта</i> <b><i>AXE TEAM.</i></b>

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
          bot.sendMessage(chatId, `❌ Заявка от @${application.username} отклонена`);

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

    const subscriptionText = `🍌 <b>Для полного использования проекта необходимо быть участником основных каналов связи.</b>`;

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

              let errorMsg = '❌ Вы не подписаны на:\n';
              if (!chatStatus) errorMsg += '• AXE | CHAT💬\n';
              if (!channelStatus) errorMsg += '• AXE | NEWS🦋\n';
              errorMsg += '\nПожалуйста, подпишитесь и попробуйте снова.';

              bot.sendMessage(chatId, errorMsg);
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

  // Обработка подтверждения вывода
  if (data.startsWith('confirm_withdraw_')) {
    bot.answerCallbackQuery(query.id);
    const amount = parseInt(data.replace('confirm_withdraw_', ''));

    getUser(userId, (err, user) => {
      if (err || !user) {
        bot.sendMessage(chatId, '❌ Ошибка');
        return;
      }

      // Создаем заявку на вывод
      db.run('INSERT INTO withdrawals (user_id, amount, status) VALUES (?, ?, ?)',
        [userId, amount, 'pending'],
        function(err) {
          if (err) {
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
          const adminText = `✅Новая заявка на выплату!
🌶Воркер: @${user.username || 'unknown'}
🪪Никнейм: ${user.name}
💌Сумма выплаты: ${amount.toLocaleString()}₽`;

          const adminKeyboard = {
            inline_keyboard: [
              [{ text: 'Выплатить ✅', callback_data: `process_withdrawal_${withdrawalId}` }]
            ]
          };

          bot.sendMessage(PAYOUT_ADMIN_ID, adminText, { reply_markup: adminKeyboard })
            .then(() => {
              bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
              bot.sendMessage(chatId, '✅ Заявка на выплату создана! Ожидайте обработки.');
            })
            .catch((err) => {
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

        const checkText = `📥Отправьте чек на сумму: ${withdrawal.amount.toLocaleString()}₽`;
        const cancelKeyboard = {
          inline_keyboard: [
            [{ text: '❌Отменить', callback_data: `cancel_withdrawal_${withdrawalId}` }]
          ]
        };

        bot.sendMessage(chatId, checkText, { reply_markup: cancelKeyboard });

        // Ждем чек от админа
        const checkListener = (msg) => {
          if (msg.chat.id !== chatId) return;
          if (!msg.text && !msg.caption) return;

          bot.removeListener('message', checkListener);

          const checkMessage = msg.text || msg.caption || 'Чек получен';

          // Сохраняем чек
          db.run('UPDATE withdrawals SET check_message = ? WHERE id = ?', [checkMessage, withdrawalId], (err) => {
            if (err) {
              console.error('Error saving check:', err);
            }
          });

          // Отправляем подтверждение
          const confirmText = `✅Выплата!
🌶Воркер: @${withdrawal.username || 'unknown'}
🪪Никнейм: ${withdrawal.name}
💌Сумма выплаты: ${withdrawal.amount.toLocaleString()}₽
Чек: ${checkMessage}`;

          const confirmKeyboard = {
            inline_keyboard: [
              [
                { text: '✅Подтвердить', callback_data: `confirm_payout_${withdrawalId}` },
                { text: '❌Отменить', callback_data: `cancel_withdrawal_${withdrawalId}` }
              ]
            ]
          };

          bot.sendMessage(chatId, confirmText, { reply_markup: confirmKeyboard });
        };

        bot.once('message', checkListener);
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
💼Сумма к выплате: ${withdrawal.amount.toLocaleString()}₽
⚙Способ выплаты @send
${withdrawal.check_message || ''}`;

            bot.sendMessage(withdrawal.user_id, workerText).catch((err) => {
              console.error('Error notifying worker:', err);
            });
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

      const addCardListener = (msg) => {
        if (msg.chat.id !== chatId) return;
        if (!msg.text) return;

        bot.removeListener('message', addCardListener);

        const cardInfo = msg.text;
        db.run('INSERT INTO cards (card_info) VALUES (?)', [cardInfo], (err) => {
          if (err) {
            bot.sendMessage(chatId, '❌ Ошибка добавления');
          } else {
            bot.sendMessage(chatId, '✅ Реквизит добавлен!');
          }
        });
      };

      bot.once('message', addCardListener);
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

        const deleteCardListener = (msg) => {
          if (msg.chat.id !== chatId) return;
          if (!msg.text) return;

          bot.removeListener('message', deleteCardListener);

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
        };

        bot.once('message', deleteCardListener);
      });
      return;
    }
  }

  // Обработка остальных callback
  // Проверяем одобрена ли заявка для доступа к основному функционалу
  const protectedCallbacks = ['profile', 'work', 'training', 'card', 'community', 'feedback', 'settings',
                               'materials', 'profile_settings', 'change_name', 'hide_profile',
                               'transfer_profile', 'withdraw', 'cancel_withdraw', 'back_to_menu',
                               'show_mentor', 'assign_mentor'];

  if (protectedCallbacks.includes(data) || data.startsWith('confirm_withdraw_')) {
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

      const addCardListener = (msg) => {
        if (msg.chat.id !== chatId) return;
        if (!msg.text) return;

        bot.removeListener('message', addCardListener);

        const cardInfo = msg.text;
        db.run('INSERT INTO cards (card_info) VALUES (?)', [cardInfo], (err) => {
          if (err) {
            bot.sendMessage(chatId, '❌ Ошибка добавления');
          } else {
            bot.sendMessage(chatId, '✅ Реквизит добавлен!');
          }
        });
      };

      bot.once('message', addCardListener);
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

        const deleteCardListener = (msg) => {
          if (msg.chat.id !== chatId) return;
          if (!msg.text) return;

          bot.removeListener('message', deleteCardListener);

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
        };

        bot.once('message', deleteCardListener);
      });
      return;
    }
  }

  // Обработка неизвестных callback
  bot.answerCallbackQuery(query.id);
});

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

// Команда /staff
bot.onText(/\/staff/, (msg) => {
  const chatId = msg.chat.id;
  const staffText = `🦺<b>Personnel - AXE TEAM</b>

🗣<b>Feedback</b>
┗@FeedbackAXEbot

🕵‍♂️<b>Саппорт</b>
┗ @Deryl_AXE

👨‍🏫<b>Куратор</b>
┗ @Henry_AXE

👁<b>Модератор</b>
┗ @Aether_AXE`;

  bot.sendMessage(chatId, staffText, { parse_mode: 'HTML', disable_web_page_preview: true }).catch(err => {
    console.error('Error sending staff message:', err);
  });
});

// Команда /top - Топ 10 за все время
bot.onText(/\/(top|топ)(?:@[\w_]+)?(?:\s|$)/, (msg) => {
  const chatId = msg.chat.id;

  db.all(`SELECT u.*, SUM(p.amount) as total_profit
          FROM users u
          JOIN profits p ON u.user_id = p.user_id
          WHERE u.profile_hidden = 0
            AND ${utils.topExclusionWhere('u')}
          GROUP BY u.user_id
          HAVING total_profit > 0
          ORDER BY total_profit DESC, u.user_id ASC
          LIMIT 10`, (err, users) => {
    if (err || !users || users.length === 0) {
      bot.sendMessage(chatId, '📊 Топ пуст').catch(err => {
        console.error('Error sending top message:', err);
      });
      return;
    }

    const medals = ['🏆', '🥈', '🥉', '🎯', '🍺', '🎭', '💣', '🦁', '🦄', '🧸'];
    let topText = '🏆<b>Топ 10</b>\n\n';

    users.forEach((user, index) => {
      const medal = medals[index];
      const profileLink = `https://t.me/${process.env.BOT_USERNAME || 'AXE_xBOT'}?start=profile_${user.user_id}`;
      topText += `${medal}: <a href="${profileLink}">${user.name}</a> - ${user.total_profit.toLocaleString()}₽\n`;
    });

    bot.sendMessage(chatId, topText, { parse_mode: 'HTML', disable_web_page_preview: true }).catch(err => {
      console.error('Error sending top message:', err);
    });
  });
});

// Команда /topd - Топ 10 за сутки
bot.onText(/\/(topd|топд)(?:@[\w_]+)?(?:\s|$)/, (msg) => {
  const chatId = msg.chat.id;

  db.all(`SELECT u.user_id, u.username, u.name, u.profile_hidden, SUM(p.amount) as daily_total
          FROM profits p
          JOIN users u ON p.user_id = u.user_id
          WHERE DATE(p.created_at, 'localtime') = DATE('now', 'localtime')
            AND ${utils.topExclusionWhere('u')}
          GROUP BY p.user_id
          ORDER BY daily_total DESC
          LIMIT 10`, (err, results) => {
    if (err || !results || results.length === 0) {
      bot.sendMessage(chatId, '📊 Топ дня пуст').catch(err => {
        console.error('Error sending topd message:', err);
      });
      return;
    }

    const medals = ['🎖', '🥈', '🥉', '4', '5', '6', '7', '8', '9', '🍺'];
    let topText = '🌶<b>Топ 10 за сутки.</b>\n\n';

    results.forEach((user, index) => {
      const medal = medals[index];
      const profileLink = `https://t.me/${process.env.BOT_USERNAME || 'AXE_xBOT'}?start=profile_${user.user_id}`;

      if (user.profile_hidden) {
        topText += `${medal}: ${user.name} - ${user.daily_total.toLocaleString()}₽\n`;
      } else {
        topText += `${medal}: <a href="${profileLink}">${user.name}</a> - ${user.daily_total.toLocaleString()}₽\n`;
      }
    });

    bot.sendMessage(chatId, topText, { parse_mode: 'HTML', disable_web_page_preview: true }).catch(err => {
      console.error('Error sending topd message:', err);
    });
  });
});

// Команда /topm - Топ 10 за месяц
bot.onText(/\/(topm|топм)(?:@[\w_]+)?(?:\s|$)/, (msg) => {
  const chatId = msg.chat.id;

  db.all(`SELECT u.user_id, u.username, u.name, u.profile_hidden, SUM(p.amount) as monthly_total
          FROM profits p
          JOIN users u ON p.user_id = u.user_id
          WHERE strftime('%Y-%m', p.created_at, 'localtime') = strftime('%Y-%m', 'now', 'localtime')
            AND ${utils.topExclusionWhere('u')}
          GROUP BY p.user_id
          ORDER BY monthly_total DESC
          LIMIT 10`, (err, results) => {
    if (err || !results || results.length === 0) {
      bot.sendMessage(chatId, '📊 Топ месяца пуст').catch(err => {
        console.error('Error sending topm message:', err);
      });
      return;
    }

    const medals = ['🎖', '🥈', '🥉', '4', '5', '6', '7', '8', '9', '10'];
    let topText = '📆<b>Топ 10 за месяц</b>\n\n';

    results.forEach((user, index) => {
      const medal = medals[index];
      const profileLink = `https://t.me/${process.env.BOT_USERNAME || 'AXE_xBOT'}?start=profile_${user.user_id}`;

      if (user.profile_hidden) {
        topText += `${medal}: ${user.name} - ${user.monthly_total.toLocaleString()}₽\n`;
      } else {
        topText += `${medal}: <a href="${profileLink}">${user.name}</a> - ${user.monthly_total.toLocaleString()}₽\n`;
      }
    });

    bot.sendMessage(chatId, topText, { parse_mode: 'HTML', disable_web_page_preview: true }).catch(err => {
      console.error('Error sending topm message:', err);
    });
  });
});

// Команда /materials
bot.onText(/\/materials/, (msg) => {
  const chatId = msg.chat.id;

  const materialsKeyboard = {
    inline_keyboard: [
      [{ text: '📂 Материалы', url: 'https://t.me/+GMixQrZvJkQ4ODE6' }]
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
      [{ text: '➕ Добавить реквизит', callback_data: 'admin_add_card' }],
      [{ text: '➖ Удалить реквизит', callback_data: 'admin_delete_card' }]
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
      [{ text: '➕ Создать реквизит', callback_data: 'card_create' }],
      [{ text: '🗑 Удалить реквизит', callback_data: 'card_delete' }],
      [{ text: '✏️ Изменить реквизит', callback_data: 'card_edit' }]
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
