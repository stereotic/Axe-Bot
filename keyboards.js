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

  info: {
    inline_keyboard: [
      [{ text: 'Чат 💬', url: 'https://t.me/+1EwzBdEWNQgxYWFi' }],
      [
        { text: '💸Профиты', url: 'https://t.me/+euO9gzLMUMFhNmJi' },
        { text: '📢Новости', url: 'https://t.me/+BO1F4O1KUd0zZTI6' }
      ],
      [{ text: '📂Материалы', url: 'https://t.me/+GMixQrZvJkQ4ODE6' }]
    ]
  },

  menu: {
    inline_keyboard: [
      [{ text: 'Профиль', callback_data: 'profile' }],
      [
        { text: 'WORK', callback_data: 'work' },
        { text: 'Обучение', callback_data: 'training' }
      ],
      [
        { text: 'Карта', callback_data: 'card' },
        { text: 'Комьюнити', callback_data: 'community' }
      ],
      [
        { text: 'Feedback', callback_data: 'feedback' },
        { text: 'Настройки', callback_data: 'settings' }
      ]
    ]
  },

  work: {
    inline_keyboard: [
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

  profile: {
    inline_keyboard: [
      [{ text: 'Оформить выплату', callback_data: 'withdraw' }],
      [{ text: 'Настройки', callback_data: 'profile_settings' }],
      [{ text: 'Назад в меню', callback_data: 'back_to_menu' }]
    ]
  },

  profile_settings: (isHidden) => ({
    inline_keyboard: [
      [{ text: 'Изменить Name', callback_data: 'change_name' }],
      [{ text: isHidden ? 'Открыть профиль' : 'Скрыть профиль', callback_data: 'hide_profile' }],
      [{ text: 'Перенести профиль', callback_data: 'transfer_profile' }],
      [{ text: 'Назад', callback_data: 'profile' }]
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
