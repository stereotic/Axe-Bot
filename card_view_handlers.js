const cardSystem = require('./card_system');

// Временное хранилище для текущего индекса карты у каждого пользователя
const userCardIndex = {};

// Обработчики команды /card для воркеров
function setupCardViewHandlers(bot) {

  // Команда /card - просмотр реквизитов
  bot.onText(/\/card/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // Получаем все реквизиты
    cardSystem.getAllCards((err, cards) => {
      if (err || !cards || cards.length === 0) {
        sendNoCardsMessage(bot, chatId);
        return;
      }

      // Устанавливаем индекс на первую карту
      userCardIndex[userId] = 0;

      // Отправляем первую карту
      sendCardMessage(bot, chatId, userId, cards);
    });
    return true; // Предотвращаем дальнейшую обработку
  });

  // Обработка навигации и кнопок
  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    // Навигация влево
    if (data === 'card_nav_left') {
      bot.answerCallbackQuery(query.id);

      cardSystem.getAllCards((err, cards) => {
        if (err || !cards || cards.length === 0) return;

        const currentIndex = userCardIndex[userId] || 0;
        userCardIndex[userId] = currentIndex > 0 ? currentIndex - 1 : cards.length - 1;

        editCardMessage(bot, chatId, query.message.message_id, userId, cards);
      });
    }

    // Навигация вправо
    if (data === 'card_nav_right') {
      bot.answerCallbackQuery(query.id);

      cardSystem.getAllCards((err, cards) => {
        if (err || !cards || cards.length === 0) return;

        const currentIndex = userCardIndex[userId] || 0;
        userCardIndex[userId] = currentIndex < cards.length - 1 ? currentIndex + 1 : 0;

        editCardMessage(bot, chatId, query.message.message_id, userId, cards);
      });
    }

    // Кнопка пола и страны (центральная) - пока просто показываем информацию
    if (data === 'card_info') {
      bot.answerCallbackQuery(query.id, {
        text: 'Информация о реквизите',
        show_alert: false
      });
    }

    // Кнопка "Запросить реквизит"
    if (data === 'card_request') {
      bot.answerCallbackQuery(query.id);

      // Инициализируем состояние запроса
      cardSystem.cardRequestState[userId] = { step: 'amount' };

      bot.sendMessage(chatId, '💰 <b>Введите сумму депозита:</b>', {
        parse_mode: 'HTML'
      });
    }

    // Кнопка "Проверить чек"
    if (data === 'card_check_status') {
      bot.answerCallbackQuery(query.id);

      // Получаем текущую карту пользователя
      cardSystem.getAllCards((err, cards) => {
        if (err || !cards || cards.length === 0) {
          sendNoCardsMessage(bot, chatId);
          return;
        }

        const currentIndex = userCardIndex[userId] || 0;
        const currentCard = cards[currentIndex];

        // Инициализируем состояние проверки чека для текущей карты
        cardSystem.checkSubmissionState[userId] = {
          step: 'file',
          card_id: currentCard.id
        };

        bot.sendMessage(chatId, '📸 <b>Отправьте фото чека или файл в формате PDF:</b>', {
          parse_mode: 'HTML'
        });
      });
    }

    // Кнопка "Уведомления" - пока заглушка
    if (data === 'card_notifications') {
      bot.answerCallbackQuery(query.id, {
        text: '🔔 Уведомления включены',
        show_alert: false
      });
    }

    // Кнопка "Обновить" - проверяет наличие реквизитов
    if (data === 'card_refresh') {
      bot.answerCallbackQuery(query.id);

      cardSystem.getAllCards((err, cards) => {
        if (err || !cards || cards.length === 0) {
          // Если реквизитов всё нет, обновляем сообщение с тем же текстом
          editNoCardsMessage(bot, chatId, query.message.message_id);
          return;
        }

        // Если реквизиты появились, показываем первую карту
        userCardIndex[userId] = 0;
        editCardMessage(bot, chatId, query.message.message_id, userId, cards);
      });
    }
  });
}

// Функция отправки сообщения с картой
function sendCardMessage(bot, chatId, userId, cards) {
  const index = userCardIndex[userId] || 0;
  const card = cards[index];

  const cardText = cardSystem.formatCardRequisite(card);
  const keyboard = createCardKeyboard(card, index, cards.length);

  bot.sendMessage(chatId, cardText, {
    parse_mode: 'HTML',
    reply_markup: keyboard
  });
}

// Функция редактирования сообщения с картой
function editCardMessage(bot, chatId, messageId, userId, cards) {
  const index = userCardIndex[userId] || 0;
  const card = cards[index];

  const cardText = cardSystem.formatCardRequisite(card);
  const keyboard = createCardKeyboard(card, index, cards.length);

  bot.editMessageText(cardText, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'HTML',
    reply_markup: keyboard
  }).catch(err => {
    // Игнорируем ошибку "message is not modified"
    if (!err.message.includes('message is not modified')) {
      console.error('Error editing card message:', err);
    }
  });
}

// Функция создания клавиатуры для карты
function createCardKeyboard(card, currentIndex, totalCards) {
  const genderEmoji = cardSystem.getGenderEmoji(card.gender);
  const countryFlag = cardSystem.getCountryFlag(card.country);

  return {
    inline_keyboard: [
      [
        { text: '🔔 Уведомления', callback_data: 'card_notifications' }
      ],
      [
        { text: '🔍 Проверить чек', callback_data: 'card_check_status' }
      ],
      [
        { text: '💳 Запросить реквизит', callback_data: 'card_request' }
      ],
      [
        { text: '◀️', callback_data: 'card_nav_left' },
        { text: `${genderEmoji} | ${countryFlag}`, callback_data: 'card_info' },
        { text: '▶️', callback_data: 'card_nav_right' }
      ]
    ]
  };
}

// Функция отправки сообщения об отсутствии реквизитов
function sendNoCardsMessage(bot, chatId) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: 'Запросить реквизит💳', callback_data: 'card_request' }
      ],
      [
        { text: '🔄Обновить', callback_data: 'card_refresh' }
      ]
    ]
  };

  bot.sendMessage(chatId, '⏰Общие реквизиты временно отсутствуют', {
    parse_mode: 'HTML',
    reply_markup: keyboard
  });
}

// Функция редактирования сообщения об отсутствии реквизитов
function editNoCardsMessage(bot, chatId, messageId) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: 'Запросить реквизит💳', callback_data: 'card_request' }
      ],
      [
        { text: '🔄Обновить', callback_data: 'card_refresh' }
      ]
    ]
  };

  bot.editMessageText('⏰Общие реквизиты временно отсутствуют', {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'HTML',
    reply_markup: keyboard
  }).catch(err => {
    // Игнорируем ошибку "message is not modified"
    if (!err.message.includes('message is not modified')) {
      console.error('Error editing no-cards message:', err);
    }
  });
}

module.exports = { setupCardViewHandlers, userCardIndex };
