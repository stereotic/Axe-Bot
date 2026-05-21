require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');
const utils = require('./utils');
const { updatePinnedMessage } = require('./update_pinned');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// ID каналов
const ACCOUNTING_CHAT_ID = '-1002394699502'; // Бухгалтерия
const CASH_CHANNEL_ID = '-1002359068457'; // Общая касса
const GENERAL_CHAT_ID = '-1002476088150'; // Общий чат

// Временное хранилище для данных профита
const profitData = {};

// Команда для публикации профита: username сумма направление
// Пример: @username 10000 1
bot.onText(/^([^\s]+)\s+(\d+)₽?\s+([12])$/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Проверяем что это админ (можно добавить проверку)
  const workerUsername = match[1].replace('@', '');
  const amount = parseInt(match[2]);
  const direction = parseInt(match[3]);

  if (!workerUsername || !amount || ![1, 2].includes(direction)) {
    bot.sendMessage(chatId, '❌ Неверный формат. Используйте: username сумма направление\nПример: username 10000 1');
    return;
  }

  // Ищем воркера
  db.get('SELECT * FROM users WHERE username = ?', [workerUsername], (err, user) => {
    if (err || !user) {
      bot.sendMessage(chatId, '❌ Воркер не найден');
      return;
    }

    // Рассчитываем суммы
    const workerPayout = utils.calculateWorkerPayout(amount, direction);
    const shares = utils.calculateProfitShares(amount);
    const directionName = utils.getDirectionName(direction);
    const directionPercent = utils.DIRECTION_PERCENTAGES[direction];

    // Сохраняем данные для подтверждения
    const profitId = `${user.user_id}_${Date.now()}`;
    profitData[profitId] = {
      userId: user.user_id,
      username: user.username,
      name: user.name,
      amount: amount,
      workerPayout: workerPayout,
      direction: direction,
      directionName: directionName,
      shares: shares
    };

    // Формируем сообщение для бухгалтерии
    const accountingText = `🚀${directionName}
👤Воркер: @${user.username}
💸Сумма профита: ${utils.formatAmount(amount)}₽
💼К выплате: ${utils.formatAmount(workerPayout)}₽ (${directionPercent}%)
👑Владелец: ${utils.PROFIT_SHARES.owner}% - ${utils.formatAmount(shares.owner)}₽
👔Администратор: ${utils.PROFIT_SHARES.admin}% - ${utils.formatAmount(shares.admin)}₽
🍌Инвестор: ${utils.PROFIT_SHARES.investor}% - ${utils.formatAmount(shares.investor)}₽
🧑‍💻Кодер: ${utils.PROFIT_SHARES.coder}% - ${utils.formatAmount(shares.coder)}₽`;

    const keyboard = {
      inline_keyboard: [
        [{ text: '✅Отправить', callback_data: `send_profit_${profitId}` }]
      ]
    };

    bot.sendMessage(chatId, accountingText, { reply_markup: keyboard });
  });
  return true; // Предотвращаем дальнейшую обработку
});

// Обработка подтверждения отправки профита
bot.on('callback_query', (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;

  if (data.startsWith('send_profit_')) {
    const profitId = data.replace('send_profit_', '');
    const profit = profitData[profitId];

    if (!profit) {
      bot.answerCallbackQuery(query.id, { text: '❌ Данные профита не найдены' });
      return;
    }

    bot.answerCallbackQuery(query.id);

    // Сохраняем профит в БД
    db.run('INSERT INTO profits (user_id, amount, amount_to_pay, direction) VALUES (?, ?, ?, ?)',
      [profit.userId, profit.amount, profit.workerPayout, profit.direction],
      function(err) {
        if (err) {
          bot.sendMessage(chatId, '❌ Ошибка сохранения профита');
          console.error('Error saving profit:', err);
          return;
        }

        const dbProfitId = this.lastID;

        // Сохраняем доли
        for (const [role, amount] of Object.entries(profit.shares)) {
          db.run('INSERT INTO profit_shares (profit_id, role, percentage, amount) VALUES (?, ?, ?, ?)',
            [dbProfitId, role, utils.PROFIT_SHARES[role], amount],
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
          [profit.workerPayout, profit.amount, profit.userId],
          (err) => {
            if (err) {
              console.error('Error updating user:', err);
            } else {
              // Обновляем статус воркера
              utils.updateWorkerStatus(profit.userId, (err) => {
                if (err) console.error('Error updating status:', err);
              });
            }
          }
        );

        // Обновляем статистику проекта
        utils.updateProjectStats(profit.amount, (err) => {
          if (err) console.error('Error updating project stats:', err);
        });

        // Обновляем закрепленное сообщение
        updatePinnedMessage(bot, GENERAL_CHAT_ID).catch(err => console.error('Error updating pinned message:', err));

        // Отправляем в бухгалтерию
        const accountingText = `🚀${profit.directionName}
👤Воркер: @${profit.username}
💸Сумма профита: ${utils.formatAmount(profit.amount)}₽
💼К выплате: ${utils.formatAmount(profit.workerPayout)}₽
👑Владелец: ${utils.PROFIT_SHARES.owner}% - ${utils.formatAmount(profit.shares.owner)}₽
👔Администратор: ${utils.PROFIT_SHARES.admin}% - ${utils.formatAmount(profit.shares.admin)}₽
🍌Инвестор: ${utils.PROFIT_SHARES.investor}% - ${utils.formatAmount(profit.shares.investor)}₽
🧑‍💻Кодер: ${utils.PROFIT_SHARES.coder}% - ${utils.formatAmount(profit.shares.coder)}₽`;

        bot.sendMessage(ACCOUNTING_CHAT_ID, accountingText).catch((err) => {
          console.error('Error sending to accounting:', err);
        });

        // Формируем сообщение для общей кассы и чата
        const publicText = `🌸УСПЕШНЫЙ ПРОФИТ🌸

🏠Сервис: ${profit.directionName}
┣👤Воркер: ${profit.name}
┗💸Сумма: ${utils.formatAmount(profit.amount)}₽`;

        const publicKeyboard = {
          inline_keyboard: [
            [{ text: '✅Отправить', callback_data: `send_public_${profitId}` }]
          ]
        };

        bot.sendMessage(chatId, publicText, { reply_markup: publicKeyboard });

        // Удаляем предыдущее сообщение
        bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
      }
    );
  }

  if (data.startsWith('send_public_')) {
    const profitId = data.replace('send_public_', '');
    const profit = profitData[profitId];

    if (!profit) {
      bot.answerCallbackQuery(query.id, { text: '❌ Данные профита не найдены' });
      return;
    }

    bot.answerCallbackQuery(query.id);

    const publicText = `🌸УСПЕШНЫЙ ПРОФИТ🌸

🏠Сервис: ${profit.directionName}
┣👤Воркер: ${profit.name}
┗💸Сумма: ${utils.formatAmount(profit.amount)}₽`;

    // Отправляем в общую кассу
    bot.sendMessage(CASH_CHANNEL_ID, publicText).catch((err) => {
      console.error('Error sending to cash channel:', err);
    });

    // Отправляем в общий чат
    bot.sendMessage(GENERAL_CHAT_ID, publicText).catch((err) => {
      console.error('Error sending to general chat:', err);
    });

    // Обновляем закрепленное сообщение
    updatePinnedMessage(bot, GENERAL_CHAT_ID).catch(err => console.error('Error updating pinned message:', err));

    bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
    bot.sendMessage(chatId, '✅ Профит успешно опубликован!');

    // Очищаем данные
    delete profitData[profitId];
  }
});

console.log('💰 Система профитов запущена...');
