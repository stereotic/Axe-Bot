const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseAmounts,
  parseTimeRange,
  parseInterval,
  inTimeWindow,
  pickNextInterval,
  buildPublicText
} = require('../auto_profits');

test('parseAmounts: список и одиночное значение', () => {
  assert.deepStrictEqual(parseAmounts('5000 8000 12000'), [5000, 8000, 12000]);
  assert.deepStrictEqual(parseAmounts('5000,8000;12000'), [5000, 8000, 12000]);
  assert.deepStrictEqual(parseAmounts('5000'), [5000]);
  assert.strictEqual(parseAmounts('abc'), null);
  assert.strictEqual(parseAmounts(''), null);
  assert.strictEqual(parseAmounts('-5 0'), null);
});

test('parseTimeRange: дневной и ночной диапазоны', () => {
  assert.deepStrictEqual(parseTimeRange('13-19'), { time_from: 13, time_to: 19 });
  assert.deepStrictEqual(parseTimeRange('22-02'), { time_from: 22, time_to: 2 });
  assert.deepStrictEqual(parseTimeRange('0-5'), { time_from: 0, time_to: 5 });
  assert.strictEqual(parseTimeRange('13'), null);
  assert.strictEqual(parseTimeRange('25-3'), null);
  assert.strictEqual(parseTimeRange('abc'), null);
});

test('parseInterval: число и диапазон', () => {
  assert.deepStrictEqual(parseInterval('60'), { interval_from: 60, interval_to: 60 });
  assert.deepStrictEqual(parseInterval('45-120'), { interval_from: 45, interval_to: 120 });
  assert.strictEqual(parseInterval('120-45'), null);
  assert.strictEqual(parseInterval('0'), null);
  assert.strictEqual(parseInterval('abc'), null);
});

test('inTimeWindow: попадание в диапазон, в т.ч. через полночь', () => {
  assert.strictEqual(inTimeWindow(13, 19, 13 * 60), true);
  assert.strictEqual(inTimeWindow(13, 19, 19 * 60 + 59), true);
  assert.strictEqual(inTimeWindow(13, 19, 20 * 60), false);
  assert.strictEqual(inTimeWindow(13, 19, 12 * 60 + 59), false);
  // ночной диапазон 22-02
  assert.strictEqual(inTimeWindow(22, 2, 23 * 60), true);
  assert.strictEqual(inTimeWindow(22, 2, 60), true);
  assert.strictEqual(inTimeWindow(22, 2, 12 * 60), false);
});

test('pickNextInterval: в границах заданного диапазона', () => {
  const user = { interval_from: 45, interval_to: 120 };
  for (let i = 0; i < 200; i++) {
    const v = pickNextInterval(user);
    assert.ok(v >= 45 && v <= 120, `вне диапазона: ${v}`);
  }
  assert.strictEqual(pickNextInterval({ interval_from: 60, interval_to: 60 }), 60);
});

test('buildPublicText: формат Букмекера и Кардинга', () => {
  const bk = buildPublicText({ userId: 900000000001, username: 'Психопат', name: '#Психопат', amount: 65544, direction: 3 });
  assert.ok(bk.startsWith('<b><tg-emoji emoji-id="5444984118519573636">🌸</tg-emoji>УСПЕШНЫЙ ПРОФИТ'), 'заголовок крупного профита');
  assert.ok(bk.includes('УСПЕШНЫЙ ПРОФИТ<tg-emoji emoji-id="5444984118519573636">🌸</tg-emoji>'));
  assert.ok(bk.includes('Букмекер'));
  assert.ok(bk.includes('#Психопат'));
  assert.ok(bk.includes('65.544₽'));

  const kd = buildPublicText({ userId: 900000000001, username: 'Психопат', name: '#Психопат', amount: 12345, direction: 1, directionName: 'Кардинг' });
  assert.ok(kd.includes('Сервис: Кардинг'));
  assert.ok(kd.includes('12.345₽'));
  // До 50к — малый набор эмодзи
  assert.ok(kd.includes('5445006366450164917'));
  assert.ok(!kd.includes('5451767267744328949'));

  // Работа воркера в ссылке профиля экранируется
  const evil = buildPublicText({ userId: 900000000001, username: '<b>', name: '#<b>', amount: 1, direction: 3 });
  assert.ok(!evil.includes('<b>Воркер'));
  assert.ok(evil.includes('&lt;b&gt;'));
});