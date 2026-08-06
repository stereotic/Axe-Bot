const db = require('./database');
const battlepass = require('./battlepass');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Использование: node add_profit.js <user_id> <amount> [name]');
  console.log('Пример: node add_profit.js 7974494724 381468 "#QRXES"');
  db.close();
  process.exit(0);
}

const userId = parseInt(args[0]);
const amount = parseInt(args[1]);
const name = args[2] || null;

// Добавляем профит
const now = new Date();
const dateStr = now.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

db.run('INSERT INTO profits (user_id, amount, amount_to_pay, direction, created_at) VALUES (?, ?, ?, 1, ?)',
  [userId, amount, amount, dateStr],
  function(err) {
    if (err) { console.error('❌ Ошибка:', err); db.close(); return; }
    console.log(`✅ Профит ${amount}₽ добавлен юзеру ${userId}`);
    
    // Ручной новый профит также учитывается в прогрессе AXE PASS.
    const xpGain = battlepass.xpFromAmount(amount, 1); // direction 1 = Кардинг
    db.run(`UPDATE users SET
        total_earned = COALESCE(total_earned, 0) + ?,
        battlepass_earned = COALESCE(battlepass_earned, 0) + ?,
        battlepass_xp = COALESCE(battlepass_xp, 0) + ?
        WHERE user_id = ?`,
      [amount, amount, xpGain, userId],
      function(err2) {
        if (err2) console.error('❌ Ошибка total_earned:', err2);
        else console.log(`✅ total_earned +${amount}₽`);
        
        // Обновляем имя если указано
        if (name) {
          db.run('UPDATE users SET name = ? WHERE user_id = ?', [name, userId], function(err3) {
            if (err3) console.error('❌ Ошибка name:', err3);
            else console.log(`✅ Имя: ${name}`);
            db.close();
          });
        } else {
          db.close();
        }
      }
    );
  }
);
