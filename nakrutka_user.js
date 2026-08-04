const db = require('./database');

const userId = 6383039210;
const count = 91;
const now = new Date();
const dateStr = now.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

let done = 0;
const addNext = () => {
  if (done >= count) {
    console.log(`✅ Добавлено ${count} профитов`);
    db.close();
    return;
  }
  const amount = Math.floor(Math.random() * 2);
  db.run('INSERT INTO profits (user_id, amount, amount_to_pay, direction, created_at) VALUES (?, ?, ?, 1, ?)',
    [userId, amount, amount, dateStr], function(err) {
      if (err) { console.error(err); db.close(); return; }
      done++;
      if (done % 10 === 0) process.stdout.write('.');
      addNext();
    }
  );
};
console.log(`Добавляю ${count} профитов юзеру ${userId}...`);
addNext();
