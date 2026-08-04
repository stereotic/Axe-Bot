const fs = require('fs');
const db = require('./database');

const FILE = './profit_list.txt';

function findUser(nameOrUsername) {
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
          resolve(null);
          return;
        }
        resolve(rows[0]);
      }
    );
  });
}

function parseAmount(raw) {
  const digits = String(raw).replace(/[^\d]/g, '');
  return digits.length > 0 ? parseInt(digits, 10) : null;
}

function parseDate(raw) {
  const s = String(raw).trim();

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m}-${d} 00:00:00`;
  }

  const ru = s.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/);
  if (ru) {
    let [, d, m, y] = ru;
    if (!y) y = new Date().getFullYear().toString();
    if (y.length === 2) y = '20' + y;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')} 00:00:00`;
  }

  return null;
}

function deleteProfit(userId, amount, created_at) {
  return new Promise((resolve) => {
    db.run(
      'DELETE FROM profits WHERE user_id = ? AND amount = ? AND created_at = ?',
      [userId, amount, created_at],
      function(err) {
        if (err) {
          resolve({ ok: false, err });
          return;
        }
        resolve({ ok: true, deleted: this.changes });
      }
    );
  });
}

async function main() {
  if (!fs.existsSync(FILE)) {
    console.log(`Файл ${FILE} не найден.`);
    db.close();
    return;
  }

  const lines = fs.readFileSync(FILE, 'utf8')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('//'));

  if (lines.length === 0) {
    console.log('Файл пуст.');
    db.close();
    return;
  }

  let removed = 0;

  for (const line of lines) {
    const parts = line.split('/').map(p => p.trim());
    if (parts.length < 2 || parts.length > 3) {
      console.log(`❌ Непонятный формат: "${line}"`);
      continue;
    }

    const [name, amountRaw, dateRaw] = parts;
    const amount = parseAmount(amountRaw);
    if (amount === null) {
      console.log(`❌ Нет суммы: "${line}"`);
      continue;
    }

    const created_at = dateRaw ? parseDate(dateRaw) : null;
    if (!created_at) {
      console.log(`❌ Нет/кривая дата: "${line}"`);
      continue;
    }

    const user = await findUser(name);
    if (!user) {
      console.log(`⚠️  ${name} — воркер не найден, пропускаю`);
      continue;
    }

    const res = await deleteProfit(user.user_id, amount, created_at);
    if (!res.ok) {
      console.log(`❌ ${name} — ошибка удаления: ${res.err.message}`);
      continue;
    }

    removed += res.deleted;
    console.log(`${res.deleted > 0 ? '🗑' : '⏭'} ${name} / ${amount.toLocaleString('ru-RU')}₽ / ${created_at.slice(0, 10)} — удалено строк: ${res.deleted}`);
  }

  console.log(`\nУдалено профитов: ${removed}`);
  console.log('users/stat не трогались — это всё, что менялось при вставке.');
  db.close();
}

main();
