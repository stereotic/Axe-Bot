// profit_system.js
// ID каналов (синхронизированы с bot.js)
const ACCOUNTING_CHAT_ID = '-1003606797013';
const CASH_CHANNEL_ID = '-1003924744333';
const GENERAL_CHAT_ID = '-1003986505552';

// Обработка send_profit_* (и send_profit_accounting_*) полностью живёт в bot.js
// с idempotency-защитой (profit._saved / profit._sent). Раньше здесь висел
// отдельный слушатель callback_query на send_profit_ — он дублировал сохранение
// профита в БД и рассылку (двойной INSERT в profits, двойная накрутка
// balance/total_earned/profit_count, двойной updateProjectStats). Удалён, чтобы
// любая кнопка send_profit_ обрабатывалась ровно один раз.
function setupProfitSystem() {}

module.exports = { setupProfitSystem, ACCOUNTING_CHAT_ID, CASH_CHANNEL_ID, GENERAL_CHAT_ID };
