const cardSystem = require('./card_system');
const utils = require('./utils');

// Обработчики для системы управления реквизитами
function setupCardHandlers(bot, adminIds, GENERAL_CHAT_ID, ACCOUNTING_CHAT_ID, CASH_CHANNEL_ID) {

  // ==================== СОЗДАНИЕ РЕКВИЗИТА ====================

  // Начало создания реквизита
  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    if (data === 'card_create' && adminIds.includes(userId)) {
      bot.answerCallbackQuery(query.id);

      cardSystem.cardCreationState[userId] = { step: 'gender' };

      const keyboard = {
        inline_keyboard: [
          [
            { text: '👨 Мужской', callback_data: 'card_gender_male' },
            { text: '👩‍🦱 Женский', callback_data: 'card_gender_female' }
          ]
        ]
      };

      bot.sendMessage(chatId, '👤 <b>Выберите пол:</b>', {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
    }

    // Выбор пола
    if (data.startsWith('card_gender_') && adminIds.includes(userId)) {
      bot.answerCallbackQuery(query.id);

      const gender = data === 'card_gender_male' ? 'male' : 'female';
      cardSystem.cardCreationState[userId].gender = gender;
      cardSystem.cardCreationState[userId].step = 'percent';

      bot.sendMessage(chatId, '💰 <b>Введите процент карты:</b>\n\nНапример: 75', {
        parse_mode: 'HTML'
      });
    }

    // Удаление реквизита
    if (data === 'card_delete' && adminIds.includes(userId)) {
      bot.answerCallbackQuery(query.id);

      cardSystem.getAllCards((err, cards) => {
        if (err || !cards || cards.length === 0) {
          bot.sendMessage(chatId, '❌ Реквизиты отсутствуют');
          return;
        }

        const keyboard = {
          inline_keyboard: cards.map(card => {
            const last4 = card.card_number.slice(-4);
            const genderEmoji = cardSystem.getGenderEmoji(card.gender);
            return [{
              text: `${last4} ${card.bank} ${genderEmoji}`,
              callback_data: `card_delete_confirm_${card.id}`
            }, {
              text: '❌',
              callback_data: `card_delete_${card.id}`
            }];
          })
        };

        bot.sendMessage(chatId, '🗑 <b>Выберите реквизит для удаления:</b>', {
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
      });
    }

    // Подтверждение удаления
    if (data.startsWith('card_delete_') && !data.includes('confirm') && adminIds.includes(userId)) {
      bot.answerCallbackQuery(query.id);

      const cardId = parseInt(data.replace('card_delete_', ''));

      // Проверяем, не выдан ли реквизит по запросу
      cardSystem.getCardById(cardId, (err, card) => {
        if (err || !card) {
          bot.sendMessage(chatId, '❌ Реквизит не найден');
          return;
        }

        // Если это временный реквизит, уведомляем воркера
        if (card.is_temporary) {
          const db = require('./database');
          db.get('SELECT user_id FROM card_requests WHERE card_id = ? AND status = "completed"', [cardId], (err, request) => {
            if (!err && request) {
              const stopText = `🛑 <b>STOP</b>

${cardSystem.formatCardRequisite(card)}`;

              bot.sendMessage(request.user_id, stopText, { parse_mode: 'HTML' }).catch(err => {
                console.error('Error sending stop notification:', err);
              });
            }
          });
        }

        // Удаляем реквизит
        cardSystem.deleteCard(cardId, (err) => {
          if (err) {
            bot.sendMessage(chatId, '❌ Ошибка удаления реквизита');
            return;
          }

          bot.sendMessage(chatId, '✅ Реквизит успешно удален!');
        });
      });
    }

    // Редактирование реквизита
    if (data === 'card_edit' && adminIds.includes(userId)) {
      bot.answerCallbackQuery(query.id);

      cardSystem.getAllCards((err, cards) => {
        if (err || !cards || cards.length === 0) {
          bot.sendMessage(chatId, '❌ Реквизиты отсутствуют');
          return;
        }

        const keyboard = {
          inline_keyboard: cards.map(card => {
            const last4 = card.card_number.slice(-4);
            const genderEmoji = cardSystem.getGenderEmoji(card.gender);
            return [{
              text: `${last4} ${card.bank} ${genderEmoji}`,
              callback_data: `card_edit_select_${card.id}`
            }];
          })
        };

        bot.sendMessage(chatId, '✏️ <b>Выберите реквизит для изменения:</b>', {
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
      });
    }

    // Выбор реквизита для редактирования
    if (data.startsWith('card_edit_select_') && adminIds.includes(userId)) {
      bot.answerCallbackQuery(query.id);

      const cardId = parseInt(data.replace('card_edit_select_', ''));

      const keyboard = {
        inline_keyboard: [
          [{ text: '👤 Изменить пол', callback_data: `card_edit_field_${cardId}_gender` }],
          [{ text: '💰 Изменить процент', callback_data: `card_edit_field_${cardId}_percent` }],
          [{ text: '📉 Изменить мин. лимит', callback_data: `card_edit_field_${cardId}_min_limit` }],
          [{ text: '📈 Изменить макс. лимит', callback_data: `card_edit_field_${cardId}_max_limit` }],
          [{ text: '🏦 Изменить банк', callback_data: `card_edit_field_${cardId}_bank` }],
          [{ text: '💳 Изменить номер карты', callback_data: `card_edit_field_${cardId}_card_number` }],
          [{ text: '📝 Изменить ФИО', callback_data: `card_edit_field_${cardId}_full_name` }],
          [{ text: '📋 Изменить примечание', callback_data: `card_edit_field_${cardId}_notes` }]
        ]
      };

      bot.sendMessage(chatId, '✏️ <b>Что хотите изменить?</b>', {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
    }

    // Выбор поля для редактирования
    if (data.startsWith('card_edit_field_') && adminIds.includes(userId)) {
      bot.answerCallbackQuery(query.id);

      const parts = data.replace('card_edit_field_', '').split('_');
      const cardId = parseInt(parts[0]);
      const field = parts.slice(1).join('_');

      cardSystem.cardCreationState[userId] = {
        step: 'edit',
        cardId: cardId,
        field: field
      };

      const fieldNames = {
        'gender': 'пол',
        'percent': 'процент',
        'min_limit': 'минимальный лимит',
        'max_limit': 'максимальный лимит',
        'bank': 'банк',
        'card_number': 'номер карты',
        'full_name': 'ФИО',
        'notes': 'примечание'
      };

      if (field === 'gender') {
        const keyboard = {
          inline_keyboard: [
            [
              { text: '👨 Мужской', callback_data: `card_edit_value_${cardId}_gender_male` },
              { text: '👩‍🦱 Женский', callback_data: `card_edit_value_${cardId}_gender_female` }
            ]
          ]
        };

        bot.sendMessage(chatId, '👤 <b>Выберите новый пол:</b>', {
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
      } else {
        bot.sendMessage(chatId, `✏️ <b>Введите новое значение для поля "${fieldNames[field]}":</b>`, {
          parse_mode: 'HTML'
        });
      }
    }

    // Сохранение нового значения пола при редактировании
    if (data.startsWith('card_edit_value_') && adminIds.includes(userId)) {
      bot.answerCallbackQuery(query.id);

      const parts = data.replace('card_edit_value_', '').split('_');
      const cardId = parseInt(parts[0]);
      const field = parts[1];
      const value = parts[2];

      cardSystem.updateCard(cardId, field, value, (err) => {
        if (err) {
          bot.sendMessage(chatId, '❌ Ошибка обновления реквизита');
          return;
        }

        bot.sendMessage(chatId, '✅ Реквизит успешно обновлен!');
        delete cardSystem.cardCreationState[userId];
      });
    }
  });

  // Обработка текстовых сообщений для создания/редактирования реквизитов
  bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    if (!text || text.startsWith('/') || !adminIds.includes(userId)) {
      return;
    }

    const state = cardSystem.cardCreationState[userId];
    if (!state) return;

    // Редактирование существующего реквизита
    if (state.step === 'edit') {
      const value = text.trim();
      const field = state.field;
      const cardId = state.cardId;

      // Валидация для числовых полей
      if (['percent', 'min_limit', 'max_limit'].includes(field)) {
        const numValue = parseInt(value);
        if (isNaN(numValue) || numValue <= 0) {
          bot.sendMessage(chatId, '❌ Введите корректное число');
          return;
        }

        cardSystem.updateCard(cardId, field, numValue, (err) => {
          if (err) {
            bot.sendMessage(chatId, '❌ Ошибка обновления реквизита');
            return;
          }

          bot.sendMessage(chatId, '✅ Реквизит успешно обновлен!');
          delete cardSystem.cardCreationState[userId];
        });
      } else {
        cardSystem.updateCard(cardId, field, value, (err) => {
          if (err) {
            bot.sendMessage(chatId, '❌ Ошибка обновления реквизита');
            return;
          }

          bot.sendMessage(chatId, '✅ Реквизит успешно обновлен!');
          delete cardSystem.cardCreationState[userId];
        });
      }
      return;
    }

    // Создание нового реквизита
    switch (state.step) {
      case 'percent':
        const percent = parseInt(text);
        if (isNaN(percent) || percent <= 0 || percent > 100) {
          bot.sendMessage(chatId, '❌ Введите корректный процент (от 1 до 100)');
          return;
        }

        state.percent = percent;
        state.step = 'min_limit';
        bot.sendMessage(chatId, '📉 <b>Введите минимальный лимит:</b>\n\nНапример: 1000', {
          parse_mode: 'HTML'
        });
        break;

      case 'min_limit':
        const minLimit = parseInt(text);
        if (isNaN(minLimit) || minLimit <= 0) {
          bot.sendMessage(chatId, '❌ Введите корректную сумму');
          return;
        }

        state.min_limit = minLimit;
        state.step = 'max_limit';
        bot.sendMessage(chatId, '📈 <b>Введите максимальный лимит:</b>\n\nНапример: 15000', {
          parse_mode: 'HTML'
        });
        break;

      case 'max_limit':
        const maxLimit = parseInt(text);
        if (isNaN(maxLimit) || maxLimit <= 0 || maxLimit < state.min_limit) {
          bot.sendMessage(chatId, '❌ Максимальный лимит должен быть больше минимального');
          return;
        }

        state.max_limit = maxLimit;
        state.step = 'card_number';
        bot.sendMessage(chatId, '💳 <b>Введите номер карты:</b>\n\nНапример: 1234567891229', {
          parse_mode: 'HTML'
        });
        break;

      case 'card_number':
        state.card_number = text.trim();
        state.step = 'bank';
        bot.sendMessage(chatId, '🏦 <b>Введите название банка:</b>\n\nНапример: СберБанк', {
          parse_mode: 'HTML'
        });
        break;

      case 'bank':
        state.bank = text.trim();
        state.step = 'full_name';
        bot.sendMessage(chatId, '📝 <b>Введите ФИО:</b>\n\nНапример: Иванов Иван Иванович', {
          parse_mode: 'HTML'
        });
        break;

      case 'full_name':
        state.full_name = text.trim();
        state.step = 'notes';

        const keyboard = {
          inline_keyboard: [
            [{ text: '⏭ Пропустить', callback_data: 'card_notes_skip' }]
          ]
        };

        bot.sendMessage(chatId, '📋 <b>Добавьте примечания:</b>\n\nИли нажмите "Пропустить"', {
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
        break;

      case 'notes':
        state.notes = text.trim();
        saveNewCard(bot, chatId, userId, state);
        break;
    }
  });

  // Пропуск примечаний
  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    if (data === 'card_notes_skip' && adminIds.includes(userId)) {
      bot.answerCallbackQuery(query.id);

      const state = cardSystem.cardCreationState[userId];
      if (state && state.step === 'notes') {
        state.notes = '';
        saveNewCard(bot, chatId, userId, state);
      }
    }
  });

  // Функция сохранения нового реквизита
  function saveNewCard(bot, chatId, userId, state) {
    const cardData = {
      gender: state.gender,
      country: 'RU',
      percent: state.percent,
      min_limit: state.min_limit,
      max_limit: state.max_limit,
      card_number: state.card_number,
      bank: state.bank,
      full_name: state.full_name,
      notes: state.notes,
      is_temporary: state.is_temporary || 0,
      created_by: userId
    };

    cardSystem.createCard(cardData, (err, cardId) => {
      if (err) {
        bot.sendMessage(chatId, '❌ Ошибка создания реквизита');
        console.error('Error creating card:', err);
        return;
      }

      bot.sendMessage(chatId, '✅ <b>Реквизит успешно создан!</b>', {
        parse_mode: 'HTML'
      });

      // Если это реквизит для запроса - отправляем воркеру
      if (state.request_id && state.worker_id) {
        const db = require('./database');

        // Обновляем запрос
        cardSystem.updateCardRequestStatus(state.request_id, 'completed', userId, cardId, (err) => {
          if (err) console.error('Error updating request:', err);
        });

        // Получаем данные карты
        cardSystem.getCardById(cardId, (err, card) => {
          if (err || !card) return;

          const cardText = cardSystem.formatCardRequisite(card);
          const workerText = `💳 <b>Реквизиты по твоему запросу</b>

${cardText}`;

          const keyboard = {
            inline_keyboard: [
              [{ text: '🔍 Отправить чек', callback_data: `check_submit_${cardId}` }]
            ]
          };

          bot.sendMessage(state.worker_id, workerText, {
            parse_mode: 'HTML',
            reply_markup: keyboard
          }).catch(err => {
            console.error('Error sending card to worker:', err);
          });
        });
      }

      delete cardSystem.cardCreationState[userId];
    });
  }
}

module.exports = { setupCardHandlers };
