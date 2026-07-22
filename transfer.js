const db = require('./database');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Использование: node transfer.js <from_user_id> <to_user_id> [total_earned]');
  console.log('Пример: node transfer.js 1000000001 7974494724 381468');
  db.close();
  process.exit(0);
}

const fromId = parseInt(args[0]);
const toId = parseInt(args[1]);
const totalEarned = args[2] ? parseInt(args[2]) : null;

console.log(`Перенос: ${fromId} → ${toId}`);

// 0. Копируем name из фейкового юзера в реального
db.get('SELECT name, username FROM users WHERE user_id = ?', [fromId], (err, fake) => {
  if (err) { console.error('❌ Ошибка:', err); db.close(); return; }
  if (!fake) { console.log('❌ Фейковый юзер не найден'); db.close(); return; }

  const newName = fake.name?.startsWith('#') ? fake.name : '#' + (fake.name || fake.username || '');
  db.run('UPDATE users SET name = ? WHERE user_id = ?', [newName, toId], function(err2) {
    if (err2) console.error('❌ Ошибка обновления name:', err2);
    else console.log(`✅ Имя для ${toId}: ${newName}`);

    // 1. Переносим профиты
    db.run('UPDATE profits SET user_id = ? WHERE user_id = ?', [toId, fromId], function(err3) {
      if (err3) { console.error('❌ Ошибка переноса профитов:', err3); db.close(); return; }
      console.log(`✅ Перенесено профитов: ${this.changes}`);

      // 2. Ставим total_earned если указан
      if (totalEarned !== null) {
        db.run('UPDATE users SET total_earned = ? WHERE user_id = ?', [totalEarned, toId], function(err4) {
          if (err4) console.error('❌ Ошибка total_earned:', err4);
          else console.log(`✅ total_earned для ${toId} = ${totalEarned}₽`);
          db.close();
        });
      } else {
        db.close();
      }
    });
  });
});
