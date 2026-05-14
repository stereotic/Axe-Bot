# Деплой Telegram-бота на сервер

Подробная инструкция для запуска бота на VPS с Ubuntu/Debian. В примерах используется PM2, чтобы бот работал 24/7 и автоматически поднимался после перезагрузки сервера.

## 1. Что понадобится

- VPS/VDS сервер с Ubuntu 22.04/24.04 или Debian.
- SSH-доступ к серверу: IP, логин, пароль или SSH-ключ.
- Токен бота от BotFather.
- ID админов для `ADMIN_IDS`.
- Файлы проекта: `bot.js`, `package.json`, `package-lock.json`, `database.js`, `keyboards.js`, остальные `.js`, папки `images`, `assets`, и при необходимости `database.db`.

Важно: не отправляйте никому файл `.env`, токен бота, пароли от сервера и приватные SSH-ключи.

## 2. Подключение к серверу

На своем компьютере откройте PowerShell или терминал:

```bash
ssh root@SERVER_IP
```

Замените `SERVER_IP` на IP вашего сервера.

Если сервер спросит:

```text
Are you sure you want to continue connecting?
```

Введите:

```bash
yes
```

После входа все следующие команды выполняются уже на сервере.

## 3. Обновление сервера

```bash
apt update
apt upgrade -y
```

Установите базовые пакеты:

```bash
apt install -y curl git build-essential python3 make g++ ca-certificates
```

`build-essential`, `python3`, `make` и `g++` нужны для нативных зависимостей вроде `sqlite3` и `canvas`.

## 4. Установка Node.js

Рекомендуется Node.js 20 LTS.

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
```

Проверьте версии:

```bash
node -v
npm -v
```

Должно быть примерно:

```text
v20.x.x
10.x.x
```

## 5. Установка библиотек для canvas

В проекте используется пакет `canvas`, ему нужны системные библиотеки:

```bash
apt install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

## 6. Установка PM2

PM2 будет держать бота запущенным в фоне:

```bash
npm install -g pm2
pm2 -v
```

## 7. Создание папки проекта

```bash
mkdir -p /root/axe-bot
cd /root/axe-bot
```

## 8. Перенос файлов проекта

Есть два нормальных способа.

### Вариант A: через Git

Если проект лежит в GitHub/GitLab:

```bash
git clone REPO_URL .
```

Замените `REPO_URL` на ссылку репозитория.

### Вариант B: через SCP с Windows

Откройте новый PowerShell на своем компьютере, не на сервере:

```powershell
scp -r "C:\Users\Артем\Desktop\projects\BLACK-BET TEAM\Axe bot\*" root@SERVER_IP:/root/axe-bot/
```

Замените `SERVER_IP` на IP сервера.

Проверьте на сервере:

```bash
cd /root/axe-bot
ls -la
```

В папке должны быть `bot.js`, `package.json`, `package-lock.json`, `database.js`, `keyboards.js` и остальные файлы проекта.

## 9. Настройка `.env`

Создайте файл `.env`:

```bash
nano .env
```

Минимальный пример:

```env
BOT_TOKEN=ваш_токен_бота
ADMIN_IDS=123456789,987654321
```

Где:

- `BOT_TOKEN` — токен от BotFather.
- `ADMIN_IDS` — Telegram ID админов через запятую, без пробелов.

Сохранить в `nano`:

- `Ctrl + X`
- `Y`
- `Enter`

Проверьте файл:

```bash
cat .env
```

## 10. База данных

Если нужно перенести текущие данные бота, обязательно перенесите файл:

```text
database.db
```

Если `database.db` не перенести, бот создаст новую пустую базу, и старые пользователи/балансы/заявки не появятся.

Проверьте наличие базы:

```bash
ls -lh database.db
```

## 11. Установка зависимостей

В папке проекта:

```bash
cd /root/axe-bot
npm install
```

Если будут ошибки по `canvas` или `sqlite3`, сначала проверьте, что установлены пакеты из шагов 3 и 5, затем повторите:

```bash
npm install
```

## 12. Проверка запуска вручную

Перед PM2 лучше один раз проверить бота напрямую:

```bash
node --check bot.js
node bot.js
```

Если видите сообщение запуска и нет ошибок, остановите процесс:

```bash
Ctrl + C
```

Если ошибка про токен — проверьте `.env`.

Если ошибка `ETELEGRAM: 409 Conflict`, значит бот уже запущен где-то еще. Нужно остановить старый запуск: на ПК, старом сервере или в другом PM2-процессе.

## 13. Запуск через PM2

```bash
cd /root/axe-bot
pm2 start bot.js --name axe-bot
```

Проверить статус:

```bash
pm2 status
```

Посмотреть логи:

```bash
pm2 logs axe-bot
```

Выйти из логов:

```bash
Ctrl + C
```

## 14. Автозапуск после перезагрузки сервера

```bash
pm2 save
pm2 startup
```

После `pm2 startup` PM2 покажет команду, которую нужно скопировать и выполнить. Она обычно начинается с `sudo env PATH=...`.

После выполнения команды еще раз:

```bash
pm2 save
```

Проверка:

```bash
reboot
```

Через 1-2 минуты подключитесь снова:

```bash
ssh root@SERVER_IP
pm2 status
```

Бот должен быть `online`.

## 15. Обновление бота на сервере

### Если используете Git

```bash
cd /root/axe-bot
git pull
npm install
pm2 restart axe-bot
```

### Если копируете файлы вручную

С компьютера:

```powershell
scp -r "C:\Users\Артем\Desktop\projects\BLACK-BET TEAM\Axe bot\*" root@SERVER_IP:/root/axe-bot/
```

На сервере:

```bash
cd /root/axe-bot
npm install
pm2 restart axe-bot
```

После обновления смотрите логи:

```bash
pm2 logs axe-bot --lines 100
```

## 16. Команды управления ботом

```bash
pm2 status
pm2 logs axe-bot
pm2 restart axe-bot
pm2 stop axe-bot
pm2 start axe-bot
pm2 delete axe-bot
```

## 17. Резервная копия базы

Перед обновлениями желательно сохранять базу:

```bash
cd /root/axe-bot
cp database.db "database.backup.$(date +%Y-%m-%d_%H-%M-%S).db"
```

Скачать базу на компьютер:

```powershell
scp root@SERVER_IP:/root/axe-bot/database.db "C:\Users\Артем\Desktop\database.db"
```

## 18. Проверка закрепленного сообщения

В этом проекте закреп обновляется кодом из `update_pinned.js`.

Чтобы бот мог редактировать закреп:

- бот должен быть админом в чате;
- у бота должно быть право закреплять сообщения;
- старый закреп должен быть сообщением, которое бот может редактировать;
- в базе в `stats` хранится ключ `pinned_message_id`.

Если закреп не редактируется, проверьте логи:

```bash
pm2 logs axe-bot --lines 200
```

## 19. Частые проблемы

### Бот не отвечает

Проверьте:

```bash
pm2 status
pm2 logs axe-bot --lines 100
cat .env
```

Частые причины:

- неправильный `BOT_TOKEN`;
- бот уже запущен в другом месте;
- не установлены зависимости;
- сервер не имеет доступа к Telegram.

### Ошибка `409 Conflict`

Означает, что один и тот же бот запущен в двух местах.

Остановите лишний процесс:

```bash
pm2 stop axe-bot
```

Или закройте локальный запуск `node bot.js` на компьютере.

### Ошибка `cannot find module`

Зависимости не установлены:

```bash
cd /root/axe-bot
npm install
pm2 restart axe-bot
```

### Ошибки `canvas`

Поставьте системные библиотеки:

```bash
apt install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
npm install
pm2 restart axe-bot
```

### База пустая после деплоя

Скорее всего, не перенесли `database.db`. Остановите бота, загрузите правильную базу и запустите:

```bash
pm2 stop axe-bot
pm2 start axe-bot
```

## 20. Мини-чеклист перед финальным запуском

- `.env` создан и заполнен.
- `database.db` перенесена, если нужны старые данные.
- `npm install` прошел без ошибок.
- `node --check bot.js` прошел без ошибок.
- `pm2 status` показывает `axe-bot` со статусом `online`.
- В Telegram бот отвечает на `/start`.
- Бот админ в нужных чатах и каналах.
- Выполнены `pm2 save` и `pm2 startup`.

