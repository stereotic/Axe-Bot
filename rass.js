const db = require('./database');

const RASS_TIMES = ['07:00', '10:00', '13:00', '16:00', '19:00', '21:00', '00:00'];
const SEND_DELAY_MS = 90;
const DEFAULT_CHAT_TARGET = '-1003986505552';

const rassEdit = {};
const rassPanelMsg = {};
const lastCallback = {};

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

  const tagAtPos = [];

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
        openTag = '<blockquote expandable>'; closeTag = '</blockquote>'; break;
      default:
        continue;
    }

    tagAtPos.push({ pos: offset, tag: openTag, order: 0 });
    tagAtPos.push({ pos: offset + length, tag: closeTag, order: 1 });
  }

  tagAtPos.sort((a, b) => a.pos - b.pos || a.order - b.order);

  let result = '';
  let lastPos = 0;

  for (const t of tagAtPos) {
    if (t.pos > lastPos) {
      result += escapeHtml(text.slice(lastPos, t.pos));
    }
    result += t.tag;
    lastPos = t.pos;
  }

  if (lastPos < text.length) {
    result += escapeHtml(text.slice(lastPos));
  }

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

function sendBroadcastContent(bot, chatId, row) {
  const caption = row.text ? row.text : undefined;
  const opts = { parse_mode: 'HTML', disable_web_page_preview: true };

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
  const done = (success, fail) => {
    console.log(`[rass] ${row.time} → ${row.target === 'all' ? 'всем' : row.target}: ok=${success}, fail=${fail}`);
    db.run('UPDATE scheduled_broadcasts SET last_sent_date = ? WHERE id = ?', [today, row.id], (err) => {
      if (err) console.error('[rass] error updating last_sent_date:', err);
    });
  };

  if (row.target && row.target !== 'all') {
    sendBroadcastContent(bot, row.target, row).then(() => done(1, 0)).catch((e) => {
      console.error(`[rass] failed to send ${row.time} to ${row.target}:`, e.message);
      done(0, 1);
    });
    return;
  }

  db.all('SELECT user_id FROM users', (err, users) => {
    const recipients = (users || []).map(u => u.user_id);
    if (err || recipients.length === 0) return;

    let success = 0;
    let fail = 0;

    recipients.forEach((recipient, index) => {
      setTimeout(() => {
        sendBroadcastContent(bot, recipient, row).then(() => {
          success++;
        }).catch(() => {
          fail++;
        }).then(() => {
          if (index === recipients.length - 1) done(success, fail);
        });
      }, index * SEND_DELAY_MS);
    });
  });
}

function checkScheduledBroadcasts(bot) {
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (!RASS_TIMES.includes(hm)) return;

  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  db.all('SELECT * FROM scheduled_broadcasts WHERE time = ?', [hm], (err, rows) => {
    if (err || !rows || rows.length === 0) return;
    rows.forEach(row => {
      if (row.last_sent_date === today) return;
      sendScheduledRow(bot, row, today);
    });
  });
}

function isRassEditing(userId) {
  return Boolean(rassEdit[userId]);
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
  setInterval(() => checkScheduledBroadcasts(bot), 30000);

  console.log('📢 Система рассылок готова (время: ' + RASS_TIMES.join(', ') + ')');
}

module.exports = {
  setupRassSystem,
  isRassEditing,
  cancelRassEdit
};
