const db = require('./database');
db.all("SELECT user_id, name, username FROM users WHERE name LIKE 'Worker%' OR name LIKE '#Worker%'", (err, rows) => {
  if (err) { console.error(err); process.exit(1); }
  if (rows.length === 0) {
    console.log('Нет пользователей с именем Worker*');
  } else {
    console.log(JSON.stringify(rows, null, 2));
  }
  process.exit(0);
});
