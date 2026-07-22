const db = require('./database');

const needed = 115;
const now = new Date();
const dateStr = now.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
const excludedNames = ['#sss','#Testovhik','#тестик','тестик','#testovhik','testovhik'];
const excludedUsernames = ['sss','freeobnall'];

const nameList = excludedNames.map(n => `'${n.replace(/'/g, "''")}'`).join(',');
const userList = excludedUsernames.map(n => `'${n.replace(/'/g, "''")}'`).join(',');

db.all(`SELECT u.user_id FROM users u WHERE u.user_id > 1000000000
  AND LOWER(TRIM(COALESCE(u.name, ''))) NOT IN (${nameList})
  AND LOWER(TRIM(COALESCE(u.username, ''))) NOT IN (${userList})`, (err, rows) => {
  if (err) { console.error(err); db.close(); return; }

  db.get(`SELECT COUNT(*) as cnt FROM profits p JOIN users u ON p.user_id = u.user_id
    WHERE LOWER(TRIM(COALESCE(u.name, ''))) NOT IN (${nameList})
      AND LOWER(TRIM(COALESCE(u.username, ''))) NOT IN (${userList})`, (err2, current) => {
    if (err2) { console.error(err2); db.close(); return; }
    
    let cur = current.cnt;
    const ids = rows.map(r => r.user_id);
    if (!ids.length) { console.log('Нет фейковых юзеров'); db.close(); return; }

    const insertNext = () => {
      if (cur >= needed) { console.log(`✅ Готово: ${needed} профитов`); db.close(); return; }
      const uid = ids[cur % ids.length];
      const amount = Math.floor(Math.random() * 2); // 0 или 1
      db.run('INSERT INTO profits (user_id, amount, amount_to_pay, direction, created_at) VALUES (?, ?, ?, 1, ?)',
        [uid, amount, amount, dateStr], function(err3) {
          if (err3) { console.error(err3); db.close(); return; }
          cur++;
          if (cur % 10 === 0) process.stdout.write('.');
          insertNext();
        }
      );
    };
    console.log(`Сейчас: ${cur}, нужно: ${needed}, добавлю: ${needed - cur}`);
    insertNext();
  });
});
