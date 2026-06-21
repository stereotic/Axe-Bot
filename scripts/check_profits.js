const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('./database.db');

// Check all profits with amount 34000 or similar
db.all("SELECT p.id, p.user_id, p.amount, p.amount_to_pay, p.direction, p.created_at, u.username, u.name FROM profits p LEFT JOIN users u ON p.user_id = u.user_id WHERE p.amount = 34000 OR p.user_id = 0 ORDER BY p.created_at", (err, rows) => {
  if (err) { console.error(err); return; }
  console.log("=== ALL PROFITS WITH AMOUNT=34000 OR USER_ID=0 ===");
  console.log(JSON.stringify(rows, null, 2));
  
  // Also check total profits count
  db.all("SELECT COUNT(*) as cnt, SUM(amount) as total FROM profits", (err, stats) => {
    if (err) { console.error(err); return; }
    console.log("\n=== TOTAL PROFITS STATS ===");
    console.log(JSON.stringify(stats, null, 2));
    db.close();
  });
});
