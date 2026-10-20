const test = require('node:test');
const assert = require('node:assert/strict');
const { hmToMinutes, slotDelayLimit } = require('../rass');

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
