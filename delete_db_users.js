// Удаление пользователей из БД вместе со всеми зависимыми записями.
// Запуск: node delete_db_users.js <tgId> [tgId...]
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.db');

const ids = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n !== 0);
if (ids.length === 0) {
  console.error('Usage: node delete_db_users.js <tgId> [tgId...]');
  process.exit(1);
}

const ph = ids.map(() => '?').join(',');

// Порядок важен: сначала дети, потом родитель (users).
const steps = [
  ['profit_shares', 'profit_id', `SELECT id FROM profits WHERE user_id IN (${ph})`],
  ['checks', 'user_id', null],
  ['card_requests', 'user_id', null],
  ['purchased_cards', 'user_id', null],
  ['withdrawals', 'user_id', null],
  ['applications', 'user_id', null],
  ['chat_unlocks', 'user_id', null],
  ['tickets', 'user_id', null],
  ['card_requisites', 'created_by', null],
  ['profits', 'user_id', null],
  ['users', 'user_id', null]
];

let remaining = steps.length;

function finish(err) {
  if (err) {
    console.error('Ошибка:', err.message);
    db.run('ROLLBACK');
    db.close();
    process.exit(1);
  }
  remaining--;
  if (remaining === 0) {
    db.run('COMMIT', () => {
      console.log(`Готово. Удалены следы пользователей: ${ids.join(', ')}`);
      db.close();
    });
  }
}

db.serialize(() => {
  db.run('BEGIN');
  for (const [table, col, sub] of steps) {
    if (sub) {
      db.run(`DELETE FROM ${table} WHERE ${col} IN (${sub})`, ids, finish);
    } else {
      db.run(`DELETE FROM ${table} WHERE ${col} IN (${ph})`, ids, finish);
    }
  }
});
