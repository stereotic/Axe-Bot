const db = require('./database');

const updates = [
  ['#Ебырь', 20],
  ['gelikkkkik', 17],
  ['#Куколд', 1],
  ['#ннчик', 5],
  ['#LilTug52', 5],
  ['#AlekseyAdmin01', 8],
  ['#Safonow1', 4],
  ['#Психоzz', 6],
  ['#ЛяяямДвести', 1],
  ['phobiatype', 1],
  ['#Worker442', 4],
  ['EBYKAK666', 6],
  ['#Mr_TOKAPb', 1],
  ['exchange_onlycash', 4],
  ['#Denvr4ik', 1],
  ['#AEZAKMI', 27],
  ['#Astaroth', 1],
  ['#ManMaksim', 2],
];

let i = 0;
const run = () => {
  if (i >= updates.length) { console.log('✅ Готово'); db.close(); return; }
  const [name, count] = updates[i++];
  db.run('UPDATE users SET profit_count = ? WHERE (name = ? OR name = ?)',
    [count, name, '@' + name.replace(/^[#@]/, '')],
    function(err) {
      if (err) console.error(`❌ ${name}:`, err);
      else if (this.changes === 0) console.log(`❌ ${name} — не найден`);
      else console.log(`✅ ${name} → ${count}`);
      run();
    }
  );
};
run();
