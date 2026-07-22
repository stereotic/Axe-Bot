const db = require('./database');

const search = process.argv[2];
if (!search) {
  console.log('Использование: node find.js <ник>');
  db.close();
  process.exit(0);
}

db.all(`SELECT user_id, name, username, total_earned FROM users WHERE name LIKE ? OR username LIKE ?`,
  [`%${search}%`, `%${search}%`],
  (err, rows) => {
    if (err) { console.error(err); db.close(); return; }
    if (!rows.length) { console.log('Ничего не найдено'); db.close(); return; }
    rows.forEach(r => console.log(`${r.user_id} | ${r.name || ''} | @${r.username || ''} | ${r.total_earned || 0}₽`));
    db.close();
  }
);
