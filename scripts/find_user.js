const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('./database.db');

// 1. Find the user
db.all("SELECT user_id, username, name, worker_number, status, total_earned, profit_count, balance FROM users WHERE username LIKE '%EBY%' OR username LIKE '%Worker442%' OR name LIKE '%Worker442%' OR name LIKE '%442%' OR name LIKE '%EBY%'", (err, rows) => {
  if (err) { console.error(err); return; }
  console.log("=== USERS FOUND ===");
  console.log(JSON.stringify(rows, null, 2));
  
  if (rows.length > 0) {
    const userId = rows[0].user_id;
    // 2. Get all profits for this user
    db.all("SELECT id, user_id, amount, amount_to_pay, direction, created_at FROM profits WHERE user_id = ? ORDER BY created_at", [userId], (err, profits) => {
      if (err) { console.error(err); return; }
      console.log("\n=== PROFITS FOR USER ===");
      console.log(JSON.stringify(profits, null, 2));
      db.close();
    });
  } else {
    // Try broader search
    db.all("SELECT user_id, username, name, worker_number, status, total_earned, profit_count, balance FROM users WHERE user_id = 7724391618", (err, rows2) => {
      if (err) { console.error(err); return; }
      console.log("\n=== SEARCH BY USER_ID 7724391618 ===");
      console.log(JSON.stringify(rows2, null, 2));
      
      // Search all users to find close matches
      db.all("SELECT user_id, username, name, worker_number, status, total_earned, profit_count, balance FROM users ORDER BY user_id", (err, allUsers) => {
        if (err) { console.error(err); return; }
        console.log("\n=== ALL USERS ===");
        console.log(JSON.stringify(allUsers, null, 2));
        db.close();
      });
    });
  }
});
