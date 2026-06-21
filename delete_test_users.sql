-- Удаление тестовых пользователей #Testovhik (7397120996) и #sss (6383039210)
-- Выполнять на сервере по порядку

-- 1. Profits (платежи/профиты)
DELETE FROM profits WHERE user_id IN (7397120996, 6383039210);

-- 2. Withdrawals (выводы)
DELETE FROM withdrawals WHERE user_id IN (7397120996, 6383039210);

-- 3. Applications (заявки)
DELETE FROM applications WHERE user_id IN (7397120996, 6383039210);

-- 4. Card requests (запросы карт)
DELETE FROM card_requests WHERE user_id IN (7397120996, 6383039210);

-- 5. Checks (чеки)
DELETE FROM checks WHERE user_id IN (7397120996, 6383039210);

-- 6. Purchased cards (купленные карты)
DELETE FROM purchased_cards WHERE user_id IN (7397120996, 6383039210);

-- 7. Profit shares (доли профитов)
DELETE FROM profit_shares WHERE profit_id IN (
  SELECT id FROM profits WHERE user_id IN (7397120996, 6383039210)
);

-- 8. Сами пользователи
DELETE FROM users WHERE user_id IN (7397120996, 6383039210);
