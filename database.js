const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    username TEXT,
    name TEXT DEFAULT '#',
    status TEXT DEFAULT 'NEW',
    balance INTEGER DEFAULT 0,
    total_earned INTEGER DEFAULT 0,
    profit_count INTEGER DEFAULT 0,
    profile_hidden INTEGER DEFAULT 0,
    curator TEXT,
    percent INTEGER,
    worker_number INTEGER,
    application_approved INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Добавляем недостающие колонки если их нет
  db.run(`ALTER TABLE users ADD COLUMN profit_count INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding profit_count column:', err);
    }
  });
  db.run(`ALTER TABLE users ADD COLUMN welcome_keyboard_sent INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding welcome_keyboard_sent column:', err);
    }
    // Уже принятые до появления флага — не заставлять подавать заявку заново
    db.run(
      `UPDATE users SET welcome_keyboard_sent = 1 WHERE application_approved = 1 AND COALESCE(welcome_keyboard_sent, 0) = 0`,
      (migrateErr) => {
        if (migrateErr) {
          console.error('Error migrating welcome_keyboard_sent:', migrateErr);
        }
      }
    );
  });
  db.run(`CREATE TABLE IF NOT EXISTS profits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount INTEGER,
    amount_to_pay INTEGER,
    direction INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  )`);

  // Добавляем колонку amount_to_pay если её нет
  db.run(`ALTER TABLE profits ADD COLUMN amount_to_pay INTEGER`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding amount_to_pay column:', err);
    }
  });

  // Добавляем колонку direction если её нет
  db.run(`ALTER TABLE profits ADD COLUMN direction INTEGER`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding direction column:', err);
    }
  });

  // Добавляем колонку worker_number если её нет
  db.run(`ALTER TABLE users ADD COLUMN worker_number INTEGER`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding worker_number column:', err);
    }
  });

  // Добавляем колонку created_at в profits если её нет (для старых БД)
  db.run(`ALTER TABLE profits ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding created_at column to profits:', err);
    }
  });
  db.run(`CREATE TABLE IF NOT EXISTS profit_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profit_id INTEGER,
    role TEXT,
    percentage INTEGER,
    amount INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (profit_id) REFERENCES profits(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_info TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS stats (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS shop_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    country TEXT,
    region TEXT,
    bin TEXT,
    bank TEXT,
    card_type TEXT,
    price INTEGER,
    card_number TEXT,
    exp_date TEXT,
    cvv TEXT,
    zip TEXT,
    city TEXT,
    address TEXT,
    phone TEXT,
    email TEXT,
    ssn TEXT,
    available INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount INTEGER,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS purchased_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    card_id INTEGER,
    purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (card_id) REFERENCES shop_cards(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount INTEGER,
    status TEXT DEFAULT 'pending',
    check_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS profit_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profit_id INTEGER,
    role TEXT,
    percentage INTEGER,
    amount INTEGER,
    FOREIGN KEY (profit_id) REFERENCES profits(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    question1 TEXT,
    question2 TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  )`);

  // Таблица реквизитов
  db.run(`CREATE TABLE IF NOT EXISTS card_requisites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gender TEXT,
    country TEXT DEFAULT 'RU',
    percent INTEGER,
    min_limit INTEGER,
    max_limit INTEGER,
    card_number TEXT,
    bank TEXT,
    full_name TEXT,
    notes TEXT,
    is_temporary INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(user_id)
  )`);

  // Таблица запросов на реквизиты
  db.run(`CREATE TABLE IF NOT EXISTS card_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount INTEGER,
    gender TEXT,
    hold_hours INTEGER,
    status TEXT DEFAULT 'pending',
    admin_id INTEGER,
    card_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (admin_id) REFERENCES users(user_id),
    FOREIGN KEY (card_id) REFERENCES card_requisites(id)
  )`);

  // Таблица чеков
  db.run(`CREATE TABLE IF NOT EXISTS checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    card_id INTEGER,
    request_id INTEGER,
    file_id TEXT,
    file_type TEXT,
    amount INTEGER,
    status TEXT DEFAULT 'sent',
    admin_message_id INTEGER,
    user_message_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    verified_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (card_id) REFERENCES card_requisites(id),
    FOREIGN KEY (request_id) REFERENCES card_requests(id)
  )`);

  db.run(`INSERT OR IGNORE INTO stats (key, value) VALUES ('project_balance', '2000000')`);
  db.run(`INSERT OR IGNORE INTO stats (key, value) VALUES ('total_profits', '120')`);
  db.run(`INSERT OR IGNORE INTO stats (key, value) VALUES ('open_date', '03.03.2026')`);
  db.run(`INSERT OR IGNORE INTO stats (key, value) VALUES ('worker_counter', '0')`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_application_approved ON users(application_approved)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_profits_user_id ON profits(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_profits_created_at ON profits(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_applications_user_id ON applications(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status)`);
});

module.exports = db;
