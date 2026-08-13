// Конфигурация кураторов: единый источник для бота и обработчиков.
const mentors = [
  {
    username: 'Maximus_AXE',
    userId: null, // ID будет установлен при первом взаимодействии (/cur или закреплении)
    banner: 'mentor_banner.jpg',
    service: 'Букмекер',
    hiredAt: '13.08.2026', // Дата найма для подсчета «На должности»
    percent: 20,
    trainingProfits: 5, // Количество профитов для обучения
    workingHours: '12:00 - 23:00',
    description: `Индивидуально подхожу к каждому подопечному, подробно разбираем не только специфику направления но и нюансы социальной инженерии. Отвечу на все ваши вопросы и развею все ваши сомнения касательно ворка и направления в целом. Прокачаем ваши сильные стороны и проработаем слабые, покажу и расскажу секреты трафика, поделюсь личными наработками, посвящу в тонкости психологии. Все происходит на практике, любые теоретические знания будем закреплять не только практикой, а конкретными цифрами профитов. Доведу за руку до первых результатов новичков сферы, а так же откорректирую и направлю матерых волков индустрии.`,
    benefits: `• Передачу личного опыта которого нет ни в одном мануале
• Базу и азы для ворка не только данного направления
• Менторство и прокачку социальной инженерии
• Гибкое мышление которое поможет обойти любые заборы мамонтов
• Скиллы для самостоятельной работы в кротчайшие сроки`
  },
  {
    username: 'Arachnophobia_AXE',
    userId: null,
    banner: 'mentor_alprazalam.jpg',
    service: 'Кардинг, Букмекер',
    hiredAt: '05.08.2026',
    percent: 20,
    trainingProfits: 5,
    workingHours: '13:00 - 00:00',
    description: `Активный и опытный воркер. Обучу работе с разнообразным трафиком, так же дам советы и актуальные способы в поиске трафика, доведу твои навыки до совершенства. Перед обучение просьба ознакомиться с базовым мануалом по кардингу. Найду индивидуальный подход к каждому воркеру, отвечу на каждый ваш вопрос и наставлю на четкую и профессиональную работу. Покажу на вашем примере, что если есть цель и желание, то большие профиты окажутся в ваших руках.`,
    benefits: `• Обучение без мануалов!
• Материалы для работы за твой %
• Обучение по качественной обработке трафика
• Психологические маневры для большего шанса успеха на профит`
  }
];

function normalizeUsername(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function getMentorByIndex(index) {
  return mentors[index] || null;
}

function getMentorByUsername(username) {
  const needle = normalizeUsername(username);
  if (!needle) return null;
  return mentors.find((m) => normalizeUsername(m.username) === needle) || null;
}

// Резолвим Telegram ID куратора: сначала in-memory, затем по users таблице (username/name).
function resolveMentorChatId(db, mentor, callback) {
  if (mentor.userId) {
    callback(mentor.userId);
    return;
  }
  const needle = normalizeUsername(mentor.username);
  db.get(
    'SELECT user_id FROM users WHERE LOWER(username) = ? OR LOWER(name) = ? LIMIT 1',
    [needle, needle],
    (err, row) => {
      if (!err && row) {
        mentor.userId = row.user_id;
        callback(row.user_id);
        return;
      }
      callback(null);
    }
  );
}

// Процент куратора с профита: приоритет у записи ученика, фолбэк — конфиг куратора.
function resolveCuratorPercent(studentPercent, curatorUsername) {
  if (studentPercent && Number(studentPercent) > 0) return Number(studentPercent);
  const mentor = getMentorByUsername(curatorUsername);
  return mentor ? Number(mentor.percent) : 20;
}

const fmtRus = (n) => Number(n).toLocaleString('ru-RU').replace(/,/g, '.');

// Уведомление куратору о профите ученика: Твой ученик совершил профит!
function notifyCuratorOfProfit(bot, db, profit) {
  if (!profit || !profit.curator) return;
  const mentor = getMentorByUsername(profit.curator);
  if (!mentor) return;

  const percent = resolveCuratorPercent(profit.percent, profit.curator);
  const amount = Number(profit.amount) || 0;
  const curatorCut = Math.floor(amount * percent / 100);
  const student = String(profit.username || profit.name || '').replace(/^[@#]+/, '');
  const studentLabel = student ? `@${student}` : 'ID';
  const directionName = profit.directionName || 'Кардинг';

  const text = `<b><tg-emoji emoji-id="5445088267181531740">🪓</tg-emoji>Твой ученик совершил профит!

Ученик: ${studentLabel}
Сервис: ${directionName}, (БК)
Сумма: ${fmtRus(amount)}₽
Твой профит: ${percent}% (${fmtRus(curatorCut)}₽)</b>`;

  resolveMentorChatId(db, mentor, (mentorChatId) => {
    if (!mentorChatId) return;
    bot.sendMessage(mentorChatId, text, { parse_mode: 'HTML' }).catch((err) => {
      console.error('Error sending curator profit notification:', err);
    });
  });
}

module.exports = {
  mentors,
  getMentorByIndex,
  getMentorByUsername,
  resolveMentorChatId,
  resolveCuratorPercent,
  notifyCuratorOfProfit
};
