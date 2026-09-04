// single_instance.js — защита от нескольких одновременно запущенных экземпляров.
// Лок-файл с PID: второй процесс с тем же BOT_TOKEN выходит с ошибкой.

const fs = require('fs');
const path = require('path');


// Возвращает { ok: true, release } или { ok: false, message }.
function acquire(name = 'bot') {
  const safeName = String(name).replace(/[^a-z0-9_-]/gi, '_');
  const lockPath = path.join(__dirname, `${safeName}.lock`);
  try {
    if (fs.existsSync(lockPath)) {
      const raw = fs.readFileSync(lockPath, 'utf8');
      const old = JSON.parse(raw || '{}');
      if (old.pid) {
        try {
          // signal 0 — проверка существования процесса без его завершения.
          // На Windows также работает: бросает ESRCH, если процесса нет.
          process.kill(old.pid, 0);
          return { ok: false, message: `Бот уже запущен (PID ${old.pid}). Запустите только один экземпляр бота.` };
        } catch (e) {
          // Процесс не жив — занимаем лок заново.
        }
      }
    }
  } catch (_) { /* битый лок-файл — перезаписываем */ }

  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));

  const release = () => {
    try {
      const cur = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      if (cur.pid === process.pid) fs.unlinkSync(lockPath);
    } catch (_) { /* уже удалён */ }
  };

  process.on('exit', release);
  process.on('SIGINT', () => { release(); process.exit(0); });
  process.on('SIGTERM', () => { release(); process.exit(0); });

  return { ok: true, release };
}

module.exports = { acquire };
