const db = require('./database');
const { topExclusionWhere } = require('./utils');
const fs = require('fs');
const path = require('path');

// URL мини-аппа AXE PASS из .env. Кэш 30с: перезапущенный туннель подхватывается,
// но .env не читается с диска при каждом обновлении закрепа.
const BATTLEPASS_CACHE_TTL = 30000;
let battlePassCache = { url: null, at: 0 };

function getBattlePassUrl() {
  const now = Date.now();
  if (battlePassCache.url !== null && now - battlePassCache.at < BATTLEPASS_CACHE_TTL) {
    return battlePassCache.url;
  }

  try {
    const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const m = env.match(/^BATTLEPASS_URL=(.*)$/m);
    let url = '';
    if (m && /^https:\/\//.test(m[1].trim())) url = m[1].trim();
    battlePassCache = { url, at: now };
    return url;
  } catch (e) { /* .env нет — пункт без ссылки */ }
  battlePassCache = { url: '', at: now };
  return '';
}

let pinnedMessageId = null;

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function savePinnedMessageId(messageId) {
  pinnedMessageId = messageId;
  await dbRun('INSERT OR REPLACE INTO stats (key, value) VALUES (?, ?)', ['pinned_message_id', String(messageId)])
    .catch((err) => console.error('Error saving pinned message ID:', err));
}

async function loadPinnedMessageId() {
  try {
    const row = await dbGet('SELECT value FROM stats WHERE key = ?', ['pinned_message_id']);
    pinnedMessageId = row ? parseInt(row.value, 10) : null;
    console.log('📌 Загружен ID закрепленного сообщения:', pinnedMessageId);
  } catch (error) {
    console.error('Error loading pinned message ID:', error);
  }
}

async function findCurrentPinnedMessageId(bot, chatId) {
  try {
    const chat = await bot.getChat(chatId);
    const currentPinnedId = chat?.pinned_message?.message_id;

    if (currentPinnedId) {
      await savePinnedMessageId(currentPinnedId);
      console.log('📌 Использую текущий закреп из чата:', currentPinnedId);
      return currentPinnedId;
    }
  } catch (error) {
    console.error('Error getting current pinned message:', error.message);
  }

  return null;
}

async function getUsdRate() {
  try {
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const data = await response.json();
    return Math.round(data.rates.RUB);
  } catch (error) {
    console.error('Error fetching USD rate:', error);
    return 0;
  }
}

async function getDailyStats() {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const startStr = dayStart.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const endStr = dayEnd.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  const dailyRow = await dbGet(`
    SELECT COALESCE(SUM(p.amount), 0) AS daily_total
    FROM profits p
    WHERE p.created_at >= ? AND p.created_at < ?
  `, [startStr, endStr]);

  const topWorker = await dbGet(`
    SELECT u.user_id, u.username, u.name, SUM(p.amount) AS total_earned
    FROM users u
    JOIN profits p ON u.user_id = p.user_id
    WHERE p.created_at >= ? AND p.created_at < ?
      AND ${topExclusionWhere('u')}
    GROUP BY u.user_id
    HAVING total_earned > 0
    ORDER BY total_earned DESC
    LIMIT 1
  `, [startStr, endStr]);

  return {
    dailyTotal: Number(dailyRow?.daily_total || 0),
    topWorker
  };
}

const EXCLUDED_NAMES = ['#sss', '#Testovhik', '#тестик', 'тестик', '#testovhik', 'testovhik'];
const EXCLUDED_USERNAMES = ['sss', 'freeobnall'];

async function createPinnedMessageText() {
  const excludedNameList = EXCLUDED_NAMES.map(n => `'${n.replace(/'/g, "''")}'`).join(',');
  const excludedUserList = EXCLUDED_USERNAMES.map(n => `'${n.replace(/'/g, "''")}'`).join(',');
  const balanceRow = await dbGet(`SELECT SUM(amount) as total FROM profits p JOIN users u ON p.user_id = u.user_id WHERE LOWER(TRIM(COALESCE(u.name, ''))) NOT IN (${excludedNameList}) AND LOWER(TRIM(COALESCE(u.username, ''))) NOT IN (${excludedUserList})`);
  const projectBalance = parseInt(balanceRow?.total || '0', 10);
  const { dailyTotal, topWorker } = await getDailyStats();

  const usdRate = await getUsdRate();
  const botUsername = process.env.BOT_USERNAME || 'AXE_xBOT';
  const topWorkerName = topWorker && Number(topWorker.total_earned) > 0
    ? (topWorker.name && topWorker.name !== '#' ? topWorker.name : `@${topWorker.username}`)
    : '';
  const topWorkerLink = topWorker && Number(topWorker.total_earned) > 0
    ? `https://t.me/${botUsername}?start=profile_${topWorker.user_id}`
    : '';
  const topWorkerAmount = topWorker && Number(topWorker.total_earned) > 0
    ? Number(topWorker.total_earned).toLocaleString('ru-RU')
    : '0';

  const topWorkerLine = topWorker && Number(topWorker.total_earned) > 0
    ? `<b>🌶ТОП 1 ЗА СУТКИ</b> - <a href="${topWorkerLink}"><b>${topWorkerName}</b></a> - ${topWorkerAmount}₽`
    : '<b>🌶ТОП 1 ЗА СУТКИ</b> -';

  const battlePassUrl = getBattlePassUrl();

  return `<b>🌸AXE TEAM🌸</b>

<tg-emoji emoji-id="5258330865674494479">💰</tg-emoji><b>Касса проекта -</b> ${projectBalance.toLocaleString('ru-RU')}₽
<tg-emoji emoji-id="5258391025281408576">📊</tg-emoji><b>Касса за сутки -</b> ${dailyTotal.toLocaleString('ru-RU')}₽
<tg-emoji emoji-id="5897958754267174109">💵</tg-emoji><b>Курс USD/RUB:</b> ${usdRate}₽

${topWorkerLine}

<tg-emoji emoji-id="5807868868886009920">🏗️</tg-emoji><b>Инфраструктура</b>
┣<b>Основной бот -</b> <a href="https://t.me/AXE_xBot"><b>ССЫЛКА</b></a>
┣<b>Feedback</b> - <a href="https://t.me/FeedbackAXEbot"><b>ССЫЛКА</b></a>
┣<b>Материалы -</b> <a href="https://t.me/+GMixQrZvJkQ4ODE6"><b>ССЫЛКА</b></a>
┣<b>Профиты</b> - <a href="https://t.me/+euO9gzLMUMFhNmJi"><b>ССЫЛКА</b></a>
┣<b>AXE SMS -</b> <a href="https://t.me/AXE_SMS_xBot"><b>ССЫЛКА</b></a>
┗<b>AXE NEWS -</b> <a href="https://t.me/+BO1F4O1KUd0zZTI6"><b>ССЫЛКА</b></a>

<tg-emoji emoji-id="5931415565955503486">⌨️</tg-emoji><b>Команды чата</b>
┣<b>Топ -</b> <b>/top</b>
┣<b>Профиль -</b> <b>/me</b>
┣<b>Администрация -</b> <b>/staff</b>
┣<b>Материалы -</b> <b>/materials</b>
┗<b>Актуальный реквизит -</b> <b>/card</b>

<tg-emoji emoji-id="6008118472066732010">🎁</tg-emoji><b>Активные бонусы</b>
<b>1.</b> #AXE в нике аккаунта +3% к выплате профита.
<b>2.</b> Топ 1 суток +5% к выплате профита
<b>3.</b> ${battlePassUrl ? `<a href="${battlePassUrl}"><b>AXE PASS</b></a>` : '<b>AXE PASS</b>'}

<a href="https://t.me/boost?c=3986505552"><b>⚡️BOOST CHAT</b></a>

<b>AXE TEAM</b> - "Все великие достижения требовали времени."`;
}

async function editPinnedMessage(bot, chatId, messageId, messageText) {
  await bot.editMessageText(messageText, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  });
}

async function createPinnedMessage(bot, chatId, messageText) {
  const sentMessage = await bot.sendMessage(chatId, messageText, {
    parse_mode: 'HTML',
    disable_web_page_preview: true
  });

  await bot.pinChatMessage(chatId, sentMessage.message_id, { disable_notification: true });
  await savePinnedMessageId(sentMessage.message_id);
  console.log('✅ Закрепленное сообщение создано, ID:', sentMessage.message_id);
}

async function updatePinnedMessage(bot, GENERAL_CHAT_ID) {
  try {
    const messageText = await createPinnedMessageText();
    const targetPinnedId = pinnedMessageId || await findCurrentPinnedMessageId(bot, GENERAL_CHAT_ID);

    if (targetPinnedId) {
      try {
        await editPinnedMessage(bot, GENERAL_CHAT_ID, targetPinnedId, messageText);
        await savePinnedMessageId(targetPinnedId);
        console.log('✅ Закрепленное сообщение обновлено:', targetPinnedId);
        return;
      } catch (error) {
        if (error.message.includes('message is not modified')) {
          console.log('ℹ️ Закрепленное сообщение не изменилось');
          return;
        }

        const isMissing = error.message.includes('message to edit not found') || error.message.includes('message not found');
        if (!isMissing) {
          console.error('❌ Ошибка редактирования закрепа:', error.message);
          return;
        }
      }
    }

    const currentPinnedId = await findCurrentPinnedMessageId(bot, GENERAL_CHAT_ID);
    if (currentPinnedId) {
      await editPinnedMessage(bot, GENERAL_CHAT_ID, currentPinnedId, messageText);
      console.log('✅ Текущий закреп найден и обновлен:', currentPinnedId);
      return;
    }

    await createPinnedMessage(bot, GENERAL_CHAT_ID, messageText);
  } catch (error) {
    console.error('❌ Критическая ошибка в updatePinnedMessage:', error);
  }
}

module.exports = {
  loadPinnedMessageId,
  updatePinnedMessage
};
