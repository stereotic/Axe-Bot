const cardSystem = require('./card_system');
const db = require('./database');

// Временное хранилище для текущего индекса карты у каждого пользователя
const userCardIndex = {};
// Опции экрана карт (например «назад в меню» при открытии из меню)
const userCardViewOptions = {};

function setCardViewOptions(userId, options = {}) {
  userCardViewOptions[userId] = {
    chatType: options.chatType || 'private',
    showBackToMenu: Boolean(options.showBackToMenu)
  };
}

function getCardViewOptions(userId, chatType = 'private') {
  return userCardViewOptions[userId] || { chatType, showBackToMenu: false };
}

function getBotUsername() {
  return process.env.BOT_USERNAME || 'AXE_xBOT';
}

function createRequestButton(chatType) {
  const isGroup = chatType && chatType !== 'private';
  if (isGroup) {
    return {
      text: 'Запросить реквизит',
      url: `https://t.me/${getBotUsername()}?start=card_request`
    };
  }
  return { text: 'Запросить реквизит', callback_data: 'card_request' };
}

function createCheckButton(chatType) {
  const isGroup = chatType && chatType !== 'private';
  if (isGroup) {
    return {
      text: 'Проверить чек',
      url: `https://t.me/${getBotUsername()}?start=card_check`
    };
  }
  return { text: 'Проверить чек', callback_data: 'card_check_status' };
}

function openCardView(bot, chatId, userId, options = {}) {
  const { deleteMessageId, showBackToMenu = false, chatType = 'private' } = options;
  const viewOptions = { showBackToMenu, chatType };

  setCardViewOptions(userId, viewOptions);

  const afterSend = () => {
    if (deleteMessageId) {
      bot.deleteMessage(chatId, deleteMessageId).catch(() => {});
    }
  };

  cardSystem.getAllCards((err, cards) => {
    if (err || !cards || cards.length === 0) {
      sendNoCardsMessage(bot, chatId, viewOptions)
        .then(afterSend)
        .catch((error) => {
          console.error('sendNoCardsMessage failed:', error.message);
        });
      return;
    }

    userCardIndex[userId] = 0;
    sendCardMessage(bot, chatId, userId, cards, viewOptions)
      .then(afterSend)
      .catch((error) => {
        console.error('sendCardMessage failed:', error.message);
        bot.sendMessage(chatId, '❌ Не удалось открыть реквизиты. Попробуйте ещё раз.').catch(() => {});
      });
  });
}

function startCardRequestInPrivate(bot, userId) {
  cardSystem.cardRequestState[userId] = { step: 'amount', chatId: userId };
  return bot.sendMessage(userId, '💰 <b>Введите сумму депозита:</b>', {
    parse_mode: 'HTML'
  });
}

function startCardCheckInPrivate(bot, userId) {
  cardSystem.checkSubmissionState[userId] = { step: 'file', card_id: null };
  return bot.sendMessage(userId, '📸 <b>Отправьте фото чека или файл в формате PDF:</b>', {
    parse_mode: 'HTML'
  });
}

// Обработчики команды /card для воркеров
function setupCardViewHandlers(bot) {
  bot.onText(/\/card/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    db.get('SELECT application_approved FROM users WHERE user_id = ?', [userId], (err, user) => {
      if (err) {
        // Транзиентная ошибка чтения БД — не блокируем легитимного пользователя.
        console.error('/card access-check DB error:', err.message);
        openCardView(bot, chatId, userId, { chatType: msg.chat.type, showBackToMenu: false });
        return;
      }
      if (!user || Number(user.application_approved) !== 1) {
        bot.sendMessage(chatId, '❌ Команда недоступна. Пройдите регистрацию и дождитесь одобрения заявки администрацией.').catch(() => {});
        return;
      }

      openCardView(bot, chatId, userId, { chatType: msg.chat.type, showBackToMenu: false });
    });
  });

  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;
    const chatType = query.message.chat.type;

    if (data === 'card_nav_left') {
      bot.answerCallbackQuery(query.id);

      cardSystem.getAllCards((err, cards) => {
        if (err || !cards || cards.length === 0) return;

        const currentIndex = userCardIndex[userId] || 0;
        userCardIndex[userId] = currentIndex > 0 ? currentIndex - 1 : cards.length - 1;

        editCardMessage(bot, chatId, query.message.message_id, userId, cards, getCardViewOptions(userId, chatType));
      });
      return;
    }

    if (data === 'card_nav_right') {
      bot.answerCallbackQuery(query.id);

      cardSystem.getAllCards((err, cards) => {
        if (err || !cards || cards.length === 0) return;

        const currentIndex = userCardIndex[userId] || 0;
        userCardIndex[userId] = currentIndex < cards.length - 1 ? currentIndex + 1 : 0;

        editCardMessage(bot, chatId, query.message.message_id, userId, cards, getCardViewOptions(userId, chatType));
      });
      return;
    }

    if (data === 'card_info') {
      bot.answerCallbackQuery(query.id, {
        text: 'Информация о реквизите',
        show_alert: false
      });
      return;
    }

    if (data === 'card_request') {
      if (chatType !== 'private') {
        const botUsername = getBotUsername();
        startCardRequestInPrivate(bot, userId)
          .then(() => {
            bot.answerCallbackQuery(query.id, {
              text: 'Продолжите запрос в личке с ботом',
              show_alert: false
            }).catch(() => {});
          })
          .catch(() => {
            bot.answerCallbackQuery(query.id, {
              text: `Сначала напишите боту @${botUsername} /start`,
              show_alert: true
            }).catch(() => {});
          });
        return;
      }

      bot.answerCallbackQuery(query.id);
      cardSystem.cardRequestState[userId] = { step: 'amount', chatId };
      bot.sendMessage(chatId, '💰 <b>Введите сумму депозита:</b>', {
        parse_mode: 'HTML'
      });
      return;
    }

    if (data === 'card_check_status') {
      if (chatType !== 'private') {
        const botUsername = getBotUsername();
        startCardCheckInPrivate(bot, userId)
          .then(() => {
            bot.answerCallbackQuery(query.id, {
              text: 'Продолжите проверку в личке с ботом',
              show_alert: false
            }).catch(() => {});
          })
          .catch(() => {
            bot.answerCallbackQuery(query.id, {
              text: `Сначала напишите боту @${botUsername} /start`,
              show_alert: true
            }).catch(() => {});
          });
        return;
      }

      bot.answerCallbackQuery(query.id);

      cardSystem.getAllCards((err, cards) => {
        if (err || !cards || cards.length === 0) {
          sendNoCardsMessage(bot, chatId, getCardViewOptions(userId, chatType));
          return;
        }

        const currentIndex = userCardIndex[userId] || 0;
        const currentCard = cards[currentIndex];

        cardSystem.checkSubmissionState[userId] = {
          step: 'file',
          card_id: currentCard.id
        };

        bot.sendMessage(chatId, '📸 <b>Отправьте фото чека или файл в формате PDF:</b>', {
          parse_mode: 'HTML'
        });
      });
      return;
    }

    if (data === 'card_notifications') {
      bot.answerCallbackQuery(query.id, {
        text: 'Уведомления включены',
        show_alert: false
      });
      return;
    }

    if (data === 'card_refresh') {
      bot.answerCallbackQuery(query.id);

      cardSystem.getAllCards((err, cards) => {
        const viewOptions = getCardViewOptions(userId, chatType);

        if (err || !cards || cards.length === 0) {
          editNoCardsMessage(bot, chatId, query.message.message_id, viewOptions);
          return;
        }

        userCardIndex[userId] = 0;
        editCardMessage(bot, chatId, query.message.message_id, userId, cards, viewOptions);
      });
    }
  });
}

function sendCardMessage(bot, chatId, userId, cards, options = {}) {
  const index = userCardIndex[userId] || 0;
  const card = cards[index];
  const cardText = cardSystem.formatCardRequisite(card);
  const keyboard = createCardKeyboard(card, index, cards.length, options);

  return bot.sendMessage(chatId, cardText, {
    parse_mode: 'HTML',
    reply_markup: keyboard
  });
}

function editCardMessage(bot, chatId, messageId, userId, cards, options = {}) {
  const index = userCardIndex[userId] || 0;
  const card = cards[index];
  const cardText = cardSystem.formatCardRequisite(card);
  const keyboard = createCardKeyboard(card, index, cards.length, options);

  bot.editMessageText(cardText, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'HTML',
    reply_markup: keyboard
  }).catch(err => {
    if (!err.message.includes('message is not modified')) {
      console.error('Error editing card message:', err);
    }
  });
}

function createCardKeyboard(card, currentIndex, totalCards, options = {}) {
  const { chatType = 'private', showBackToMenu = false } = options;
  const genderEmoji = cardSystem.getGenderEmoji(card.gender);
  const countryFlag = cardSystem.getCountryFlag(card.country);
  const requestButton = createRequestButton(chatType);

  const checkButton = createCheckButton(chatType);

  const rows = [
    [{ text: 'Уведомления', callback_data: 'card_notifications' }],
    [checkButton],
    [requestButton],
    [
      { text: '<', callback_data: 'card_nav_left' },
      { text: `Инфо`, callback_data: 'card_info' },
      { text: '>', callback_data: 'card_nav_right' }
    ]
  ];

  if (showBackToMenu) {
    rows.push([{ text: 'Назад в меню', callback_data: 'back_to_menu' }]);
  }

  return { inline_keyboard: rows };
}

function noCardsRequestButton(chatType) {
  if (chatType && chatType !== 'private') {
    return createRequestButton(chatType);
  }
  return { text: 'Запросить реквизит', callback_data: 'card_request' };
}

function createNoCardsKeyboard(options = {}) {
  const { chatType = 'private', showBackToMenu = false } = options;
  const rows = [
    [noCardsRequestButton(chatType)],
    [{ text: 'Обновить', callback_data: 'card_refresh' }]
  ];

  if (showBackToMenu) {
    rows.push([{ text: 'Назад в меню', callback_data: 'back_to_menu' }]);
  }

  return { inline_keyboard: rows };
}

function sendNoCardsMessage(bot, chatId, options = {}) {
  const viewOptions = typeof options === 'string'
    ? { chatType: options, showBackToMenu: false }
    : options;

  return bot.sendMessage(chatId, '<b><tg-emoji emoji-id="5451908327355232301">⏰</tg-emoji>Общие реквизиты временно отсутствуют</b>\n\n<b><tg-emoji emoji-id="5444858967467534874">📝</tg-emoji>Реквизиты под запрос</b>', {
    parse_mode: 'HTML',
    reply_markup: createNoCardsKeyboard(viewOptions)
  });
}

function editNoCardsMessage(bot, chatId, messageId, options = {}) {
  const viewOptions = typeof options === 'string'
    ? { chatType: options, showBackToMenu: false }
    : options;

  bot.editMessageText('<b><tg-emoji emoji-id="5451908327355232301">⏰</tg-emoji>Общие реквизиты временно отсутствуют</b>\n\n<b><tg-emoji emoji-id="5444858967467534874">📝</tg-emoji>Реквизиты под запрос</b>', {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'HTML',
    reply_markup: createNoCardsKeyboard(viewOptions)
  }).catch(err => {
    if (!err.message.includes('message is not modified')) {
      console.error('Error editing no-cards message:', err);
    }
  });
}

module.exports = {
  setupCardViewHandlers,
  openCardView,
  startCardRequestInPrivate,
  startCardCheckInPrivate,
  userCardIndex
};
