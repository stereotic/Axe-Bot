const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const ids = [5861326895, 8409742174, 7599626121];
const dbPath = path.join(__dirname, '..', 'database.db');
const db = new sqlite3.Database(dbPath);
const placeholders = ids.map(() => '?').join(',');

function all(sql, params = []) {
  return new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));
}
function run(sql, params = []) {
  return new Promise((res, rej) =>
    db.run(sql, params, function onRun(e) {
      if (e) rej(e);
      else res(this);
    })
  );
}

(async () => {
  const users = await all(
    `SELECT user_id, username, application_approved FROM users WHERE user_id IN (${placeholders})`,
    ids
  );
  const apps = await all(
    `SELECT id, user_id, username, status FROM applications WHERE user_id IN (${placeholders})`,
    ids
  );
  console.log('Before:', { users, applications: apps });

  const profitIds = (
    await all(`SELECT id FROM profits WHERE user_id IN (${placeholders})`, ids)
  ).map((p) => p.id);

  if (profitIds.length) {
    const ph = profitIds.map(() => '?').join(',');
    await run(`DELETE FROM profit_shares WHERE profit_id IN (${ph})`, profitIds);
    await run(`DELETE FROM profits WHERE id IN (${ph})`, profitIds);
  }

  await run(`DELETE FROM checks WHERE user_id IN (${placeholders})`, ids);
  await run(
    `DELETE FROM card_requests WHERE user_id IN (${placeholders}) OR admin_id IN (${placeholders})`,
    [...ids, ...ids]
  );
  await run(`DELETE FROM withdrawals WHERE user_id IN (${placeholders})`, ids);
  await run(`DELETE FROM purchased_cards WHERE user_id IN (${placeholders})`, ids);
  await run(`DELETE FROM applications WHERE user_id IN (${placeholders})`, ids);
  const usersResult = await run(`DELETE FROM users WHERE user_id IN (${placeholders})`, ids);

  const usersAfter = await all(
    `SELECT user_id FROM users WHERE user_id IN (${placeholders})`,
    ids
  );
  const appsAfter = await all(
    `SELECT id FROM applications WHERE user_id IN (${placeholders})`,
    ids
  );

  console.log('Deleted users rows:', usersResult.changes);
  console.log('Remaining users:', usersAfter.length, 'applications:', appsAfter.length);
  db.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
