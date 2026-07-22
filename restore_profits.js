require('dotenv').config();
const db = require('./database');
const utils = require('./utils');

const USER_PROFITS = {
  'Ебырь': 381468,
  'gelikkkkik': 53300,
  'Куколд': 5413,
  'ннчик': 69266,
  'LilTug52': 3561,
  'AlekseyAdmin01': 79000,
  'Safonow1': 45000,
  'Психоzz': 125963,
  'ЛяяямДвести': 5000,
  'phobiatype': 3500,
  'Worker442': 106780,
  'EBYKAK666': 228000,
  'Mr_TOKAPb': 6000,
  'exchange_onlycash': 43900,
  'Denvr4ik': 15840,
  'AEZAKMI': 190500,
  'Astaroth': 52000,
  'ManMaksim': 8430,
};

const direction = 1;

let restored = 0;
const total = Object.keys(USER_PROFITS).length;

if (total === 0) {
  console.log('Нет данных в USER_PROFITS');
  process.exit(0);
}

function findUser(nameOrUsername, callback) {
  const clean = nameOrUsername.replace(/^#/, '').trim();
  db.get(
    'SELECT user_id, name, username FROM users WHERE username = ? OR name = ? OR name = ?',
    [clean, nameOrUsername, '#' + clean],
    (err, user) => {
      if (err || !user) {
        callback(null, null);
        return;
      }
      callback(null, user);
    }
  );
}

function restoreNext(entries) {
  if (entries.length === 0) {
    console.log(`\nГотово! Восстановлено ${restored} профитов.`);
    console.log('balance не менялся — вывести средства нельзя.');
    console.log('Перезапусти бота: pm2 restart axe-bot');
    process.exit(0);
  }

  const [nameOrUsername, amount] = entries[0];
  const workerPayout = utils.calculateWorkerPayout(amount, direction);
  const shares = utils.calculateProfitShares(amount);

  findUser(nameOrUsername, (err, user) => {
    if (!user) {
      console.log(`❌ ${nameOrUsername} — пользователь не найден, пропускаю`);
      restoreNext(entries.slice(1));
      return;
    }

    db.run(
      'INSERT INTO profits (user_id, amount, amount_to_pay, direction, created_at) VALUES (?, ?, ?, ?, datetime("now", "-1 day"))',
      [user.user_id, amount, workerPayout, direction],
      function (err) {
        if (err) {
          console.log(`❌ ${nameOrUsername} — ошибка: ${err.message}`);
          restoreNext(entries.slice(1));
          return;
        }

        const profitId = this.lastID;
        let shareDone = 0;
        const shareRoles = Object.entries(shares);

        for (const [role, shareAmount] of shareRoles) {
          db.run(
            'INSERT INTO profit_shares (profit_id, role, percentage, amount) VALUES (?, ?, ?, ?)',
            [profitId, role, utils.PROFIT_SHARES[role], shareAmount],
            () => {
              shareDone++;
              if (shareDone === shareRoles.length) {
                db.run(
                  'UPDATE users SET total_earned = total_earned + ?, profit_count = profit_count + 1 WHERE user_id = ?',
                  [amount, user.user_id],
                  () => {
                    utils.updateWorkerStatus(user.user_id, () => {
                      db.run(
                        "UPDATE stats SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'total_profits'",
                        () => {
                          restored++;
                          console.log(`✅ ${nameOrUsername} (@${user.username}): +${amount.toLocaleString()}₽`);
                          restoreNext(entries.slice(1));
                        }
                      );
                    });
                  }
                );
              }
            }
          );
        }
      }
    );
  });
}

const entries = Object.entries(USER_PROFITS).map(([u, a]) => [u, a]);
console.log(`Начинаю восстановление ${total} профитов...\n`);
restoreNext(entries);
