const db = require('./database');

// Сначала просто ищем и показываем
db.all("SELECT user_id, name, username, total_earned, profit_count FROM users WHERE LOWER(name) LIKE '%worker419%' OR LOWER(name) = '#test' OR LOWER(username) = 'test'", (err, rows) => {
  if (err) {
    console.error('Error:', err);
    process.exit(1);
  }
  console.log('Найденные пользователи:');
  console.log(JSON.stringify(rows, null, 2));

  if (rows.length === 0) {
    console.log('Никто не найден. Завершение.');
    process.exit(0);
  }

  // Для каждого найденного пользователя удаляем профиты и обнуляем статистику
  let completed = 0;
  rows.forEach((user) => {
    db.run("DELETE FROM profit_shares WHERE profit_id IN (SELECT id FROM profits WHERE user_id = ?)", [user.user_id], () => {
      db.run("DELETE FROM profits WHERE user_id = ?", [user.user_id], () => {
        db.run("UPDATE users SET total_earned = 0, profit_count = 0, balance = 0 WHERE user_id = ?", [user.user_id], () => {
          completed++;
          console.log('OK: ' + user.name + ' (ID: ' + user.user_id + ')');
          if (completed === rows.length) {
            console.log('Gotovo! Vse profiti udaleny.');
            process.exit(0);
          }
        });
      });
    });
  });
});
