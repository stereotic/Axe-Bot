// Одноразовая миграция: переносит учеников со старого куратора Henry_AXE
// на нового Maximus_AXE. Идемпотентна — можно запускать повторно.
// Запуск на сервере после деплоя: node scripts/migrate_curator_maximus.js
const db = require('../database');

db.all("SELECT user_id, username, name, curator FROM users WHERE LOWER(curator) = 'henry_axe'", (err, rows) => {
  if (err) {
    console.error('Ошибка чтения:', err);
    process.exit(1);
  }

  if (!rows.length) {
    console.log('Учеников у Henry_AXE нет — миграция не требуется.');
  } else {
    rows.forEach((r) => console.log(`Переношу: ${r.user_id} ${r.username || r.name} -> Maximus_AXE`));
  }

  db.run("UPDATE users SET curator = 'Maximus_AXE' WHERE LOWER(curator) = 'henry_axe'", (updErr) => {
    if (updErr) {
      console.error('Ошибка миграции:', updErr);
      process.exit(1);
    }
    console.log('Готово. Ученики Henry_AXE теперь закреплены за Maximus_AXE.');
    db.close();
  });
});