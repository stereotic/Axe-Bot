const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.db');

// WAL mode для предотвращения SQLITE_BUSY при конкурентных чтениях/записях
db.run('PRAGMA journal_mode=WAL');
db.run('PRAGMA busy_timeout=5000');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    username TEXT,
    name TEXT DEFAULT '#',
    status TEXT DEFAULT 'NEW',
    balance INTEGER DEFAULT 0,
    total_earned INTEGER DEFAULT 0,
    battlepass_earned INTEGER DEFAULT 0,
    profit_count INTEGER DEFAULT 0,
    profile_hidden INTEGER DEFAULT 1,
    curator TEXT,
    percent INTEGER,
    worker_number INTEGER,
    application_approved INTEGER DEFAULT 0,
    referred_by INTEGER,
    referral_blocked INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Добавляем недостающие колонки если их нет
  db.run(`ALTER TABLE users ADD COLUMN profit_count INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding profit_count column:', err);
    }
  });
  db.run(`ALTER TABLE users ADD COLUMN battlepass_earned INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding battlepass_earned column:', err);
    }
  });
  db.run(`ALTER TABLE users ADD COLUMN battlepass_xp REAL DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding battlepass_xp column:', err);
    }
    // Миграция: накопленный прогресс считаем по старой ставке (0.5 XP / 10к),
    // чтобы никто не потерял уже заработанное.
    db.run(
      `UPDATE users SET battlepass_xp = CAST(COALESCE(battlepass_earned, 0) / 10000 AS INTEGER) * 0.5
       WHERE COALESCE(battlepass_xp, 0) = 0`,
      (migrateErr) => {
        if (migrateErr) {
          console.error('Error seeding battlepass_xp:', migrateErr);
        }
      }
    );
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

  // Реферальная система: кто привёл + заблокировал ли бота приведённый
  db.run(`ALTER TABLE users ADD COLUMN referred_by INTEGER`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding referred_by column:', err);
    }
  });
  db.run(`ALTER TABLE users ADD COLUMN referral_blocked INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding referral_blocked column:', err);
    }
  });

  // Колонки кошелька для выплат
  db.run(`ALTER TABLE users ADD COLUMN payout_method TEXT DEFAULT 'cryptobot'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding payout_method column:', err);
    }
  });
  db.run(`ALTER TABLE users ADD COLUMN trc20_address TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding trc20_address column:', err);
    }
  });
  db.run(`ALTER TABLE users ADD COLUMN bep20_address TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding bep20_address column:', err);
    }
  });

  // Добавляем колонку created_at в profits если её нет (для старых БД)
  db.run(`ALTER TABLE profits ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding created_at column to profits:', err);
    }
  });

  // Проставляем created_at для старых записей где его нет
  db.run(`UPDATE profits SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL`, (err) => {
    if (err) {
      console.error('Error backfilling created_at:', err);
    } else {
      console.log('✅ Backfilled NULL created_at in profits');
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
    check_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  )`);

  // Добавляем колонки для хранения файла чека в withdrawals
  db.run(`ALTER TABLE withdrawals ADD COLUMN check_file_id TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding check_file_id column:', err);
    }
  });
  db.run(`ALTER TABLE withdrawals ADD COLUMN check_file_type TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding check_file_type column:', err);
    }
  });
  db.run(`ALTER TABLE withdrawals ADD COLUMN payout_method TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding payout_method column:', err);
    }
  });
  db.run(`ALTER TABLE withdrawals ADD COLUMN wallet_address TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding wallet_address column:', err);
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS purchased_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    card_id INTEGER,
    purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (card_id) REFERENCES shop_cards(id)
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
    direction INTEGER DEFAULT 1,
    status TEXT DEFAULT 'sent',
    admin_message_id INTEGER,
    user_message_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    verified_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (card_id) REFERENCES card_requisites(id),
    FOREIGN KEY (request_id) REFERENCES card_requests(id)
  )`);

  // Добавляем колонку direction в checks если её нет (для старых БД)
  db.run(`ALTER TABLE checks ADD COLUMN direction INTEGER DEFAULT 1`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding direction to checks:', err);
    }
  });

  db.run(`INSERT OR IGNORE INTO stats (key, value) VALUES ('project_balance', '2000000')`);
  db.run(`INSERT OR IGNORE INTO stats (key, value) VALUES ('total_profits', '120')`);
  db.run(`INSERT OR IGNORE INTO stats (key, value) VALUES ('open_date', '03.03.2026')`);
  db.run(`INSERT OR IGNORE INTO stats (key, value) VALUES ('worker_counter', '0')`);
  // Однократно скрываем профили, существовавшие до включения приватности по умолчанию.
  db.run(`INSERT OR IGNORE INTO stats (key, value) VALUES ('profiles_hidden_migrated', '0')`);
  db.get(`SELECT value FROM stats WHERE key = 'profiles_hidden_migrated'`, (migrationErr, migration) => {
    if (migrationErr || migration?.value === '1') return;
    db.run(`UPDATE users SET profile_hidden = 1`, (updateErr) => {
      if (updateErr) console.error('Error hiding existing profiles:', updateErr);
      db.run(`UPDATE stats SET value = '1' WHERE key = 'profiles_hidden_migrated'`);
    });
  });

  db.run(`CREATE TABLE IF NOT EXISTS scheduled_broadcasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time TEXT UNIQUE,
    content_type TEXT,
    text TEXT,
    file_id TEXT,
    target TEXT DEFAULT 'all',
    last_sent_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Билеты на розыгрыши (призы AXE PASS с ticketName)
  db.run(`CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    prize_level INTEGER,
    prize_title TEXT,
    ticket_number TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  )`);

  // Выданные уведомления о разблокировке закрытых чатов по статусам
  db.run(`CREATE TABLE IF NOT EXISTS chat_unlocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    chat_key TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, chat_key),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  )`);

  // Авто-публикация профитов (фейковые воркеры для кассы и чата)
  db.run(`CREATE TABLE IF NOT EXISTS auto_profit_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    amounts TEXT NOT NULL,
    direction INTEGER DEFAULT 1,
    time_from INTEGER DEFAULT 0,
    time_to INTEGER DEFAULT 23,
    interval_from INTEGER DEFAULT 60,
    interval_to INTEGER DEFAULT 90,
    enabled INTEGER DEFAULT 1,
    total_amount INTEGER DEFAULT 0,
    profit_count INTEGER DEFAULT 0,
    last_profit_at INTEGER,
    amounts_pos INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Позиция очереди сумм для авто-публикации (для старых БД)
  db.run(`ALTER TABLE auto_profit_users ADD COLUMN amounts_pos INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding amounts_pos to auto_profit_users:', err);
    }
  });

  db.run(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_application_approved ON users(application_approved)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_profits_user_id ON profits(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_profits_created_at ON profits(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_applications_user_id ON applications(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status)`);
});

module.exports = db;
