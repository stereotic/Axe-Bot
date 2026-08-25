// Слияние двух «рисованых» воркеров в один аккаунт.
// Появился после старого бага: один фейковый человек вбивался под разными
// никами и расползался на несколько аккаунтов с разными id.
//
// Что делает:
//   1. Переносит все profits с исходного аккаунта на целевой (+ доли идут за ними).
//   2. Догоняет целевому баланс/кассу/пасс-XP/счётчик профитов из исходного.
//   3. Перепривязывает ссылки на user_id (выплаты, заявки, тикеты и т.д.).
//   4. Если у целевого id ниже фейковой границы (FAKE_USER_ID_MIN = 10 млрд,
//      старый генератор) — перебивает его в новый фейковый id, иначе следующий
//      вброс того же ника снова создаст дубликат-аккаунт.
//   5. Удаляет исходный аккаунт.
//
// Запуск НА СЕРВЕРЕ, при остановленном боте:
//   node scripts/merge_tovarov_to_cardinal.js              — сухой прогон (только план)
//   node scripts/merge_tovarov_to_cardinal.js --apply      — выполнить
// Опционально можно передать свои ники/id:
//   node scripts/merge_tovarov_to_cardinal.js --apply tovarov_rf23 Cardinal

const db = require('../database');
const utils = require('../utils');

const FAKE_USER_ID_MIN = 10000000000;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const positional = args.filter((a) => !a.startsWith('--'));
const FROM_KEY = positional[0] || 'tovarov_rf23';
const TO_KEY = positional[1] || 'Cardinal';

const dbRunP = (sql, params = []) => new Promise((res, rej) =>
  db.run(sql, params, (err) => (err ? rej(err) : res()))
);
const dbGetP = (sql, params = []) => new Promise((res, rej) =>
  db.get(sql, params, (err, row) => (err ? rej(err) : res(row)))
);

function fmtUser(u) {
  return u
    ? `id=${u.user_id} @${u.username} (${u.name}) | касса=${u.total_earned}₽ профитов=${u.profit_count} баланс=${u.balance}₽`
    : 'НЕ НАЙДЕН';
}

async function resolveAccount(key) {
  if (/^\d+$/.test(String(key))) {
    return dbGetP('SELECT * FROM users WHERE user_id = ?', [Number(key)]);
  }
  const tag = `#${String(key).replace(/^[@#]+/, '')}`.toLowerCase();
  const lower = String(key).toLowerCase();
  const rows = await new Promise((res, rej) =>
    db.all(
      `SELECT * FROM users
       WHERE LOWER(TRIM(COALESCE(username, ''))) = ? OR LOWER(TRIM(COALESCE(name, ''))) = ?
       ORDER BY user_id`,
      [lower, tag],
      (err, r) => (err ? rej(err) : res(r || []))
    )
  );
  if (rows.length > 1) {
    console.error(`❌ Ключ «${key}» совпал с несколькими аккаунтами — укажи id явно:`);
    rows.forEach((r) => console.error(`   ${fmtUser(r)}`));
    process.exitCode = 1;
    return null;
  }
  return rows[0] || null;
}

// Таблицы со ссылкой на пользователя — переносим исторические записи тоже.
const REF_TABLES = [
  'profits', 'withdrawals', 'applications', 'checks', 'card_requests',
  'tickets', 'chat_unlocks', 'pass_gift_notified', 'purchased_cards'
];

(async () => {
  const from = await resolveAccount(FROM_KEY);
  const to = await resolveAccount(TO_KEY);

  console.log('Исходный (удаляется): ', fmtUser(from));
  console.log('Целевой (выживает):   ', fmtUser(to));

  if (!from || !to) { console.error('❌ Аккаунт не найден, выходим.'); db.close(); return; }
  if (from.user_id === to.user_id) { console.error('❌ Это один и тот же аккаунт.'); db.close(); return; }

  const movedProfits = await dbGetP('SELECT COUNT(*) c, COALESCE(SUM(amount), 0) s FROM profits WHERE user_id = ?', [from.user_id]);
  console.log(`Профитов к переносу: ${movedProfits.c} на сумму ${movedProfits.s}₽`);

  const needRekey = to.user_id < FAKE_USER_ID_MIN;
  const newId = needRekey ? Date.now() + Math.floor(Math.random() * 10000) : to.user_id;
  if (needRekey) {
    console.log(`⚠️ У целевого id ${to.user_id} ниже фейковой границы — будет перебит на ${newId}, чтобы вбросы «${to.username}» больше не плодили дубликатов.`);
  }

  if (!APPLY) {
    console.log('\n— Сухой прогон. Для применения добавь --apply —');
    db.close();
    return;
  }

  try {
    // 1. Профиты исходника → целевой (profit_shares ссылаются на profit_id и едут сами).
    await dbRunP('UPDATE profits SET user_id = ? WHERE user_id = ?', [to.user_id, from.user_id]);

    // 2. Исторические ссылки.
    for (const t of REF_TABLES) {
      if (t === 'profits') continue;
      await dbRunP(`UPDATE ${t} SET user_id = ? WHERE user_id = ?`, [to.user_id, from.user_id]).catch(() => {});
    }

    // 3. Рефералы исходника теперь висят на целевом.
    await dbRunP('UPDATE users SET referred_by = ? WHERE referred_by = ?', [to.user_id, from.user_id]);

    // 4. Догоняем счётчики и пересчитываем статус.
    const mergedTotal = (to.total_earned || 0) + (from.total_earned || 0);
    await dbRunP(
      `UPDATE users SET
        balance = balance + ?,
        total_earned = total_earned + ?,
        battlepass_earned = COALESCE(battlepass_earned, 0) + ?,
        battlepass_xp = COALESCE(battlepass_xp, 0) + ?,
        profit_count = profit_count + ?,
        status = ?
       WHERE user_id = ?`,
      [
        from.balance || 0,
        from.total_earned || 0,
        from.battlepass_earned || 0,
        from.battlepass_xp || 0,
        from.profit_count || 0,
        utils.getStatusByTotal(mergedTotal),
        to.user_id
      ]
    );

    // 5. Перебиваем низкий id целевого в фейковый диапазон.
    if (needRekey) {
      await dbRunP('UPDATE users SET user_id = ? WHERE user_id = ?', [newId, to.user_id]);
      await dbRunP('UPDATE profits SET user_id = ? WHERE user_id = ?', [newId, to.user_id]);
      for (const t of REF_TABLES) {
        if (t === 'profits') continue;
        await dbRunP(`UPDATE ${t} SET user_id = ? WHERE user_id = ?`, [newId, to.user_id]).catch(() => {});
      }
      await dbRunP('UPDATE users SET referred_by = ? WHERE referred_by = ?', [newId, to.user_id]);
    }

    // 6. Исходник больше не нужен.
    await dbRunP('DELETE FROM users WHERE user_id = ?', [from.user_id]);

    // 7. Контроль.
    const finalRow = await dbGetP(
      `SELECT user_id, username, name, balance, total_earned, profit_count,
              battlepass_earned, battlepass_xp, status
       FROM users WHERE user_id = ?`,
      [newId]
    );
    const leftover = await dbGetP('SELECT COUNT(*) c FROM profits WHERE user_id = ?', [from.user_id]);
    console.log('\n✅ Готово. Итоговый аккаунт:', JSON.stringify(finalRow, null, 1));
    console.log(`Оставшихся профитов у удалённого аккаунта: ${leftover.c}`);
  } catch (err) {
    console.error('❌ Ошибка слияния:', err.message);
  } finally {
    db.close();
  }
})();
