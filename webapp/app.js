const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

const track = document.getElementById('track');
const dots = document.getElementById('dots');
const loader = document.getElementById('loader');
const fatal = document.getElementById('fatal');
const fatalText = document.getElementById('fatalText');

const prevBtn = document.getElementById('navPrev');
const nextBtn = document.getElementById('navNext');
let currentIdx = 0;

function slideWidth() {
  return track.clientWidth || window.innerWidth;
}

function updateNav() {
  const total = track.children.length;
  prevBtn.disabled = currentIdx <= 0;
  nextBtn.disabled = currentIdx >= total - 1;
}

function updateDots() {
  [...dots.children].forEach((d, i) => d.classList.toggle('on', i === currentIdx));
}

function goTo(index, smooth) {
  if (index < 0 || index >= track.children.length) return;
  currentIdx = index;
  track.scrollTo({ left: slideWidth() * index, behavior: smooth ? 'smooth' : 'instant' });
  updateNav();
  updateDots();
}

function syncIndex() {
  const i = Math.round(track.scrollLeft / slideWidth());
  if (i !== currentIdx) {
    currentIdx = i;
    updateNav();
    updateDots();
  }
}

prevBtn.addEventListener('click', () => goTo(currentIdx - 1, true));
nextBtn.addEventListener('click', () => goTo(currentIdx + 1, true));
track.addEventListener('scroll', () => requestAnimationFrame(syncIndex), { passive: true });

function fmtRub(n) {
  return Math.round(n).toLocaleString('ru-RU').replace(/ /g, '.') + '₽';
}

function fmtXp(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function render(state) {
  document.getElementById('headLevel').textContent = `LVL ${state.level}`;
  const percentEl = document.getElementById('headPercent');
  const totalPercent = Math.round(state.levelProgress * 100);
  percentEl.textContent = `${totalPercent}%`;
  percentEl.classList.toggle('done', totalPercent >= 100);
  document.getElementById('barFill').style.width = `${Math.round(state.levelProgress * 100)}%`;
  document.getElementById('metaMain').textContent =
    state.level >= state.maxLevel
      ? 'ПАСС ПРОЙДЕН 🏆'
      : `до LVL ${state.level + 1}: ${fmtXp(state.xpToNext)} XP (${fmtRub(state.rubToNext)})`;
  document.getElementById('metaProgress').textContent =
    `касса ${fmtRub(state.totalEarned)} · ${Math.round(state.totalProgress * 100)}%`;

  const nextIndex = state.levels.findIndex((l) => !l.unlocked);

  track.innerHTML = state.levels.map((lvl) => {
    const isUnlocked = lvl.unlocked;
    const isNext = !isUnlocked && lvl.level === nextIndex + 1;
    const cls = isUnlocked ? 'done' : (isNext ? 'next' : 'locked');

    let tag, tagCls;
    if (isUnlocked) { tag = '✓ ОТКРЫТ'; tagCls = 'tag-done'; }
    else if (isNext) { tag = 'СЛЕДУЮЩИЙ ПРИЗ'; tagCls = 'tag-next'; }
    else { tag = '🔒 ЗАКРЫТ'; tagCls = 'tag-locked'; }

    const reqText = isUnlocked
      ? `<span class="ok">Получен</span>`
      : `<span class="req-val">${fmtXp(lvl.requiredXp)} XP · ${fmtRub(lvl.requiredRub)}</span>`;

    const linkHtml = isUnlocked && lvl.link
      ? `<a class="link" href="${esc(lvl.link)}" data-tglink="1">Посмотреть подарок →</a>`
      : '';

    return `
      <section class="slide">
        <article class="card ${cls}">
          <div class="art">
            <img src="${esc(lvl.image)}" alt="${esc(lvl.title)}" draggable="false" loading="lazy">
            <span class="art-tag ${tagCls}">${tag}</span>
          </div>
          <div class="card-body">
            <span class="lvl-badge">LVL ${lvl.level}</span>
            <h2 class="title">${esc(lvl.title)}</h2>
            <div class="card-req">${reqText}</div>
            ${linkHtml}
          </div>
        </article>
      </section>`;
  }).join('');

  dots.innerHTML = state.levels.map(() => '<div class="dot"></div>').join('');

  // Ссылки на NFT открываем средствами Telegram, а не внутренним webview.
  track.querySelectorAll('[data-tglink]').forEach((a) => {
    a.addEventListener('click', (e) => {
      if (!tg || !tg.openTelegramLink) return;
      e.preventDefault();
      tg.openTelegramLink(a.getAttribute('href'));
    });
  });

  // Стартуем на следующем призе — сразу видно, за что бьёшься.
  const startIdx = nextIndex > 0 ? nextIndex : 0;
  currentIdx = startIdx;
  updateNav();
  updateDots();
  requestAnimationFrame(() => goTo(startIdx, false));
}

function die(text) {
  loader.classList.add('hide');
  fatalText.textContent = text;
  fatal.hidden = false;
}

window.addEventListener('error', (e) => {
  if (fatal.hidden && e && e.message) die('Сбой мини-аппа: ' + e.message);
});

window.addEventListener('unhandledrejection', (e) => {
  if (fatal.hidden) die('Сбой мини-аппа: ' + (e.reason && e.reason.message ? e.reason.message : 'unknown'));
});

async function boot() {
  window.__bpBooted = true;

  if (tg) {
    tg.ready();
    tg.expand();
    if (tg.setHeaderColor) tg.setHeaderColor('#07060c');
    if (tg.setBackgroundColor) tg.setBackgroundColor('#07060c');
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
  }

  const qs = new URLSearchParams(location.search);
  const params = new URLSearchParams();
  if (tg && tg.initData) params.set('initData', tg.initData);
  if (qs.get('user_id')) params.set('user_id', qs.get('user_id'));
  if (qs.get('earned')) params.set('earned', qs.get('earned'));

  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), 12000);

  try {
    const res = await fetch(`/api/state?${params.toString()}`, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(killer);

    if (res.status === 401) return die('Открой батл пасс кнопкой в профиле бота.');
    if (res.status === 404) return die('Профиль не найден. Нажми /start в боте.');
    if (!res.ok) return die(`Сервер вернул ${res.status}. Бот или npm run bp не запущены.`);

    render(await res.json());
    loader.classList.add('hide');
  } catch (e) {
    clearTimeout(killer);
    die('Нет связи с сервером: ' + (e && e.message ? e.message : 'timeout'));
  }
}

boot();
