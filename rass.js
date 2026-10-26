const db = require('./database');

const RASS_TIMES = ['07:00', '10:00', '13:00', '16:00', '19:00', '21:00', '00:00'];
const SEND_DELAY_MS = 90;
const DEFAULT_CHAT_TARGET = '-1003986505552';

const rassEdit = {};
const rassPanelMsg = {};
const lastCallback = {};
const activeBroadcasts = new Set();
const retryAfter = new Map();
const RETRY_DELAY_MS = 5 * 60 * 1000;
let schedulerBootLogged = false;

function dedupeCallback(userId, data) {
  const key = `${userId}_${data}`;
  const now = Date.now();
  if (lastCallback[key] && now - lastCallback[key] < 800) return false;
  lastCallback[key] = now;
  return true;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function entitiesToHtml(text, entities) {
  if (!text) return '';
  if (!entities || !entities.length) return escapeHtml(text);

  const events = [];

  for (const entity of entities) {
    const offset = entity.offset;
    const length = entity.length;
    let openTag, closeTag;

    switch (entity.type) {
      case 'bold':
        openTag = '<b>'; closeTag = '</b>'; break;
      case 'italic':
        openTag = '<i>'; closeTag = '</i>'; break;
      case 'underline':
        openTag = '<u>'; closeTag = '</u>'; break;
      case 'strikethrough':
        openTag = '<s>'; closeTag = '</s>'; break;
      case 'code':
        openTag = '<code>'; closeTag = '</code>'; break;
      case 'pre':
        openTag = '<pre>'; closeTag = '</pre>'; break;
      case 'spoiler':
        openTag = '<tg-spoiler>'; closeTag = '</tg-spoiler>'; break;
      case 'text_link':
        openTag = `<a href="${escapeHtml(entity.url)}">`; closeTag = '</a>'; break;
      case 'text_mention':
        openTag = `<a href="tg://user?id=${entity.user.id}">`; closeTag = '</a>'; break;
      case 'custom_emoji':
        openTag = `<tg-emoji emoji-id="${entity.custom_emoji_id}">`; closeTag = '</tg-emoji>'; break;
      case 'blockquote':
        openTag = '<blockquote>'; closeTag = '</blockquote>'; break;
      case 'expandable_blockquote':
        openTag = '<blockquote>'; closeTag = '</blockquote>'; break;
      default:
        continue;
    }

    events.push({ pos: offset, open: true, tag: openTag, closeTag, entity });
    events.push({ pos: offset + length, open: false, tag: closeTag, entity });
  }

  // По позиции; на одной позиции закрытия идут раньше открытий.
  events.sort((a, b) => a.pos - b.pos || (a.open ? 1 : 0) - (b.open ? 1 : 0));

  const stack = [];
  let result = '';
  let lastPos = 0;

  for (const ev of events) {
    if (ev.pos > lastPos) {
      result += escapeHtml(text.slice(lastPos, ev.pos));
      lastPos = ev.pos;
    }

    if (ev.open) {
      result += ev.tag;
      stack.push(ev);
      continue;
    }

    let idx = -1;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].entity === ev.entity) { idx = i; break; }
    }
    if (idx === -1) continue;

    while (stack.length > idx) {
      result += stack.pop().closeTag;
    }
  }

  if (lastPos < text.length) result += escapeHtml(text.slice(lastPos));
  return result;
}

function buildRowFromMessage(msg) {
  if (msg.photo) {
    return {
      content_type: 'photo',
      file_id: msg.photo[msg.photo.length - 1].file_id,
      text: entitiesToHtml(msg.caption, msg.caption_entities)
    };
  }
  if (msg.animation) {
    return {
      content_type: 'animation',
      file_id: msg.animation.file_id,
      text: entitiesToHtml(msg.caption, msg.caption_entities)
    };
  }
  if (msg.video) {
    return {
      content_type: 'video',
      file_id: msg.video.file_id,
      text: entitiesToHtml(msg.caption, msg.caption_entities)
    };
  }
  if (msg.document) {
    return {
      content_type: 'document',
      file_id: msg.document.file_id,
      text: entitiesToHtml(msg.caption, msg.caption_entities)
    };
  }
  if (msg.sticker) {
    return {
      content_type: 'sticker',
      file_id: msg.sticker.file_id,
      text: null
    };
  }
  if (msg.video_note) {
    return {
      content_type: 'video_note',
      file_id: msg.video_note.file_id,
      text: null
    };
  }
  if (msg.audio) {
    return {
      content_type: 'audio',
      file_id: msg.audio.file_id,
      text: entitiesToHtml(msg.caption, msg.caption_entities)
    };
  }
  if (msg.voice) {
    return {
      content_type: 'voice',
      file_id: msg.voice.file_id,
      text: entitiesToHtml(msg.caption, msg.caption_entities)
    };
  }
  if (msg.text) {
    return {
      content_type: 'text',
      file_id: null,
      text: entitiesToHtml(msg.text, msg.entities)
    };
  }
  return null;
}

function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/blockquote\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(parseInt(value, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function sendBroadcastContent(bot, chatId, row, useHtml = true) {
  const caption = row.text ? row.text : undefined;
  const opts = useHtml
    ? { parse_mode: 'HTML', disable_web_page_preview: true }
    : { disable_web_page_preview: true };

  if (row.content_type === 'photo') {
    return bot.sendPhoto(chatId, row.file_id, caption ? { ...opts, caption } : opts);
  }
  if (row.content_type === 'video') {
    return bot.sendVideo(chatId, row.file_id, caption ? { ...opts, caption } : opts);
  }
  if (row.content_type === 'animation') {
    return bot.sendAnimation(chatId, row.file_id, caption ? { ...opts, caption } : opts);
  }
  if (row.content_type === 'document') {
    return bot.sendDocument(chatId, row.file_id, caption ? { ...opts, caption } : opts);
  }
  if (row.content_type === 'sticker') {
    return bot.sendSticker(chatId, row.file_id);
  }
  if (row.content_type === 'video_note') {
    return bot.sendVideoNote(chatId, row.file_id);
  }
  if (row.content_type === 'audio') {
    return bot.sendAudio(chatId, row.file_id, caption ? { ...opts, caption } : opts);
  }
  if (row.content_type === 'voice') {
    return bot.sendVoice(chatId, row.file_id, caption ? { ...opts, caption } : opts);
  }
  if (row.content_type === 'text' && row.text) {
    return bot.sendMessage(chatId, row.text, opts);
  }
  return Promise.resolve();
}

async function sendBroadcastContentReliable(bot, chatId, row) {
  try {
    return await sendBroadcastContent(bot, chatId, row, true);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (!message.includes("can't parse entities")) throw error;

    console.warn(`[rass] ${row.time} invalid HTML; retrying without parse_mode: ${message}`);
    return sendBroadcastContent(bot, chatId, {
      ...row,
      text: htmlToPlainText(row.text)
    }, false);
  }
}

function renderPanel(bot, chatId, userId) {
  db.all('SELECT * FROM scheduled_broadcasts', (err, rows) => {
    if (err) {
      bot.sendMessage(chatId, '❌ Ошибка получения рассылок');
      return;
    }

    const byTime = {};
    (rows || []).forEach(r => { byTime[r.time] = r; });

    let text = '📢 <b>Рассылки</b>\n\n';
    text += RASS_TIMES.map(t => {
      const r = byTime[t];
      const status = r && r.content_type ? '✅' : '⏰';
      const targetMark = r && r.target && r.target !== 'all' ? ' 💬' : '';
      return `${t} ${status}${targetMark}`;
    }).join('\n');
    text += '\n\n<b>время</b> — посмотреть сообщение, <b>✏️</b> — изменить, <b>❌</b> — удалить';

    const keyboard = { inline_keyboard: [] };
    RASS_TIMES.forEach(t => {
      const r = byTime[t];
      const status = r && r.content_type ? '✅' : '⏰';
      keyboard.inline_keyboard.push([
        { text: `${t} ${status}`, callback_data: `rass_sel_${t}` },
        { text: '✏️', callback_data: `rass_edit_${t}` },
        { text: '❌', callback_data: `rass_del_${t}` }
      ]);
    });

    const opts = { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: keyboard };

    if (rassPanelMsg[userId]) {
      bot.editMessageText(text, { chat_id: chatId, message_id: rassPanelMsg[userId], ...opts }).catch((e) => {
        console.error('[rass] panel edit failed:', e.message);
        bot.sendMessage(chatId, text, opts).then(m => {
          rassPanelMsg[userId] = m.message_id;
        }).catch((e2) => console.error('[rass] panel send failed:', e2.message));
      });
    } else {
      bot.sendMessage(chatId, text, opts).then(m => {
        rassPanelMsg[userId] = m.message_id;
      }).catch((e) => console.error('[rass] panel send failed:', e.message));
    }
  });
}

function startContentEdit(bot, chatId, userId, time) {
  rassEdit[userId] = { time, step: 'content' };

  db.get('SELECT * FROM scheduled_broadcasts WHERE time = ?', [time], (err, row) => {
    if (!err && row && row.content_type) {
      bot.sendMessage(chatId, `✏️ Текущее сообщение рассылки в <b>${time}</b>. Отправь новое вместо него:`, { parse_mode: 'HTML' }).then(() => {
        sendBroadcastContent(bot, chatId, row).catch(() => {});
      }).catch(() => {});
    } else {
      bot.sendMessage(chatId, `✏️ Отправь сообщение для рассылки в <b>${time}</b>.\n\nПоддерживаются: текст (с форматированием), фото, гифки, видео, документ, стикер, кружок, аудио, голос.\nОтмена: /cancel`, { parse_mode: 'HTML' }).catch(() => {});
    }
  });
}

function askTarget(bot, chatId, userId, time) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '👥 Всем пользователям', callback_data: `rass_tgt_all_${time}` },
        { text: '💬 Только в чат', callback_data: `rass_tgt_chat_${time}` }
      ],
      [{ text: '⏭ Решу позже', callback_data: `rass_tgt_later_${time}` }]
    ]
  };
  bot.sendMessage(chatId, `📥 Сообщение для рассылки в <b>${time}</b> сохранено.\n\nКуда отправить?`, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
}

function sendScheduledRow(bot, row, today) {
  // Не отмечаем слот отправленным заранее. Иначе краткий обрыв Telegram
  // превращает неудачную попытку в окончательно пропущенную рассылку.
  if (activeBroadcasts.has(row.id)) return;
  activeBroadcasts.add(row.id);

  const commit = (success, fail) => {
    retryAfter.delete(row.id);
    db.run('UPDATE scheduled_broadcasts SET last_sent_date = ? WHERE id = ?', [today, row.id], (err) => {
      if (err) {
        console.error(`[rass] ${row.time} delivered but commit failed:`, err);
        return;
      }
      console.log(`[rass] ${row.time} → ${row.target === 'all' ? 'всем' : row.target}: ok=${success}, fail=${fail}, committed=${today}`);
    });
  };

  const retry = (reason) => {
    retryAfter.set(row.id, Date.now() + RETRY_DELAY_MS);
    console.error(`[rass] ${row.time} not committed; retry in 5 min: ${reason}`);
  };

  if (row.target && row.target !== 'all') {
    sendBroadcastContentReliable(bot, row.target, row).then(() => commit(1, 0)).catch((e) => {
      console.error(`[rass] failed to send ${row.time} to ${row.target}:`, e.message);
      retry(e.message);
    }).finally(() => activeBroadcasts.delete(row.id));
    return;
  }

  db.all('SELECT user_id FROM users', (err, users) => {
    const recipients = (users || []).map(u => u.user_id);
    if (err || recipients.length === 0) {
      retry(err ? err.message : 'recipient list is empty');
      activeBroadcasts.delete(row.id);
      return;
    }

    let success = 0;
    let fail = 0;
    let completed = 0;

    const finishOne = () => {
      completed++;
      if (completed !== recipients.length) return;
      activeBroadcasts.delete(row.id);
      if (success > 0) commit(success, fail);
      else retry(`all ${fail} deliveries failed`);
    };

    recipients.forEach((recipient, index) => {
      setTimeout(() => {
        sendBroadcastContentReliable(bot, recipient, row)
          .then(() => { success++; })
          .catch((error) => {
            fail++;
            if (fail <= 3) console.error(`[rass] ${row.time} failed for ${recipient}:`, error.message);
          })
          .finally(finishOne);
      }, index * SEND_DELAY_MS);
    });
  });
}

function hmToMinutes(hm) {
  const [h, m] = String(hm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function slotDelayLimit(hm) {
  const current = hmToMinutes(hm);
  const ordered = RASS_TIMES.map(hmToMinutes).sort((a, b) => a - b);
  const next = ordered.find(value => value > current);
  return (next === undefined ? 24 * 60 : next) - current - 1;
}

function checkScheduledBroadcasts(bot) {
  const { hm, today } = moscowTimeParts();
  const nowMin = hmToMinutes(hm);

  db.all('SELECT * FROM scheduled_broadcasts', (err, rows) => {
    if (err) {
      console.error('[rass] scheduler database error:', err);
      return;
    }
    if (!rows || !rows.length) {
      if (!schedulerBootLogged) console.warn(`[rass] scheduler tick ${today} ${hm}: no configured rows`);
      schedulerBootLogged = true;
      return;
    }

    if (!schedulerBootLogged) {
      const pending = rows
        .filter(row => RASS_TIMES.includes(row.time) && row.content_type && row.last_sent_date !== today)
        .map(row => row.time)
        .join(', ') || 'none';
      console.log(`[rass] scheduler tick ${today} ${hm} Europe/Moscow: rows=${rows.length}, pending=${pending}`);
      schedulerBootLogged = true;
    }
    rows.forEach(row => {
      if (!RASS_TIMES.includes(row.time)) return;
      if (!row.content_type) return;
      if (row.last_sent_date === today) return;
      if (activeBroadcasts.has(row.id)) return;
      if ((retryAfter.get(row.id) || 0) > Date.now()) return;

      // Не «минута в минуту», а окно: слот считается наступившим и не
      // пропускается, если тик на точной минуте был пропущен.
      const delayMin = nowMin - hmToMinutes(row.time);
      if (delayMin < 0 || delayMin > slotDelayLimit(row.time)) return;
      if (delayMin > 0) console.log(`[rass] ${row.time} догоняющая отправка (+${delayMin} мин)`);

      sendScheduledRow(bot, row, today);
    });
  });
}

function isRassEditing(userId) {
  return Boolean(rassEdit[userId]);
}

// Текущее время по Москве (UTC+3). Сервер может жить в UTC — иначе
// рассылки уходили со сдвигом. Отдельный метод, чтобы не пробрасывать
// TZ через env: проект целиком в московском поясе.
function moscowTimeParts() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour12: false,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    hm: `${get('hour')}:${get('minute')}`,
    today: `${get('year')}-${get('month')}-${get('day')}`
  };
}

function cancelRassEdit(userId) {
  if (rassEdit[userId]) {
    delete rassEdit[userId];
    return true;
  }
  return false;
}

function setupRassSystem(bot, adminIds) {
  // Команда /rass - управление рассылками (только для админов)
  bot.onText(/\/rass/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!adminIds.includes(userId)) {
      bot.sendMessage(chatId, '❌ У вас нет прав администратора');
      return;
    }

    if (msg.chat.type !== 'private') {
      bot.sendMessage(chatId, '❌ Эта команда работает только в личных сообщениях с ботом');
      return;
    }

    renderPanel(bot, chatId, userId);
  });

  // Обработка сообщений в режиме редактирования рассылки
  bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const state = rassEdit[userId];

    if (!state || msg.chat.type !== 'private' || !adminIds.includes(userId)) return;
    if (msg.text && msg.text.startsWith('/')) return;

    if (state.step === 'content') {
      const row = buildRowFromMessage(msg);
      if (!row) {
        bot.sendMessage(chatId, '❌ Неподдерживаемый тип сообщения. Отправь текст, фото, видео или документ.');
        return;
      }

      db.run(`INSERT INTO scheduled_broadcasts (time, content_type, text, file_id, target)
              VALUES (?, ?, ?, ?, 'all')
              ON CONFLICT(time) DO UPDATE SET
                content_type = excluded.content_type,
                text = excluded.text,
                file_id = excluded.file_id`,
        [state.time, row.content_type, row.text, row.file_id], (err) => {
          if (err) {
            console.error('[rass] error saving broadcast:', err);
            bot.sendMessage(chatId, '❌ Ошибка сохранения рассылки');
            return;
          }
          console.log(`[rass] ${state.time} content saved (${row.content_type})`);
          state.step = 'target';
          askTarget(bot, chatId, userId, state.time);
        });
    }
  });

  // Обработка кнопок панели рассылок
  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data || '';

    if (!data.startsWith('rass_')) return;
    if (!adminIds.includes(userId)) return;

    const sep = data.lastIndexOf('_');
    const action = data.slice(5, sep);
    const time = data.slice(sep + 1);

    if (!dedupeCallback(userId, data)) return;

    // Посмотреть текущее сообщение
    if (action === 'sel') {
      db.get('SELECT * FROM scheduled_broadcasts WHERE time = ?', [time], (err, row) => {
        if (err || !row || !row.content_type) {
          bot.sendMessage(chatId, `⏰ <b>${time}</b> — сообщение ещё не задано. Нажми ✏️.`, { parse_mode: 'HTML' });
          return;
        }
        sendBroadcastContent(bot, chatId, row).catch(() => {});
      });
      return;
    }

    // Редактировать
    if (action === 'edit') {
      startContentEdit(bot, chatId, userId, time);
      return;
    }

    // Удалить
    if (action === 'del') {
      db.run('DELETE FROM scheduled_broadcasts WHERE time = ?', [time], (err) => {
        if (!err) bot.sendMessage(chatId, `❌ Рассылка <b>${time}</b> удалена.`, { parse_mode: 'HTML' });
        renderPanel(bot, chatId, userId);
      });
      return;
    }

    // Цель: все пользователи
    if (action === 'tgt_all') {
      db.run('UPDATE scheduled_broadcasts SET target = ? WHERE time = ?', ['all', time], (err) => {
        delete rassEdit[userId];
        if (!err) bot.sendMessage(chatId, `✅ Рассылка в <b>${time}</b> — всем пользователям.`, { parse_mode: 'HTML' });
        renderPanel(bot, chatId, userId);
      });
      return;
    }

    // Цель: чат
    if (action === 'tgt_chat') {
      db.run('UPDATE scheduled_broadcasts SET target = ? WHERE time = ?', [DEFAULT_CHAT_TARGET, time], (err) => {
        delete rassEdit[userId];
        if (err) {
          console.error('[rass] error saving target:', err);
          bot.sendMessage(chatId, '❌ Ошибка сохранения цели');
          return;
        }
        bot.sendMessage(chatId, `✅ Рассылка в <b>${time}</b> будет отправлена только в чат <b>${DEFAULT_CHAT_TARGET}</b>.`, { parse_mode: 'HTML' });
        renderPanel(bot, chatId, userId);
      });
      return;
    }

    // Цель: позже
    if (action === 'tgt_later') {
      delete rassEdit[userId];
      bot.sendMessage(chatId, `⏭ Рассылка в <b>${time}</b> сохранена, цель — по умолчанию всем пользователям.`, { parse_mode: 'HTML' });
      renderPanel(bot, chatId, userId);
      return;
    }
  });

  // Планировщик рассылок - проверка каждые 30 секунд
  // Проверяем сразу после старта: рестарт на границе слота не должен ждать
  // первого интервального тика или терять рассылку.
  checkScheduledBroadcasts(bot);
  setInterval(() => checkScheduledBroadcasts(bot), 30000);

  console.log('📢 Система рассылок готова (время: ' + RASS_TIMES.join(', ') + ')');
}

module.exports = {
  setupRassSystem,
  isRassEditing,
  cancelRassEdit,
  hmToMinutes,
  slotDelayLimit,
  htmlToPlainText
};
