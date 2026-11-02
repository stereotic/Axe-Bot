const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
const statusChats = require('../status_chats');

test('info panel offers only the PRO status chat', () => {
  const locked = statusChats.buildInfoKeyboard('NEW').inline_keyboard;
  const unlocked = statusChats.buildInfoKeyboard('PRO').inline_keyboard;

  assert.deepEqual(locked[1], [{
    text: 'PRO чат',
    icon_custom_emoji_id: '5451849211425367548',
    callback_data: 'chat_locked_newpro'
  }]);
  assert.deepEqual(unlocked[1], [{
    text: 'PRO чат',
    icon_custom_emoji_id: '5451849211425367548',
    url: statusChats.STATUS_CHATS.find((chat) => chat.key === 'newpro').link
  }]);
  assert.deepEqual(unlocked.map((row) => row.map((button) => button.text)), [
    ['Общий чат'],
    ['PRO чат'],
    ['Профиты', 'Новости'],
    ['Материалы'],
    ['Меню']
  ]);
  assert.equal(unlocked[3][0].icon_custom_emoji_id, '5451805523018033441');
  assert.equal(locked.length, 5);
  assert.equal(unlocked.length, 5);
});

test('PRO unlock notification includes the chat link and skips other status chats', async () => {
  const originalAll = db.all;
  const originalRun = db.run;
  const sent = [];
  const recorded = [];

  db.all = (_sql, _params, callback) => callback(null, []);
  db.run = (_sql, params, callback) => {
    recorded.push(params[1]);
    callback(null);
  };

  try {
    await statusChats.sendPendingUnlocks({
      sendMessage: async (_userId, _text, options) => { sent.push(options); }
    }, 123, 'GG');
  } finally {
    db.all = originalAll;
    db.run = originalRun;
  }

  assert.deepEqual(recorded, ['newpro']);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].reply_markup.inline_keyboard, [[{
    text: 'Вступить в PRO чат',
    url: statusChats.STATUS_CHATS.find((chat) => chat.key === 'newpro').link
  }]]);
});
