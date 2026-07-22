const db = require('./database');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Использование: node set_earned.js <user_id> <amount> [user_id amount ...]');
  console.log('Пример: node set_earned.js 1000000001 381468');
  db.close();
  process.exit(0);
}

const pairs = [];
for (let i = 0; i < args.length; i += 2) {
  pairs.push([parseInt(args[i]), parseInt(args[i + 1])]);
}

const run = () => {
  if (!pairs.length) { db.close(); return; }
  const [uid, amount] = pairs.shift();
  db.run('UPDATE users SET total_earned = ? WHERE user_id = ?', [amount, uid], function(err) {
    if (err) console.error(`❌ ${uid}:`, err);
    else console.log(`✅ ${uid} → ${amount}₽ (обновлено строк: ${this.changes})`);
    run();
  });
};
run();
