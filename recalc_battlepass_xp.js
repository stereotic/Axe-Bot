// Пересчёт battlepass_xp.
// Режим по умолчанию — по истории profits с учётом направления (новая ставка).
//   node recalc_battlepass_xp.js [username|user_id ...]
// Режим от кассы (battlepass_earned) — источник правды, когда profits замусорен
// старыми/тестовыми строками. Ставку можно задать на юзера: имя:ставка (по умолчанию 0.5).
//   node recalc_battlepass_xp.js --from-earned EBYKAK666:0.2 AlekseyAdmin01:0.5
// Диагностика без записи:
//   node recalc_battlepass_xp.js --diag [username|user_id ...]
const db = require('./database');
const battlepass = require('./battlepass');

const args = process.argv.slice(2);
const DIAG = args.includes('--diag');
const FROM_EARNED = args.includes('--from-earned');

// Гарантируем наличие колонки (на случай, если бот ещё не поднят новым кодом).
db.run(`ALTER TABLE users ADD COLUMN battlepass_xp REAL DEFAULT 0`, (alterErr) => {
  if (alterErr && !alterErr.message.includes('duplicate column name')) {
    console.error('Ошибка создания battlepass_xp:', alterErr);
    db.close();
    return;
  }
  run();
});

function run() {

function getTargets() {
  const cleanArgs = args.filter((a) => a !== '--diag' && a !== '--from-earned');
  if (cleanArgs.length === 0) return null;

  const nameIds = [];
  const usernames = [];
  const rates = {};
  for (const arg of cleanArgs) {
    let name = arg;
    let rate = null;
    const idx = arg.indexOf(':');
    if (idx > 0) {
      name = arg.slice(0, idx);
      rate = parseFloat(arg.slice(idx + 1));
    }
    if (/^\d+$/.test(name)) {
      nameIds.push(parseInt(name, 10));
      if (rate) rates[parseInt(name, 10)] = rate;
    } else {
      usernames.push(name);
      if (rate) rates[name.toLowerCase()] = rate;
    }
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

  return { where: clauses.join(' OR '), params, rates };
}

const targets = getTargets();

db.all(
  `SELECT user_id, username, name, battlepass_earned, profit_count, battlepass_xp FROM users${targets ? ` WHERE ${targets.where}` : ''}`,
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
      const key = user.username ? user.username.toLowerCase() : String(user.user_id);
      const rate = (targets && targets.rates[key]) || (targets && targets.rates[user.user_id]) || null;

      const processEarned = () => {
        const perStep = rate || battlepass.XP_PER_STEP;
        const xp = Math.round((user.battlepass_earned || 0) / battlepass.RUB_PER_STEP * perStep * 1000) / 1000;
        report(user, xp, `касса ${user.battlepass_earned}₽ × ${perStep}/10к`);
      };

      const processProfits = () => {
        db.all('SELECT amount, direction FROM profits WHERE user_id = ?', [user.user_id], (err2, rows) => {
          if (err2) {
            console.error(`❌ Ошибка чтения профитов юзера ${user.user_id}:`, err2);
            finish();
            return;
          }

          let xp = 0;
          const perRow = [];
          for (const row of rows) {
            const rowXp = battlepass.xpFromAmount(row.amount, row.direction);
            xp += rowXp;
            perRow.push({ amount: row.amount, direction: row.direction, xp: Math.round(rowXp * 1000) / 1000 });
          }
          xp = Math.round(xp * 1000) / 1000;

          if (DIAG) {
            const byDir = {};
            rows.forEach((r) => { byDir[r.direction] = (byDir[r.direction] || 0) + r.amount; });
            console.log(`--- ${user.username || user.user_id} (id=${user.user_id})`);
            console.log(`    battlepass_earned=${user.battlepass_earned}  battlepass_xp=${user.battlepass_xp}  profile_count=${user.profit_count}`);
            console.log(`    profit rows=${rows.length}  SUM(amount)=${rows.reduce((s, r) => s + r.amount, 0)}  by direction=${JSON.stringify(byDir)}`);
            console.log(`    xp по profits=${xp} (LVL ${battlepass.buildState(0, xp).level})`);
            console.log(`    xp по кассе=${Math.round((user.battlepass_earned || 0) / battlepass.RUB_PER_STEP * battlepass.XP_PER_STEP * 1000) / 1000} (LVL ${battlepass.buildState(0, Math.round((user.battlepass_earned || 0) / battlepass.RUB_PER_STEP * battlepass.XP_PER_STEP * 1000) / 1000).level})`);
            perRow.forEach((r) => console.log(`      ${r.amount}₽ dir=${r.direction} -> ${r.xp}xp`));
            finish();
            return;
          }

          report(user, xp, `profits: ${rows.length} строк`);
        });
      };

      if (FROM_EARNED) processEarned();
      else processProfits();
    });

    function report(user, xp, source) {
      const before = user.battlepass_xp || 0;
      const levelBefore = battlepass.buildState(0, before).level;
      const levelAfter = battlepass.buildState(0, xp).level;
      if (DIAG) {
        finish();
        return;
      }
      db.run('UPDATE users SET battlepass_xp = ? WHERE user_id = ?', [xp, user.user_id], (err3) => {
        if (err3) {
          console.error(`❌ Ошибка обновления юзера ${user.user_id}:`, err3);
        } else {
          console.log(
            `✅ ${user.username || user.user_id} (${user.name}): XP ${before} -> ${xp} (LVL ${levelBefore} -> ${levelAfter}), источник: ${source}`
          );
        }
        finish();
      });
    }

    function finish() {
      if (--pending === 0) {
        console.log('🎯 Пересчёт завершён');
        db.close();
      }
    }
  }
);
}
