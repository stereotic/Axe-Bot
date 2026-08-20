const battlepass = require('./battlepass');

const GENERAL_CHAT_ID = '-1003986505552';

// Генерация номера билета вида #Hd1001 — уникальный в таблице tickets
function generateTicketNumber(db, callback) {
  const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const pick = (n, set) => {
    let s = '';
    for (let i = 0; i < n; i++) s += set[Math.floor(Math.random() * set.length)];
    return s;
  };
  const candidate = () => `#${pick(2 + (Math.random() < 0.5 ? 1 : 0), letters)}${pick(4, '0123456789')}`;

  const tryGen = (attempt) => {
    if (attempt > 15) return callback(new Error('Не удалось сгенерировать уникальный номер билета'));
    const num = candidate();
    db.get('SELECT id FROM tickets WHERE ticket_number = ?', [num], (err, row) => {
      if (err) return callback(err);
      if (row) return tryGen(attempt + 1);
      callback(null, num);
    });
  };
  tryGen(0);
}

// Текст сообщения о подарке в общий чат (для уровня lvl).
function giftChatText(workerUsername, workerName, lvl) {
  const prize = battlepass.LEVELS[lvl - 1];
  if (!prize) return null;
  const chatName = workerName && workerName !== '#' ? workerName : (workerUsername ? `#${workerUsername}` : '#');
  return `<b><tg-emoji emoji-id="5444984118519573636">🎁</tg-emoji>Новый подарок у ${chatName}\n` +
    `<tg-emoji emoji-id="5451737714074364923">🎁</tg-emoji>Уровень PASS: ${lvl}\n` +
    `<tg-emoji emoji-id="5445350075502997104">🎁</tg-emoji>Подарок: ${prize.title}</b>`;
}

// Уведомление о подарке за ОДИН уровень пасса (общий чат, билет, админы).
function sendLevelGift(bot, db, adminIds, workerId, workerUsername, workerName, lvl) {
  const prize = battlepass.LEVELS[lvl - 1];
  if (!prize) return;

  const mention = workerUsername ? `@${workerUsername}` : (workerName || 'без имени');
  const chatName = workerName && workerName !== '#' ? workerName : (workerUsername ? `#${workerUsername}` : '#');
  bot.sendMessage(GENERAL_CHAT_ID, giftChatText(workerUsername, workerName, lvl), { parse_mode: 'HTML' })
    .catch(() => console.error('Error sending gift to general chat:'));

  if (prize.ticketName) {
    generateTicketNumber(db, (err, ticket) => {
      if (err) {
        console.error('Error generating ticket:', err);
        return;
      }
      db.run(
        'INSERT INTO tickets (user_id, username, prize_level, prize_title, ticket_number) VALUES (?, ?, ?, ?, ?)',
        [workerId, workerUsername || null, lvl, prize.title, ticket],
        (dbErr) => { if (dbErr) console.error('Error saving ticket:', dbErr); }
      );

      bot.sendMessage(workerId,
        `<tg-emoji emoji-id="5994502837327892086">🎉</tg-emoji>Поздравляем \n` +
        `<tg-emoji emoji-id="5963213811597970978">🎟️</tg-emoji>Ты получил билет на розыгрыш: ${prize.ticketName} <tg-emoji emoji-id="5190855056848615312">🎁</tg-emoji>\n\n` +
        `<tg-emoji emoji-id="5987917196469213507">🎫</tg-emoji>Номер билета: ${ticket}`,
        { parse_mode: 'HTML' }).catch(() => {});

      adminIds.forEach((adminId) => {
        bot.sendMessage(adminId,
          `<b>${mention}</b> получил билет на розыгрыш: <b>${prize.ticketName}</b>\nНомер билета: ${ticket}`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      });
    });
  } else {
    const workerTag = workerName && workerName !== '#' ? workerName : (workerUsername ? `@${workerUsername}` : 'без имени');
    adminIds.forEach((adminId) => {
      bot.sendMessage(adminId,
        `<b>${workerTag}</b> получил новую награду: <b>${prize.title}</b>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    });
  }
}

// Уведомления о призах при переходе на новые уровни пасса.
// Старый/новый прогресс передаются как { totalEarned, xp } — как в buildState.
function sendPrizeNotifications(bot, db, adminIds, workerId, workerUsername, workerName, oldPass, newPass) {
  const oldLevel = battlepass.buildState(oldPass.totalEarned, oldPass.xp).level;
  const newLevel = battlepass.buildState(newPass.totalEarned, newPass.xp).level;
  if (newLevel <= oldLevel) return;

  for (let lvl = oldLevel + 1; lvl <= newLevel; lvl++) {
    sendLevelGift(bot, db, adminIds, workerId, workerUsername, workerName, lvl);
  }
}

module.exports = { sendPrizeNotifications, sendLevelGift, generateTicketNumber, giftChatText };