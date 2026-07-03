const db = require('./database');

// Временное хранилище для состояний создания/редактирования реквизитов
const cardCreationState = {};
const cardRequestState = {};
const checkSubmissionState = {};

// Функция получения эмодзи пола
function getGenderEmoji(gender) {
  return gender === 'male' ? '👨' : '👩‍🦱';
}

// Функция получения флага страны
function getCountryFlag(country) {
  const flags = {
    'RU': '🇷🇺',
    'US': '🇺🇸',
    'EU': '🇪🇺',
    'UK': '🇬🇧'
  };
  return flags[country] || '🌍';
}

// Функция форматирования реквизита
function formatCardRequisite(card) {
  const genderEmoji = getGenderEmoji(card.gender);
  const countryFlag = getCountryFlag(card.country);

  return `Карта ${card.percent}%
┗от ${card.min_limit.toLocaleString()}₽ до ${card.max_limit.toLocaleString()}₽

${countryFlag}🏦: ${card.bank}

💳: ${card.card_number}

ФИО: ${card.full_name}

${card.notes ? `📝Примечания: ${card.notes}` : '📝Примечания: -'}`;
}

// Функция получения всех реквизитов
function getAllCards(callback) {
  db.all('SELECT * FROM card_requisites ORDER BY created_at DESC', callback);
}

// Функция получения реквизита по ID
function getCardById(cardId, callback) {
  db.get('SELECT * FROM card_requisites WHERE id = ?', [cardId], callback);
}

// Функция создания реквизита
function createCard(cardData, callback) {
  db.run(`INSERT INTO card_requisites
    (gender, country, percent, min_limit, max_limit, card_number, bank, full_name, notes, is_temporary, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cardData.gender,
      cardData.country || 'RU',
      cardData.percent,
      cardData.min_limit,
      cardData.max_limit,
      cardData.card_number,
      cardData.bank,
      cardData.full_name,
      cardData.notes || '',
      cardData.is_temporary || 0,
      cardData.created_by
    ],
    function(err) {
      if (callback) callback(err, this.lastID);
    }
  );
}

// Функция обновления реквизита
function updateCard(cardId, field, value, callback) {
  const allowedFields = ['gender', 'country', 'percent', 'min_limit', 'max_limit', 'card_number', 'bank', 'full_name', 'notes'];

  if (!allowedFields.includes(field)) {
    if (callback) callback(new Error('Invalid field'));
    return;
  }

  db.run(`UPDATE card_requisites SET ${field} = ? WHERE id = ?`, [value, cardId], callback);
}

// Функция удаления реквизита
function deleteCard(cardId, callback) {
  db.run('DELETE FROM card_requisites WHERE id = ?', [cardId], callback);
}

// Функция создания запроса на реквизит
function createCardRequest(requestData, callback) {
  db.run(`INSERT INTO card_requests
    (user_id, amount, gender, hold_hours, status)
    VALUES (?, ?, ?, ?, 'pending')`,
    [requestData.user_id, requestData.amount, requestData.gender, requestData.hold_hours],
    function(err) {
      if (callback) callback(err, this.lastID);
    }
  );
}

// Функция обновления статуса запроса
function updateCardRequestStatus(requestId, status, adminId, cardId, callback) {
  db.run(`UPDATE card_requests
    SET status = ?, admin_id = ?, card_id = ?, processed_at = CURRENT_TIMESTAMP
    WHERE id = ?`,
    [status, adminId, cardId, requestId],
    callback
  );
}

// Функция получения запроса по ID
function getCardRequestById(requestId, callback) {
  db.get('SELECT * FROM card_requests WHERE id = ?', [requestId], callback);
}

// Функция создания чека
function createCheck(checkData, callback) {
  db.run(`INSERT INTO checks
    (user_id, card_id, request_id, file_id, file_type, amount, direction, status, user_message_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', ?)`,
    [
      checkData.user_id,
      checkData.card_id,
      checkData.request_id,
      checkData.file_id,
      checkData.file_type,
      checkData.amount,
      checkData.direction || 1,
      checkData.user_message_id
    ],
    function(err) {
      if (callback) callback(err, this.lastID);
    }
  );
}

// Функция обновления статуса чека
function updateCheckStatus(checkId, status, adminMessageId, callback) {
  const updates = ['status = ?', 'verified_at = CURRENT_TIMESTAMP'];
  const params = [status];

  if (adminMessageId) {
    updates.push('admin_message_id = ?');
    params.push(adminMessageId);
  }

  params.push(checkId);

  db.run(`UPDATE checks SET ${updates.join(', ')} WHERE id = ?`, params, callback);
}

// Функция получения чека по ID
function getCheckById(checkId, callback) {
  db.get('SELECT * FROM checks WHERE id = ?', [checkId], callback);
}

// Функция поиска подходящих реквизитов
function findSuitableCards(amount, gender, callback) {
  let query = 'SELECT * FROM card_requisites WHERE min_limit <= ? AND max_limit >= ?';
  const params = [amount, amount];

  if (gender !== 'any') {
    query += ' AND gender = ?';
    params.push(gender);
  }

  query += ' ORDER BY created_at DESC';

  db.all(query, params, callback);
}

module.exports = {
  cardCreationState,
  cardRequestState,
  checkSubmissionState,
  getGenderEmoji,
  getCountryFlag,
  formatCardRequisite,
  getAllCards,
  getCardById,
  createCard,
  updateCard,
  deleteCard,
  createCardRequest,
  updateCardRequestStatus,
  getCardRequestById,
  createCheck,
  updateCheckStatus,
  getCheckById,
  findSuitableCards
};
