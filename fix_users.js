require('dotenv').config();
const db = require('./database');

console.log('Обновляю всех существующих пользователей...');

db.run(
  `UPDATE users SET application_approved = 1, welcome_keyboard_sent = 1 WHERE application_approved = 0 OR application_approved IS NULL`,
  function (err) {
    if (err) {
      console.error('Ошибка:', err.message);
      process.exit(1);
    }
    console.log(`✅ Обновлено ${this.changes} пользователей (application_approved = 1)`);

    db.run(
      `UPDATE applications SET status = 'approved', processed_at = CURRENT_TIMESTAMP WHERE status = 'pending'`,
      function (err) {
        if (err) {
          console.error('Ошибка:', err.message);
          process.exit(1);
        }
        console.log(`✅ Обновлено ${this.changes} заявок (status = approved)`);
        console.log('\nГотово! Теперь все существующие пользователи имеют доступ.');
        console.log('Перезапусти бота: pm2 restart axe-bot');
        process.exit(0);
      }
    );
  }
);
