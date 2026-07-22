require('dotenv').config();
const db = require('./database');
const utils = require('./utils');

// [name, allTimeAmount, monthlyAmount]
const users = [
  ['#Ебырь', 381468, 46950],
  ['EBYKAK666', 228000, 64000],
  ['#AEZAKMI', 190500, 174500],
  ['#Психоzz', 125963, 15650],
  ['#Worker442', 106780, null],
  ['#AlekseyAdmin01', 79000, null],
  ['#ннчик', 69266, null],
  ['gelikkkkik', 53300, null],
  ['#Astaroth', 52000, 52000],
  ['#Safonow1', 45000, 35000],
  ['#ManMaksim', 8430, 8430],
  ['#Куколд', 5413, null],
  ['#LilTug52', 3561, null],
  ['phobiatype', 3500, null],
  ['#Mr_TOKAPb', 6000, null],
  ['exchange_onlycash', 43900, null],
  ['#Denvr4ik', 15840, null],
  ['#ЛяяямДвести', 5000, null],
];

let fakeId = 1000000001;

function findUser(name, callback) {
  const clean = name.replace(/^#/, '');
  db.get('SELECT user_id, name, username FROM users WHERE username = ? OR name = ? OR name = ?',
    [clean, name, '#' + clean], callback);
}

function createUser(name, callback) {
  const clean = name.replace(/^#/, '');
  const id = fakeId++;
  db.run(
    'INSERT INTO users (user_id, username, name, application_approved, welcome_keyboard_sent, profile_hidden) VALUES (?, ?, ?, 1, 1, 1)',
    [id, clean, name],
    (err) => err ? callback(err) : callback(null, { user_id: id, name })
  );
}

function addProfit(userId, amount, dateStr, callback) {
  const direction = 1;
  const workerPayout = utils.calculateWorkerPayout(amount, direction);
  const shares = utils.calculateProfitShares(amount);

  db.run('INSERT INTO profits (user_id, amount, amount_to_pay, direction, created_at) VALUES (?, ?, ?, ?, ?)',
    [userId, amount, workerPayout, direction, dateStr],
    function (err) {
      if (err) return callback(err);
      const profitId = this.lastID;
      const entries = Object.entries(shares);
      let done = 0;
      for (const [role, shareAmount] of entries) {
        db.run('INSERT INTO profit_shares (profit_id, role, percentage, amount) VALUES (?, ?, ?, ?)',
          [profitId, role, utils.PROFIT_SHARES[role], shareAmount],
          () => {
            done++;
            if (done === entries.length) {
              db.run('UPDATE users SET total_earned = total_earned + ?, profit_count = profit_count + 1 WHERE user_id = ?',
                [amount, userId],
                () => utils.updateWorkerStatus(userId, () => callback(null))
              );
            }
          }
        );
      }
    }
  );
}

let idx = 0;
function next() {
  if (idx >= users.length) {
    db.run("UPDATE stats SET value = '1351821' WHERE key = 'project_balance'");
    db.run("UPDATE stats SET value = '115' WHERE key = 'total_profits'", () => {
      console.log('\n✅ Готово!');
      console.log('Касса: 1 351 821₽');
      console.log('Всего профитов: 115');
      console.log('Перезапусти бота: pm2 restart axe-bot');
      process.exit(0);
    });
    return;
  }

  const [name, total, monthly] = users[idx++];
  findUser(name, (err, existing) => {
    if (existing) {
      // Delete old profits for this user to avoid duplicates
      db.run('DELETE FROM profit_shares WHERE profit_id IN (SELECT id FROM profits WHERE user_id = ?)', [existing.user_id], () => {
        db.run('DELETE FROM profits WHERE user_id = ?', [existing.user_id], () => {
          db.run('UPDATE users SET total_earned = 0, profit_count = 0 WHERE user_id = ?', [existing.user_id], () => {
            proceedAdd(existing.user_id, name, total, monthly);
          });
        });
      });
    } else {
      createUser(name, (err, user) => {
        if (err) { console.log(`❌ ${name}: ${err.message}`); return next(); }
        proceedAdd(user.user_id, name, total, monthly);
      });
    }
  });
}

function proceedAdd(userId, name, total, monthly) {
  const needsMonthly = monthly !== null;
  const allTimeAmount = needsMonthly ? total - monthly : total;
  let added = 0;
  const need = needsMonthly ? 2 : 1;

  if (allTimeAmount > 0) {
    addProfit(userId, allTimeAmount, '2026-06-15 12:00:00', (err) => {
      if (err) console.log(`  ⚠️ ${name}: old profit error: ${err.message}`);
      added++;
      if (added === need) done();
    });
  } else {
    added++;
    if (added === need) done();
  }

  if (needsMonthly) {
    addProfit(userId, monthly, '2026-07-22 12:00:00', (err) => {
      if (err) console.log(`  ⚠️ ${name}: month profit error: ${err.message}`);
      added++;
      if (added === need) done();
    });
  }

  function done() {
    console.log(`✅ ${name}: all=${total.toLocaleString()}₽, month=${(monthly || 0).toLocaleString()}₽`);
    next();
  }
}

console.log('Сначала очищаю старые данные и добавляю заново...\n');
next();
