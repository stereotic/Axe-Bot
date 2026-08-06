// Пересчёт battlepass_xp по истории profits с учётом направления (новая ставка).
// Использование: node recalc_battlepass_xp.js [username|user_id ...]
// Без аргументов — пересчитывает ВСЕХ пользователей.
// Пример: node recalc_battlepass_xp.js AlekseyAdmin01 EBYKAK666
const db = require('./database');
const battlepass = require('./battlepass');

const args = process.argv.slice(2);

function getTargets() {
  if (args.length === 0) return null;

  const nameIds = [];
  const usernames = [];
  for (const arg of args) {
    if (/^\d+$/.test(arg)) nameIds.push(parseInt(arg, 10));
    else usernames.push(arg);
  }

  const clauses = [];
  const params = [];
  if (nameIds.length) {
    clauses.push(`user_id IN (${nameIds.map(() => '?').join(',')})`);
    params.push(...nameIds);
  }
  if (usernames.length) {
    clauses.push(`LOWER(TRIM(username)) IN (${usernames.map(() => '?').join(',')})`);
    params.push(...usernames.map((u) => String(u).toLowerCase()));
  }

  return { where: clauses.join(' OR '), params };
}

const targets = getTargets();

db.all(
  `SELECT user_id, username, name, battlepass_xp FROM users${targets ? ` WHERE ${targets.where}` : ''}`,
  targets ? targets.params : [],
  (err, users) => {
    if (err) {
      console.error('❌ Ошибка выборки пользователей:', err);
      db.close();
      return;
    }
    if (!users.length) {
      console.log('❌ Пользователи не найдены');
      db.close();
      return;
    }

    let pending = users.length;
    users.forEach((user) => {
      db.all('SELECT amount, direction FROM profits WHERE user_id = ?', [user.user_id], (err2, rows) => {
        if (err2) {
          console.error(`❌ Ошибка чтения профитов юзера ${user.user_id}:`, err2);
          finish();
          return;
        }

        let xp = 0;
        for (const row of rows) {
          xp += battlepass.xpFromAmount(row.amount, row.direction);
        }
        xp = Math.round(xp * 1000) / 1000;

        db.run('UPDATE users SET battlepass_xp = ? WHERE user_id = ?', [xp, user.user_id], (err3) => {
          if (err3) {
            console.error(`❌ Ошибка обновления юзера ${user.user_id}:`, err3);
          } else {
            const before = user.battlepass_xp || 0;
            const levelBefore = battlepass.buildState(0, before).level;
            const levelAfter = battlepass.buildState(0, xp).level;
            console.log(
              `✅ ${user.username || user.user_id} (${user.name}): XP ${before} -> ${xp} (LVL ${levelBefore} -> ${levelAfter}), профитов: ${rows.length}`
            );
          }
          finish();
        });
      });
    });

    function finish() {
      if (--pending === 0) {
        console.log('🎯 Пересчёт завершён');
        db.close();
      }
    }
  }
);
