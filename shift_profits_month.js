const db = require('./database');

const targets = process.argv.slice(2);

if (targets.length === 0) {
  console.log('Укажи юзернеймы/имена через пробел:');
  console.log('  node shift_profits_month.js @username "Имя Имя" name3');
  process.exit(0);
}

function findUsers(nameOrUsername) {
  const clean = nameOrUsername.replace(/^@/, '').replace(/^#/, '').trim();
  return new Promise((resolve) => {
    db.all(
      `SELECT user_id, name, username FROM users
       WHERE username = ? COLLATE NOCASE
          OR name = ? COLLATE NOCASE
          OR name = ? COLLATE NOCASE`,
      [clean, nameOrUsername, '@' + clean],
      (err, rows) => {
        if (err || rows.length === 0) {
          resolve([]);
          return;
        }
        resolve(rows);
      }
    );
  });
}

function dateRange(whereSql, params) {
  return new Promise((resolve) => {
    db.get(
      `SELECT COUNT(*) AS cnt, MIN(created_at) AS min_d, MAX(created_at) AS max_d FROM profits WHERE ${whereSql}`,
      params,
      (err, row) => {
        if (err) {
          console.error('Ошибка чтения:', err);
          resolve(null);
          return;
        }
        resolve(row);
      }
    );
  });
}

async function main() {
  const userIds = new Set();
  const unknown = [];

  for (const target of targets) {
    const users = await findUsers(target);
    if (users.length === 0) {
      unknown.push(target);
      continue;
    }
    for (const u of users) {
      userIds.add(u.user_id);
    }
  }

  if (unknown.length > 0) {
    console.log(`❌ Не найдены: ${unknown.join(', ')}`);
  }

  if (userIds.size === 0) {
    console.log('Никого не найдено, выхожу.');
    db.close();
    return;
  }

  const idList = [...userIds];
  const placeholders = idList.map(() => '?').join(',');
  const whereSql = `user_id IN (${placeholders})`;

  const before = await dateRange(whereSql, idList);
  if (!before) {
    db.close();
    return;
  }

  console.log('\nДо сдвига:');
  console.log(`  Профитов к сдвигу: ${before.cnt}`);
  console.log(`  Диапазон created_at: ${before.min_d} .. ${before.max_d}`);

  db.run(`UPDATE profits SET created_at = datetime(created_at, '-1 month') WHERE ${whereSql}`, idList, function(err) {
    if (err) {
      console.error('Ошибка сдвига:', err);
      db.close();
      return;
    }

    console.log(`\nСдвинуто профитов: ${this.changes}`);

    dateRange(whereSql, idList).then((after) => {
      console.log('После сдвига:');
      console.log(`  Диапазон created_at: ${after.min_d} .. ${after.max_d}`);
      console.log('\nКасса за сегодня/сутки пересчитается сама.');
      db.close();
    });
  });
}

main();
