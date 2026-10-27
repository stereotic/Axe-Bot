const test = require('node:test');
const assert = require('node:assert/strict');
const { hmToMinutes, slotDelayLimit, htmlToPlainText, repairTelegramHtml } = require('../rass');

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
