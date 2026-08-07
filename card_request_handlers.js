const cardSystem = require('./card_system');

// Обработчики системы запросов реквизитов
function setupCardRequestHandlers(bot, adminIds) {

  // Обработка текстовых сообщений для запроса реквизитов
  bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    const chatType = msg.chat.type;

    if (!text || text.startsWith('/')) return;
    if (chatType !== 'private') return;

    const state = cardSystem.cardRequestState[userId];
    if (!state) return;

    switch (state.step) {
      case 'amount':
        const amount = parseInt(text);
        if (isNaN(amount) || amount <= 0) {
          bot.sendMessage(chatId, '❌ Введите корректную сумму');
          return;
        }

        state.amount = amount;
        state.step = 'gender';

        const genderKeyboard = {
          inline_keyboard: [
            [
              { text: 'Мужской', callback_data: 'request_gender_male' },
              { text: 'Женский', callback_data: 'request_gender_female' }
            ],
            [
              { text: 'Не важно', callback_data: 'request_gender_any' }
            ]
          ]
        };

        bot.sendMessage(chatId, '👤 <b>Выберите пол:</b>', {
          parse_mode: 'HTML',
          reply_markup: genderKeyboard
        });
        break;

      case 'hold':
        const hold = parseInt(text);
        if (isNaN(hold) || hold <= 0) {
          bot.sendMessage(chatId, '❌ Введите корректное количество часов');
          return;
        }

        state.hold_hours = hold;

        // Показываем подтверждение
        showRequestConfirmation(bot, chatId, userId, state);
        break;
    }
  });

  // Обработка выбора пола
  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    if (data.startsWith('request_gender_')) {
      bot.answerCallbackQuery(query.id);

      const state = cardSystem.cardRequestState[userId];
      if (!state || state.step !== 'gender') return;

      const gender = data.replace('request_gender_', '');
      state.gender = gender;
      state.step = 'hold';

      bot.sendMessage(chatId, '⏰ <b>Введите холд в часах:</b>\n\n(Время до жалобы мамонта в банк)\nНапример: 2', {
        parse_mode: 'HTML'
      });
    }

    // Подтверждение отправки запроса
    if (data === 'request_confirm_send') {
      bot.answerCallbackQuery(query.id);

      const state = cardSystem.cardRequestState[userId];
      if (!state) return;

      // Сохраняем запрос в БД
      cardSystem.createCardRequest({
        user_id: userId,
        amount: state.amount,
        gender: state.gender,
        hold_hours: state.hold_hours
      }, (err, requestId) => {
        if (err) {
          bot.sendMessage(chatId, '❌ Ошибка создания запроса');
          console.error('Error creating request:', err);
          return;
        }

        bot.sendMessage(chatId, '✅ <b>Запрос на реквизиты отправлен!</b>\n\nОжидайте обработки администратором.', {
          parse_mode: 'HTML'
        });

        // Отправляем уведомления всем админам
        sendRequestToAdmins(bot, adminIds, userId, requestId, state);

        delete cardSystem.cardRequestState[userId];
      });
    }

    // Отмена запроса
    if (data === 'request_confirm_cancel') {
      bot.answerCallbackQuery(query.id);

      delete cardSystem.cardRequestState[userId];
      bot.sendMessage(chatId, '❌ Запрос отменен');
    }

    // Админ начинает обработку запроса
    if (data.startsWith('request_process_') && adminIds.includes(userId)) {
      bot.answerCallbackQuery(query.id);

      const requestId = parseInt(data.replace('request_process_', ''));

      // Получаем данные запроса
      cardSystem.getCardRequestById(requestId, (err, request) => {
        if (err || !request) {
          bot.sendMessage(chatId, '❌ Запрос не найден');
          return;
        }

        // Проверяем, не обработан ли уже запрос
        if (request.status !== 'pending') {
          bot.sendMessage(chatId, '⚠️ Этот запрос уже обработан');
          return;
        }

        // Обновляем статус на "в обработке"
        cardSystem.updateCardRequestStatus(requestId, 'processing', userId, null, (err) => {
          if (err) {
            bot.sendMessage(chatId, '❌ Ошибка обновления статуса');
            return;
          }

          // Уведомляем воркера
          bot.sendMessage(request.user_id, `💎 <b>Запрос на реквизиты принят!</b>

👤Пол: ${getGenderText(request.gender)}
💸Сумма: ${request.amount.toLocaleString()}₽
⏰Холд: ${request.hold_hours}ч

Максимальное время выдачи: 10 минут.`, {
            parse_mode: 'HTML'
          });

          // Начинаем процесс создания реквизита для админа
          cardSystem.cardCreationState[userId] = {
            step: 'gender',
            is_temporary: 1,
            request_id: requestId,
            worker_id: request.user_id
          };

          const genderKeyboard = {
            inline_keyboard: [
              [
                { text: 'Мужской', callback_data: 'card_gender_male' },
                { text: 'Женский', callback_data: 'card_gender_female' }
              ]
            ]
          };

          bot.sendMessage(chatId, '👤 <b>Создание реквизита для запроса</b>\n\nВыберите пол:', {
            parse_mode: 'HTML',
            reply_markup: genderKeyboard
          });
        });
      });
    }

    // Админ откладывает запрос
    if (data.startsWith('request_postpone_') && adminIds.includes(userId)) {
      bot.answerCallbackQuery(query.id, {
        text: 'Запрос отложен',
        show_alert: false
      });
    }

    // Админ отказывает в запросе
    if (data.startsWith('request_reject_') && adminIds.includes(userId)) {
      bot.answerCallbackQuery(query.id);

      const requestId = parseInt(data.replace('request_reject_', ''));

      cardSystem.getCardRequestById(requestId, (err, request) => {
        if (err || !request) return;

        cardSystem.updateCardRequestStatus(requestId, 'rejected', userId, null, (err) => {
          if (err) return;

          bot.sendMessage(request.user_id, `❌ <b>Реквизиты под твой запрос отсутствуют.</b>

👤Пол: ${getGenderText(request.gender)}
💸Сумма: ${request.amount.toLocaleString()}₽
⏰Холд: ${request.hold_hours}ч`, {
            parse_mode: 'HTML'
          });

          bot.sendMessage(chatId, '✅ Запрос отклонен, воркер уведомлен');
        });
      });
    }
  });
}

// Функция показа подтверждения запроса
function showRequestConfirmation(bot, chatId, userId, state) {
  const genderText = getGenderText(state.gender);

  const confirmText = `<b>Запрос на реквизит составлен!</b>

👤Пол: ${genderText}
💸Сумма: ${state.amount.toLocaleString()}₽
⏰Холд: ${state.hold_hours}ч`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: 'Отправить', callback_data: 'request_confirm_send' },
        { text: 'Отменить', callback_data: 'request_confirm_cancel' }
      ]
    ]
  };

  bot.sendMessage(chatId, confirmText, {
    parse_mode: 'HTML',
    reply_markup: keyboard
  });
}

// Функция отправки запроса всем админам
function sendRequestToAdmins(bot, adminIds, workerId, requestId, state) {
  const db = require('./database');

  db.get('SELECT username FROM users WHERE user_id = ?', [workerId], (err, user) => {
    const username = user?.username || 'unknown';
    const genderText = getGenderText(state.gender);

    const adminText = `💳 <b>Новый запрос на реквизиты!</b>

💷Воркер: @${username}
👤Пол: ${genderText}
💸Сумма: ${state.amount.toLocaleString()}₽
⏰Холд: ${state.hold_hours}ч`;

    const keyboard = {
      inline_keyboard: [
        [{ text: 'Начать обработку', callback_data: `request_process_${requestId}` }],
        [{ text: 'Отложить запрос', callback_data: `request_postpone_${requestId}` }],
        [{ text: 'Отказаться', callback_data: `request_reject_${requestId}` }]
      ]
    };

    adminIds.forEach(adminId => {
      bot.sendMessage(adminId, adminText, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      }).catch(err => {
        console.error(`Error sending request to admin ${adminId}:`, err);
      });
    });
  });
}

// Функция получения текста пола
function getGenderText(gender) {
  const genderMap = {
    'male': 'Мужской',
    'female': 'Женский',
    'any': 'Не важно'
  };
  return genderMap[gender] || gender;
}

module.exports = { setupCardRequestHandlers };
