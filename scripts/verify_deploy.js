const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pinned = fs.readFileSync(path.join(root, 'update_pinned.js'), 'utf8');
const utils = fs.readFileSync(path.join(root, 'utils.js'), 'utf8');

const ok = [];
const bad = [];

if (pinned.includes('13700')) bad.push('update_pinned.js всё ещё содержит захардкоженную 13700');
else ok.push('update_pinned.js без 13700');

if (pinned.includes('getDailyStats')) ok.push('update_pinned.js считает кассу за сутки из БД');
else bad.push('update_pinned.js без getDailyStats');

if (utils.includes("NOT LIKE '%тестик%'")) ok.push('utils.js фильтр тестовых имён');
else bad.push('utils.js без расширенного фильтра топов');

console.log('Проверка кода для деплоя:\n');
ok.forEach((m) => console.log('  OK:', m));
bad.forEach((m) => console.log('  FAIL:', m));
if (bad.length) process.exit(1);
