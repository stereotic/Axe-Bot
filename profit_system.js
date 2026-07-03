require('dotenv').config();
const db = require('./database');
const utils = require('./utils');
const { updatePinnedMessage } = require('./update_pinned');

// ID каналов (синхронизированы с bot.js)
const ACCOUNTING_CHAT_ID = '-1003606797013';
const CASH_CHANNEL_ID = '-1003924744333';
const GENERAL_CHAT_ID = '-1003986505552';

function setupProfitSystem(bot, adminIds) {
  // Обработка подтверждения отправки профита (send_profit_ — без _accounting_)
  bot.on('callback_query', (query) => {
    const data = query.data;
    const chatId = query.message.chat.id;

    if (data.startsWith('send_profit_') && !data.startsWith('send_profit_accounting_') && !data.startsWith('send_public_')) {
      const profitId = data.replace('send_profit_', '');
      const profit = global.profitData ? global.profitData[profitId] : null;

      if (!profit) {
        bot.answerCallbackQuery(query.id, { text: '❌ Данные профита не найдены' });
        return;
      }

      bot.answerCallbackQuery(query.id);

      db.run('INSERT INTO profits (user_id, amount, amount_to_pay, direction) VALUES (?, ?, ?, ?)',
        [profit.userId, profit.amount, profit.workerPayout, profit.direction],
        function(err) {
          if (err) {
            bot.sendMessage(chatId, '❌ Ошибка сохранения профита');
            console.error('Error saving profit:', err);
            return;
          }

          const dbProfitId = this.lastID;

          for (const [role, amount] of Object.entries(profit.shares)) {
            db.run('INSERT INTO profit_shares (profit_id, role, percentage, amount) VALUES (?, ?, ?, ?)',
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
                utils.updateWorkerStatus(profit.userId, (err) => {
                  if (err) console.error('Error updating status:', err);
                });
              }
            }
          );

          utils.updateProjectStats(profit.amount, (err) => {
            if (err) console.error('Error updating project stats:', err);
          });

          updatePinnedMessage(bot, GENERAL_CHAT_ID).catch(err => console.error('Error updating pinned message:', err));

          const accountingText = `<b>🚀${profit.directionName}
<tg-emoji emoji-id="5920344347152224466">👤</tg-emoji>Воркер: @${profit.username}
💸Сумма профита: ${utils.formatAmount(profit.amount)}₽
<tg-emoji emoji-id="5258204546391351475">💼</tg-emoji>К выплате: ${utils.formatAmount(profit.workerPayout)}₽
👑Владелец: ${utils.PROFIT_SHARES.owner}% - ${utils.formatAmount(profit.shares.owner)}₽
👔Администратор: ${utils.PROFIT_SHARES.admin}% - ${utils.formatAmount(profit.shares.admin)}₽
🍌Инвестор: ${utils.PROFIT_SHARES.investor}% - ${utils.formatAmount(profit.shares.investor)}₽
🧑‍💻Кодер: ${utils.PROFIT_SHARES.coder}% - ${utils.formatAmount(profit.shares.coder)}₽</b>`;

          bot.sendMessage(ACCOUNTING_CHAT_ID, accountingText, { parse_mode: 'HTML' }).catch((err) => {
            console.error('Error sending to accounting:', err);
          });

          const profileLink = `https://t.me/${process.env.BOT_USERNAME || 'AXE_xBOT'}?start=profile_${profit.userId}`;
          let publicText = `<b>🌸УСПЕШНЫЙ ПРОФИТ🌸${profit.mammothCount ? `\n┗ X${profit.mammothCount}` : ''}

<tg-emoji emoji-id="5287744906251510022">🏠</tg-emoji>Сервис: ${profit.directionName}
┣<tg-emoji emoji-id="5936017305585586269">👤</tg-emoji>Воркер: <a href="${profileLink}">${profit.name}</a>`;

          if (profit.direction === 1 && profit.curator) {
            publicText += `\n┣<tg-emoji emoji-id="5769403330761593044">💸</tg-emoji>Сумма: ${utils.formatAmount(profit.amount)}₽\n┗👨‍🏫Куратор: @${profit.curator}</b>`;
          } else {
            publicText += `\n┗<tg-emoji emoji-id="5769403330761593044">💸</tg-emoji>Сумма: ${utils.formatAmount(profit.amount)}₽</b>`;
          }

          const publicKeyboard = {
            inline_keyboard: [
              [{ text: 'Отправить', callback_data: `send_public_${profitId}` }]
            ]
          };

          bot.sendMessage(chatId, publicText, { parse_mode: 'HTML', reply_markup: publicKeyboard });

          bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
        }
      );
    }
  });
}

module.exports = { setupProfitSystem, ACCOUNTING_CHAT_ID, CASH_CHANNEL_ID, GENERAL_CHAT_ID };
