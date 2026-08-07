const { test } = require('node:test');
const assert = require('node:assert');

const {
  KNOWN_COMMANDS,
  parseProfitText,
  parseProfitCommand
} = require('../profit_parser');

test('parseProfitText: базовый формат без слэша', () => {
  const parsed = parseProfitText('richvladwork 10000 1');
  assert.deepStrictEqual(parsed, { username: 'richvladwork', amount: 10000, direction: 1, mammothCount: null });
});

test('parseProfitText: сумма с ₽', () => {
  assert.deepStrictEqual(parseProfitText('worker 5000₽ 1'), { username: 'worker', amount: 5000, direction: 1, mammothCount: null });
});

test('parseProfitText: мамонт в скобках', () => {
  assert.deepStrictEqual(parseProfitText('worker 5000 2 (3)'), { username: 'worker', amount: 5000, direction: 2, mammothCount: 3 });
});

test('parseProfitText: мамонт без скобок', () => {
  assert.deepStrictEqual(parseProfitText('worker 5000 2 3'), { username: 'worker', amount: 5000, direction: 2, mammothCount: 3 });
});

test('parseProfitText: служебная команда со слэшем не парсится', () => {
  assert.strictEqual(parseProfitText('/start 5000 1'), null);
  assert.strictEqual(parseProfitText('/me 5000 1'), null);
  assert.strictEqual(parseProfitText('/top 5000 1'), null);
});

test('parseProfitText: направление 3 (Букмекер) парсится', () => {
  assert.deepStrictEqual(parseProfitText('name 5000 3'), { username: 'name', amount: 5000, direction: 3, mammothCount: null });
});

test('parseProfitText: неверный формат возвращает null', () => {
  assert.strictEqual(parseProfitText('justname'), null);
  assert.strictEqual(parseProfitText(''), null);
  assert.strictEqual(parseProfitText('name 100 4'), null);
  assert.strictEqual(parseProfitText('name abc 1'), null);
  assert.strictEqual(parseProfitText(null), null);
  assert.strictEqual(parseProfitText(123), null);
});

test('parseProfitCommand: базовый формат', () => {
  assert.deepStrictEqual(parseProfitCommand('/richvladwork 5000 1'), { username: 'richvladwork', amount: 5000, direction: 1, mammothCount: null });
});

test('parseProfitCommand: известные команды не считаются профитом', () => {
  for (const cmd of KNOWN_COMMANDS) {
    assert.strictEqual(parseProfitCommand(`/${cmd} 5000 1`), null, `/${cmd} должен игнорироваться`);
  }
});

test('parseProfitCommand: суффикс @Bot не влияет на распознавание команды', () => {
  assert.strictEqual(parseProfitCommand('/start@AXE_xBOT 5000 1'), null);
  assert.deepStrictEqual(parseProfitCommand('/richvladwork@AXE_xBOT 5000 1'), {
    username: 'richvladwork@AXE_xBOT',
    amount: 5000,
    direction: 1,
    mammothCount: null
  });
});

test('parseProfitCommand: мамонт в скобках', () => {
  assert.deepStrictEqual(parseProfitCommand('/worker 5000 2 (4)'), { username: 'worker', amount: 5000, direction: 2, mammothCount: 4 });
});
