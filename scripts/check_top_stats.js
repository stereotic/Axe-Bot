const db = require('../database');
const { topExclusionWhere } = require('../utils');

setTimeout(() => {
  db.all(
    `SELECT user_id, username, name FROM users WHERE LOWER(name) LIKE '%тест%' OR LOWER(username) LIKE '%sss%' OR LOWER(name) LIKE '%sss%'`,
    [],
    (e, users) => {
      console.log('Test-like users:', users);
    }
  );

  db.all(
    `SELECT u.name, u.username, SUM(p.amount) AS total
     FROM users u
     JOIN profits p ON u.user_id = p.user_id
     GROUP BY u.user_id
     ORDER BY total DESC
     LIMIT 10`,
    [],
    (e, all) => {
      console.log('\nTop 10 WITHOUT filter:', all);
    }
  );

  db.all(
    `SELECT u.name, u.username, SUM(p.amount) AS total
     FROM users u
     JOIN profits p ON u.user_id = p.user_id
     WHERE ${topExclusionWhere('u')}
     GROUP BY u.user_id
     ORDER BY total DESC
     LIMIT 10`,
    [],
    (e, filtered) => {
      console.log('\nTop 10 WITH filter:', filtered);
    }
  );

  db.get(
    `SELECT COALESCE(SUM(amount), 0) AS daily_total FROM profits WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')`,
    [],
    (e, row) => {
      console.log('\nDaily kassa:', row);
      process.exit(0);
    }
  );
}, 300);
