const db = require('./database');
const targetUserId = 7397120996;

db.run("DELETE FROM profit_shares WHERE profit_id IN (SELECT id FROM profits WHERE user_id = ?)", [targetUserId], () => {
  db.run("DELETE FROM profits WHERE user_id = ?", [targetUserId], () => {
    db.run("UPDATE users SET total_earned = 0, profit_count = 0, balance = 0 WHERE user_id = ?", [targetUserId], () => {
      console.log('OK: profilet udaleny');
      process.exit(0);
    });
  });
});
