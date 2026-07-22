const db = require('./database');

const twoDaysAgo = new Date();
twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
const dateStr = twoDaysAgo.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

db.run(`UPDATE profits SET created_at = ? WHERE user_id > 1000000000`, [dateStr], function(err) {
    if (err) {
        console.error('Ошибка:', err);
        return;
    }
    console.log('Обновлено строк:', this.changes);
    console.log('Касса за сегодня = 0');
    db.close();
});
