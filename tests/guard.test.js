const { test } = require('node:test');
const assert = require('node:assert');

const guard = require('../guard');

test('shouldProcessCallback: первый вызов разрешён, повтор в окне TTL запрещён', () => {
  const userId = 111;
  const data = 'profile';
  assert.strictEqual(guard.shouldProcessCallback(userId, data), true);
  assert.strictEqual(guard.shouldProcessCallback(userId, data), false);
});

test('shouldProcessCallback: разные данные разрешаются независимо', () => {
  const userId = 222;
  assert.strictEqual(guard.shouldProcessCallback(userId, 'profile'), true);
  assert.strictEqual(guard.shouldProcessCallback(userId, 'work'), true);
});

test('shouldProcessCallback: разные пользователи не мешают друг другу', () => {
  const data = 'withdraw';
  assert.strictEqual(guard.shouldProcessCallback(333, data), true);
  assert.strictEqual(guard.shouldProcessCallback(444, data), true);
});

test('shouldProcessCallback: кастомный TTL', () => {
  const userId = 555;
  assert.strictEqual(guard.shouldProcessCallback(userId, 'card', 50), true);
  assert.strictEqual(guard.shouldProcessCallback(userId, 'card', 50), false);
});

test('shouldProcessCallback: null-аргументы не проходят', () => {
  assert.strictEqual(guard.shouldProcessCallback(null, 'x'), false);
  assert.strictEqual(guard.shouldProcessCallback(1, null), false);
});

test('markCallbackProcessed: блокирует повторный вызов', () => {
  const userId = 666;
  const data = 'battlepass';
  assert.strictEqual(guard.shouldProcessCallback(userId, data), true);
  guard.markCallbackProcessed(userId, data);
  assert.strictEqual(guard.shouldProcessCallback(userId, data), false);
});

test('pending input: dispatch отдаёт сообщение обработчику', () => {
  const userId = 777;
  let received = null;
  guard.setPendingInput(userId, 1000, (msg) => { received = msg.text; });

  const dispatched = guard.dispatchPendingInput({ from: { id: userId }, chat: { id: 1000 }, text: 'Новый ник' });
  assert.strictEqual(dispatched, true);
  assert.strictEqual(received, 'Новый ник');
  guard.clearPendingInput(userId);
});

test('pending input: чужой чат не перехватывает', () => {
  const userId = 888;
  let called = false;
  guard.setPendingInput(userId, 1000, () => { called = true; });

  assert.strictEqual(guard.dispatchPendingInput({ from: { id: userId }, chat: { id: 9999 }, text: 'x' }), false);
  assert.strictEqual(called, false);
  guard.clearPendingInput(userId);
});

test('pending input: без pending возвращает false', () => {
  assert.strictEqual(guard.dispatchPendingInput({ from: { id: 424242 }, chat: { id: 1 }, text: 'x' }), false);
});

test('pending input: повторный setPendingInput перезаписывает обработчик', () => {
  const userId = 999;
  let calls = [];
  guard.setPendingInput(userId, 1, () => { calls.push('first'); });
  guard.setPendingInput(userId, 1, () => { calls.push('second'); });

  guard.dispatchPendingInput({ from: { id: userId }, chat: { id: 1 }, text: 'x' });
  assert.deepStrictEqual(calls, ['second']);
  guard.clearPendingInput(userId);
});

test('pending input: clearPendingInput убирает обработчик', () => {
  const userId = 12321;
  guard.setPendingInput(userId, 1, () => {});
  guard.clearPendingInput(userId);
  assert.strictEqual(guard.hasPendingInput(userId), false);
});
