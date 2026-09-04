// Кнопка мини-аппа. Telegram принимает web_app только по https — иначе строку не рисуем.
// URL читаем из .env при КАЖДОМ показе профиля: туннель перезапускается с новым адресом,
// и кнопка подхватывает его без перезапуска бота.
const fs = require('fs');
const path = require('path');
const PRODUCTION_BATTLEPASS_URL = 'https://axe.crystalcards.store';

// URL мини-аппа кэшируем на 30с: перезапущенный туннель подхватывается без
// перезапуска бота, но .env не читается с диска при каждом показе меню.
const BATTLEPASS_CACHE_TTL = 30000;
let battlePassCache = { url: null, at: 0 };

function getBattlePassUrl() {
  const now = Date.now();
  if (battlePassCache.url !== null && now - battlePassCache.at < BATTLEPASS_CACHE_TTL) {
    return battlePassCache.url;
  }

  try {
    const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const m = env.match(/^BATTLEPASS_URL=(.*)$/m);
    let url = PRODUCTION_BATTLEPASS_URL;
    if (m && /^https:\/\//.test(m[1].trim()) && !/\.trycloudflare\.com\/?$/.test(m[1].trim())) {
      url = m[1].trim();
    }
    battlePassCache = { url, at: now };
    return url;
  } catch (e) { /* .env нет — кнопки не будет */ }
  battlePassCache = { url: PRODUCTION_BATTLEPASS_URL, at: now };
  return PRODUCTION_BATTLEPASS_URL;
}

const keyboards = {
  main: {
    keyboard: [
      ['Меню'],
      ['📖Информация📖']
    ],
    resize_keyboard: true,
    is_persistent: true,
    one_time_keyboard: false
  },

  get menu() {
    const battlePassUrl = getBattlePassUrl();
    const battlePassButton = battlePassUrl
      ? { text: 'Профиты', icon_custom_emoji_id: '5445088267181531740', web_app: { url: battlePassUrl } }
      : { text: 'Профиты', icon_custom_emoji_id: '5445088267181531740', callback_data: 'battlepass_unavailable' };

    return {
      inline_keyboard: [
        [{ text: 'Профиль', callback_data: 'profile' }],
        [battlePassButton],
        [
          { text: 'Букмекер', callback_data: 'card' },
          { text: 'Кардинг', callback_data: 'work' }
        ],
        [
          { text: 'Комьюнити', callback_data: 'community' },
          { text: 'Обучение', callback_data: 'training' }
        ],
        [
          { text: 'Feedback', callback_data: 'feedback' },
          { text: 'Настройки', callback_data: 'settings' }
        ],
        [
          { text: 'AXE SMS', icon_custom_emoji_id: '5447245070908564837', url: 'https://t.me/AXE_SMS_xBot' },
          { text: 'AXE DICE', icon_custom_emoji_id: '5447414344159631158', url: 'https://t.me/AXE_DICE_xBot' }
        ],
        [{ text: 'AXE Poker Project', icon_custom_emoji_id: '5445164597340316440', url: 'https://t.me/AXE_PokerProject_xBot' }]
      ]
    };
  },

  work: {
    inline_keyboard: [
      [{ text: 'Материалы', url: 'https://t.me/+GMixQrZvJkQ4ODE6' }],
      [{ text: 'Назад в меню', callback_data: 'back_to_menu' }]
    ]
  },

  bookmaker: {
    inline_keyboard: [
      [{ text: 'Work-Панель', web_app: { url: 'https://epicbet.space/traffer_panel.php' } }],
      [{ text: 'Расписание матчей', url: 'https://t.me/+fDxvm7h765ZjZDQy' }],
      [{ text: 'Материалы', url: 'https://t.me/+GMixQrZvJkQ4ODE6' }],
      [{ text: 'Назад в меню', callback_data: 'back_to_menu' }]
    ]
  },

  training: {
    inline_keyboard: [
      [{ text: 'Назад в меню', callback_data: 'back_to_menu' }]
    ]
  },

  card: {
    inline_keyboard: [
      [{ text: 'Назад в меню', callback_data: 'back_to_menu' }]
    ]
  },

  settings_menu: {
    inline_keyboard: [
      [{ text: 'Настройки профиля', callback_data: 'profile_settings' }],
      [{ text: 'Назад в меню', callback_data: 'back_to_menu' }]
    ]
  },

  profile: () => ({
    inline_keyboard: [
      [{ text: 'Оформить выплату', callback_data: 'withdraw' }],
      [{ text: 'Настройки', callback_data: 'profile_settings' }],
      [{ text: 'Назад в меню', callback_data: 'back_to_menu' }]
    ]
  }),

  profile_settings: (isHidden, curator) => ({
    inline_keyboard: [
      [{ text: 'Изменить Name', callback_data: 'change_name' }],
      [{ text: isHidden ? 'Открыть профиль' : 'Скрыть профиль', callback_data: 'hide_profile' }],
      [{ text: '💼 Кошелек для выплаты', callback_data: 'payout_wallet' }],
      [{ text: 'Перенести профиль', callback_data: 'transfer_profile' }],
      ...(curator ? [[{ text: 'Отвязаться от куратора', callback_data: 'detach_curator' }]] : []),
      [{ text: 'Назад', callback_data: 'profile' }]
    ]
  }),

  payout_wallet: (method) => ({
    inline_keyboard: [
      [{ text: method === 'cryptobot' ? 'СryptoBot✅' : 'СryptoBot', callback_data: 'wallet_set_cryptobot' }],
      [
        { text: method === 'trc20' ? 'TRC20✅' : 'TRC20', callback_data: 'wallet_set_trc20' },
        { text: method === 'bep20' ? 'BEP20✅' : 'BEP20', callback_data: 'wallet_set_bep20' }
      ],
      [{ text: 'Назад', callback_data: 'profile_settings' }]
    ]
  }),

  feedback: {
    inline_keyboard: [
      [{ text: 'Feedback', url: 'https://t.me/FeedbackAXEbot' }],
      [{ text: 'Назад в меню', callback_data: 'back_to_menu' }]
    ]
  },

  materials: {
    inline_keyboard: [
      [{ text: 'Материалы', callback_data: 'show_materials' }],
      [{ text: 'Назад', callback_data: 'work' }]
    ]
  },

  community: {
    inline_keyboard: [
      [{ text: 'Создать комьюнити', callback_data: 'create_community' }],
      [{ text: 'Назад в меню', callback_data: 'back_to_menu' }]
    ]
  },

  application_start: {
    inline_keyboard: [
      [{ text: 'Начать', callback_data: 'start_application' }]
    ]
  },

  rules_confirm: {
    inline_keyboard: [
      [{ text: 'Ознакомлен', callback_data: 'rules_confirmed' }]
    ]
  },

  subscription_check: {
    inline_keyboard: [
      [{ text: 'AXE | CHAT', url: 'https://t.me/+1EwzBdEWNQgxYWFi' }],
      [{ text: 'AXE | NEWS', url: 'https://t.me/+BO1F4O1KUd0zZTI6' }],
      [{ text: 'Проверить подписку', callback_data: 'check_subscription' }]
    ]
  },

  admin_application: (applicationId) => ({
    inline_keyboard: [
      [
        { text: 'Принять', callback_data: `approve_application_${applicationId}` },
        { text: 'Отклонить', callback_data: `reject_application_${applicationId}` }
      ]
    ]
  })
};

module.exports = keyboards;
