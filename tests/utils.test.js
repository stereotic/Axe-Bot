const { test } = require('node:test');
const assert = require('node:assert');

const utils = require('../utils');

test('calculateWorkerPayout: 75% биржа, прямой и букмекер, floor', () => {
  assert.strictEqual(utils.calculateWorkerPayout(10000, 1), 7500);
  assert.strictEqual(utils.calculateWorkerPayout(10000, 2), 7500);
  assert.strictEqual(utils.calculateWorkerPayout(10000, 3), 7500);
  assert.strictEqual(utils.calculateWorkerPayout(999, 1), 749);
});

test('calculateProfitShares: доли зависят от направления', () => {
  assert.deepStrictEqual(utils.calculateProfitShares(10000, 1), { ts: 1300, investor: 200 });
  assert.deepStrictEqual(utils.calculateProfitShares(10000, 2), { ts: 1250, fin: 1250, investor: 100 });
  assert.deepStrictEqual(utils.calculateProfitShares(10000, 3), { ts: 2300, investor: 200 });
});

test('buildAccountingText: формат кассы по направлениям', () => {
  const direct = utils.buildAccountingText({ direction: 2, username: 'worker', amount: 10000, workerPayout: 7500, shares: utils.calculateProfitShares(10000, 2) });
  assert.strictEqual(direct, '💳Прямой\nВоркер: @worker\nСумма: 10,000₽\nК выплате: 7,500₽\nТс: 1,250₽\nФин: 1,250₽\nИнвестор: 100₽');

  const exchange = utils.buildAccountingText({ direction: 1, username: '@worker', amount: 10000, workerPayout: 7500, shares: utils.calculateProfitShares(10000, 1) });
  assert.strictEqual(exchange, '📈Биржа\nВоркер: @worker\nСумма: 10,000₽\nК выплате: 7,500₽\nТс: 1,300₽\nИнвестор: 200₽');

  const bookmaker = utils.buildAccountingText({ direction: 3, username: 'worker', amount: 10000, workerPayout: 7500, shares: utils.calculateProfitShares(10000, 3) });
  assert.strictEqual(bookmaker, '⚽️БК\nВоркер: @worker\nСумма: 10,000₽\nК выплате: 7,500₽\nТс: 2,300₽\nИнвестор: 200₽');
});

test('getStatusByTotal: пороги уровней', () => {
  assert.strictEqual(utils.getStatusByTotal(0), 'NEW');
  assert.strictEqual(utils.getStatusByTotal(29999), 'NEW');
  assert.strictEqual(utils.getStatusByTotal(30000), 'PRO');
  assert.strictEqual(utils.getStatusByTotal(100000), 'MASTER');
  assert.strictEqual(utils.getStatusByTotal(300000), 'GOAT');
  assert.strictEqual(utils.getStatusByTotal(1000000), 'GOLD');
  assert.strictEqual(utils.getStatusByTotal(5000000), 'GG');
});

test('getDirectionName', () => {
  assert.strictEqual(utils.getDirectionName(1), 'Биржа');
  assert.strictEqual(utils.getDirectionName(2), 'Прямой');
});

test('validateWorkerName: валидные имена', () => {
  assert.strictEqual(utils.validateWorkerName('Vasya'), true);
  assert.strictEqual(utils.validateWorkerName('worker_123'), true);
  assert.strictEqual(utils.validateWorkerName('абв'), true);
  assert.strictEqual(utils.validateWorkerName('Nik!?$₽'), true);
});

test('validateWorkerName: невалидные имена', () => {
  assert.strictEqual(utils.validateWorkerName('ab'), false);            // слишком короткое
  assert.strictEqual(utils.validateWorkerName('a'.repeat(21)), false);  // слишком длинное
  assert.strictEqual(utils.validateWorkerName('name with space'), false);
  assert.strictEqual(utils.validateWorkerName('name@tag'), false);
  assert.strictEqual(utils.validateWorkerName(''), false);
});

test('formatAmount: разделители ru-RU без запятых', () => {
  assert.strictEqual(utils.formatAmount(1500), '1\u00A0500');
  assert.strictEqual(utils.formatAmount(1234567), '1\u00A0234\u00A0567');
});

test('topExclusionWhere: подставляет алиас и исключения', () => {
  const where = utils.topExclusionWhere('u');
  assert.ok(where.includes('u.name'));
  assert.ok(where.includes('u.username'));
  assert.ok(where.includes('sss'));
  assert.ok(where.includes('тестик'));
});

test('isSubscribedChatMember: обычные и restricted участники', () => {
  assert.ok(utils.isSubscribedChatMember({ status: 'member' }));
  assert.ok(utils.isSubscribedChatMember({ status: 'administrator' }));
  assert.ok(utils.isSubscribedChatMember({ status: 'creator' }));
  assert.ok(utils.isSubscribedChatMember({ status: 'restricted', is_member: true }));
  assert.ok(!utils.isSubscribedChatMember({ status: 'left' }));
  assert.ok(!utils.isSubscribedChatMember({ status: 'restricted', is_member: false }));
  assert.ok(!utils.isSubscribedChatMember(null));
});
