const test = require('node:test');
const assert = require('node:assert/strict');
const { hmToMinutes, slotDelayLimit, htmlToPlainText, repairTelegramHtml, sendBroadcastContentReliable } = require('../rass');

test('scheduled copies preserve original formatting and custom emoji at 13:00 and 19:00', async () => {
  const calls = [];
  const bot = {
    copyMessage: async (...args) => { calls.push(args); return { message_id: 42 }; },
    sendMessage: () => { throw new Error('HTML reconstruction must not run'); }
  };
  for (const time of ['13:00', '19:00']) {
    await sendBroadcastContentReliable(bot, -100200, {
      time,
      content_type: 'text',
      text: '<b>AXE <tg-emoji emoji-id="123">⚡</tg-emoji></b>',
      source_chat_id: '123456',
      source_message_id: 17
    });
  }
  assert.deepEqual(calls, [[-100200, '123456', 17], [-100200, '123456', 17]]);
});

test('hmToMinutes converts configured broadcast times', () => {
  assert.equal(hmToMinutes('00:00'), 0);
  assert.equal(hmToMinutes('13:00'), 780);
  assert.equal(hmToMinutes('19:00'), 1140);
});

test('catch-up window remains open until the next schedule slot', () => {
  assert.equal(slotDelayLimit('13:00'), 179);
  assert.equal(slotDelayLimit('19:00'), 119);
  assert.equal(slotDelayLimit('21:00'), 179);
  assert.equal(slotDelayLimit('00:00'), 419);
});

test('htmlToPlainText preserves visible caption content', () => {
  assert.equal(
    htmlToPlainText('<b>AXE <tg-emoji emoji-id="123">⚡</tg-emoji></b><br>&lt;19:00&gt; &amp; ready'),
    'AXE ⚡\n<19:00> & ready'
  );
});

test('repairTelegramHtml fixes formatting that crosses a custom emoji', () => {
  assert.equal(
    repairTelegramHtml('<b>Внимание <tg-emoji emoji-id="123">🚨</b></tg-emoji> розыск!</b>'),
    '<b>Внимание <tg-emoji emoji-id="123">🚨</tg-emoji></b> розыск!'
  );
});

test('repairTelegramHtml reopens ordinary formatting after crossed tags', () => {
  assert.equal(
    repairTelegramHtml('<b>bold <i>both</b> italic</i>'),
    '<b>bold <i>both</i></b><i> italic</i>'
  );
});
