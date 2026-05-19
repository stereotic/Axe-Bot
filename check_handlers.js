const cardSystem = require('./card_system');
const utils = require('./utils');

// Обработчики системы проверки чеков
function setupCheckHandlers(bot, adminIds, GENERAL_CHAT_ID, ACCOUNTING_CHAT_ID, CASH_CHANNEL_ID) {

  // Обработка кнопки "Отправить чек"
  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    // Начало отправки чека
    if (data.startsWith('check_submit_')) {
      bot.answerCallbackQuery(query.id);

      const cardId = parseInt(data.replace('check_submit_', ''));

      cardSystem.checkSubmissionState[userId] = {
        step: 'file',
        card_id: cardId
      };

      bot.sendMessage(chatId, '📸 <b>Отправьте фото чека или файл в формате PDF:</b>', {
        parse_mode: 'HTML'
      });
    }

    // Админ переводит чек на проверку
    if (data.startsWith('check_verify_') && adminIds.includes(userId)) {
      bot.answerCallbackQuery(query.id);

      const checkId = parseInt(data.replace('check_verify_', ''));

      cardSystem.updateCheckStatus(checkId, 'checking', query.message.message_id, (err) => {
        if (err) {
          bot.sendMessage(chatId, '❌ Ошибка обновления статуса');
          return;
        }

        // Обновляем сообщение админа
        cardSystem.getCheckById(checkId, (err, check) => {
          if (err || !check) return;

          const keyboard = {
            inline_keyboard: [
              [
                { text: '✅ Успешно', callback_data: `check_approve_${checkId}` },
                { text: '❌ Отсутствует', callback_data: `check_reject_${checkId}` }
              ]
            ]
          };

          bot.editMessageReplyMarkup(keyboard, {
            chat_id: chatId,
            message_id: query.message.message_id
          });

          // Обновляем статус у воркера
          updateWorkerCheckStatus(bot, check.user_id, check.user_message_id, 'checking');
        });
      });
    }

    // Админ подтверждает чек
    if (data.startsWith('check_approve_') && adminIds.includes(userId)) {
      bot.answerCallbackQuery(query.id);

      const checkId = parseInt(data.replace('check_approve_', ''));

      cardSystem.getCheckById(checkId, (err, check) => {
        if (err || !check) {
          bot.sendMessage(chatId, '❌ Чек не найден');
          return;
        }

        cardSystem.updateCheckStatus(checkId, 'approved', query.message.message_id, (err) => {
          if (err) {
            bot.sendMessage(chatId, '❌ Ошибка обновления статуса');
            return;
          }

          // Обновляем статус у воркера
          updateWorkerCheckStatus(bot, check.user_id, check.user_message_id, 'approved');

          // Удаляем кнопки у админа
          bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
            chat_id: chatId,
            message_id: query.message.message_id
          });

          // Автоматически отправляем профит
          sendAutomaticProfit(bot, check, adminIds, GENERAL_CHAT_ID, ACCOUNTING_CHAT_ID, CASH_CHANNEL_ID);
        });
      });
    }

    // Админ отклоняет чек
    if (data.startsWith('check_reject_') && adminIds.includes(userId)) {
      bot.answerCallbackQuery(query.id);

      const checkId = parseInt(data.replace('check_reject_', ''));

      cardSystem.getCheckById(checkId, (err, check) => {
        if (err || !check) return;

        cardSystem.updateCheckStatus(checkId, 'rejected', query.message.message_id, (err) => {
          if (err) return;

          // Обновляем статус у воркера
          updateWorkerCheckStatus(bot, check.user_id, check.user_message_id, 'rejected');

          // Удаляем кнопки у админа
          bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
            chat_id: chatId,
            message_id: query.message.message_id
          });
        });
      });
    }
  });

  // Обработка загрузки файлов и фото для чеков
  bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const state = cardSystem.checkSubmissionState[userId];
    if (!state) return;

    // Получение файла чека
    if (state.step === 'file') {
      let fileId = null;
      let fileType = null;

      if (msg.photo && msg.photo.length > 0) {
        fileId = msg.photo[msg.photo.length - 1].file_id;
        fileType = 'photo';
      } else if (msg.document && msg.document.mime_type === 'application/pdf') {
        fileId = msg.document.file_id;
        fileType = 'pdf';
      } else if (msg.text && !msg.text.startsWith('/')) {
        // Если это текст, а не файл - игнорируем
        return;
      } else {
        bot.sendMessage(chatId, '❌ Пожалуйста, отправьте фото или PDF файл');
        return;
      }

      state.file_id = fileId;
      state.file_type = fileType;
      state.step = 'amount';

      bot.sendMessage(chatId, '💰 <b>Введите сумму на чеке:</b>', {
        parse_mode: 'HTML'
      });
    }
    // Получение суммы чека
    else if (state.step === 'amount' && msg.text && !msg.text.startsWith('/')) {
      const amount = parseInt(msg.text);
      if (isNaN(amount) || amount <= 0) {
        bot.sendMessage(chatId, '❌ Введите корректную сумму');
        return;
      }

      state.amount = amount;

      // Получаем информацию о карте (если есть)
      if (!state.card_id) {
        // Нет карты - отправляем без информации о реквизите
        const workerText = `📋 <b>Ваш чек:</b>

Сумма: ${amount.toLocaleString()}₽
Реквизиты: не указаны`;

        const workerKeyboard = {
          inline_keyboard: [
            [{ text: '🕘 Отправлено', callback_data: 'check_status_sent' }]
          ]
        };

        let sendPromise;
        if (state.file_type === 'photo') {
          sendPromise = bot.sendPhoto(chatId, state.file_id, {
            caption: workerText,
            parse_mode: 'HTML',
            reply_markup: workerKeyboard
          });
        } else {
          sendPromise = bot.sendDocument(chatId, state.file_id, {
            caption: workerText,
            parse_mode: 'HTML',
            reply_markup: workerKeyboard
          });
        }

        sendPromise.then(() => {
          cardSystem.createCheck({
            user_id: userId,
            card_id: null,
            request_id: null,
            file_id: state.file_id,
            file_type: state.file_type,
            amount: amount,
            user_message_id: null
          }, (err) => {
            if (err) console.error('Error creating check:', err);
          });
        });

        delete cardSystem.checkSubmissionState[userId];
        return;
      }

      cardSystem.getCardById(state.card_id, (err, card) => {
        if (err || !card) {
          bot.sendMessage(chatId, '❌ Реквизит не найден');
          delete cardSystem.checkSubmissionState[userId];
          return;
        }

        const last4 = card.card_number.slice(-4);

        // Отправляем чек воркеру с кнопкой статуса
        const workerText = `📋 <b>Ваш чек:</b>

Сумма: ${amount.toLocaleString()}₽
Реквизиты: ***${last4}
ФИО: ${card.full_name}`;

        const workerKeyboard = {
          inline_keyboard: [
            [{ text: '🕘 Отправлено', callback_data: 'check_status_sent' }]
          ]
        };

        // Отправляем с фото или документом
        let sendPromise;
        if (state.file_type === 'photo') {
          sendPromise = bot.sendPhoto(chatId, state.file_id, {
            caption: workerText,
            parse_mode: 'HTML',
            reply_markup: workerKeyboard
          });
        } else {
          sendPromise = bot.sendDocument(chatId, state.file_id, {
            caption: workerText,
            parse_mode: 'HTML',
            reply_markup: workerKeyboard
          });
        }

        sendPromise.then(sentMsg => {
          // Сохраняем чек в БД
          cardSystem.createCheck({
            user_id: userId,
            card_id: state.card_id,
            request_id: null,
            file_id: state.file_id,
            file_type: state.file_type,
            amount: amount,
            user_message_id: sentMsg.message_id
          }, (err, checkId) => {
            if (err) {
              console.error('Error creating check:', err);
              return;
            }

            // Отправляем чек админу, который выдал реквизит
            sendCheckToAdmin(bot, checkId, card.created_by, state.file_id, state.file_type, amount, last4, card.full_name);
          });
        });

        delete cardSystem.checkSubmissionState[userId];
      });
    }
  });
}

// Функция отправки чека админу
function sendCheckToAdmin(bot, checkId, adminId, fileId, fileType, amount, last4, fullName) {
  const adminText = `📋 <b>Новый чек на проверку:</b>

Сумма: ${amount.toLocaleString()}₽
Реквизиты: ***${last4}
ФИО: ${fullName}`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '🔍 На проверке', callback_data: `check_verify_${checkId}` }]
    ]
  };

  if (fileType === 'photo') {
    bot.sendPhoto(adminId, fileId, {
      caption: adminText,
      parse_mode: 'HTML',
      reply_markup: keyboard
    }).catch(err => {
      console.error('Error sending check to admin:', err);
    });
  } else {
    bot.sendDocument(adminId, fileId, {
      caption: adminText,
      parse_mode: 'HTML',
      reply_markup: keyboard
    }).catch(err => {
      console.error('Error sending check to admin:', err);
    });
  }
}

// Функция обновления статуса чека у воркера
function updateWorkerCheckStatus(bot, userId, messageId, status) {
  const statusButtons = {
    'sent': '🕘 Отправлено',
    'checking': '🔍 На проверке',
    'approved': '✅ Успешно',
    'rejected': '❌ Отсутствует'
  };

  const keyboard = {
    inline_keyboard: [
      [{ text: statusButtons[status], callback_data: `check_status_${status}` }]
    ]
  };

  bot.editMessageReplyMarkup(keyboard, {
    chat_id: userId,
    message_id: messageId
  }).catch(err => {
    console.error('Error updating worker check status:', err);
  });
}

// Функция автоматической отправки профита
function sendAutomaticProfit(bot, check, adminIds, GENERAL_CHAT_ID, ACCOUNTING_CHAT_ID, CASH_CHANNEL_ID) {
  const db = require('./database');

  // Получаем информацию о воркере
  db.get('SELECT * FROM users WHERE user_id = ?', [check.user_id], (err, user) => {
    if (err || !user) {
      console.error('Error getting user for profit:', err);
      return;
    }

    const amount = check.amount;
    const direction = 1; // По умолчанию направление 1 (пополнение)

    // Рассчитываем суммы
    const workerPayout = utils.calculateWorkerPayout(amount, direction);
    const shares = utils.calculateProfitShares(amount);
    const directionName = utils.getDirectionName(direction);

    // Обновляем статистику проекта
    utils.updateProjectStats(amount, (err) => {
      if (err) console.error('Error updating project stats:', err);
    });

    // Сохраняем профит в БД
    db.run('INSERT INTO profits (user_id, amount, amount_to_pay, direction) VALUES (?, ?, ?, ?)',
      [check.user_id, amount, workerPayout, direction],
      function(err) {
        if (err) {
          console.error('Error saving profit:', err);
          return;
        }

        const dbProfitId = this.lastID;

        // Сохраняем доли
        for (const [role, shareAmount] of Object.entries(shares)) {
          db.run('INSERT OR IGNORE INTO profit_shares (profit_id, role, percentage, amount) VALUES (?, ?, ?, ?)',
            [dbProfitId, role, utils.PROFIT_SHARES[role], shareAmount],
            (err) => {
              if (err) console.error('Error saving share:', err);
            }
          );
        }

        // Обновляем баланс и статистику воркера
        db.run(`UPDATE users SET
          balance = balance + ?,
          total_earned = total_earned + ?,
          profit_count = profit_count + 1
          WHERE user_id = ?`,
          [workerPayout, amount, check.user_id],
          (err) => {
            if (err) {
              console.error('Error updating user:', err);
            } else {
              console.log(`✅ Auto-profit: Updated balance for user ${check.user_id}: +${workerPayout}₽`);
              utils.updateWorkerStatus(check.user_id, (err) => {
                if (err) console.error('Error updating status:', err);
              });
            }
          }
        );

        // Отправляем в бухгалтерию
        const accountingText = `<b>🚀${directionName}
👤Воркер: @${user.username}
💸Сумма профита: ${amount.toLocaleString()}₽
💼К выплате: ${workerPayout.toLocaleString()}₽
👑Владелец: ${shares.owner.toLocaleString()}₽
👔Администратор: ${shares.admin.toLocaleString()}₽
🍌Инвестор: ${shares.investor.toLocaleString()}₽
🧑‍💻Кодер: ${shares.coder.toLocaleString()}₽

<i>✅ Автоматический профит из чека</i></b>`;

        bot.sendMessage(ACCOUNTING_CHAT_ID, accountingText, { parse_mode: 'HTML' }).catch(err => {
          console.error('Error sending to accounting:', err);
        });

        // Отправляем в общую кассу и чат
        let publicText = `<b>🌸УСПЕШНЫЙ ПРОФИТ🌸

🏠Сервис: ${directionName}
┣👤Воркер: #${user.name}`;

        // Добавляем куратора, если он есть и направление = 1 (Кардинг)
        if (direction === 1 && user.curator) {
          publicText += `\n┣💸Сумма: ${amount.toLocaleString()}₽\n┗👨‍🏫Куратор: @${user.curator}</b>`;
        } else {
          publicText += `\n┗💸Сумма: ${amount.toLocaleString()}₽</b>`;
        }

        bot.sendMessage(CASH_CHANNEL_ID, publicText, { parse_mode: 'HTML' }).catch(err => {
          console.error('Error sending to cash channel:', err);
        });

        bot.sendMessage(GENERAL_CHAT_ID, publicText, { parse_mode: 'HTML' }).catch(err => {
          console.error('Error sending to general chat:', err);
        });
      }
    );
  });
}

module.exports = { setupCheckHandlers };
