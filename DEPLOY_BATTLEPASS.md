# AXE PASS на axe.crystalcards.store

Инструкция рассчитана на Ubuntu/Debian, Nginx и запуск бота через PM2.

## 1. DNS в REG.RU

Откройте управление DNS-зоной домена `crystalcards.store` и создайте запись:

```text
Тип: A
Имя: axe
Значение: публичный IPv4-адрес сервера
TTL: 300
```

Если для `axe` уже существует запись `A`, `AAAA` или `CNAME`, убедитесь, что
она ведет на нужный сервер. Не оставляйте конфликтующие записи.

Проверка после сохранения:

```bash
dig +short axe.crystalcards.store
```

Команда должна вывести IP сервера. Обновление DNS может занять некоторое время.

## 2. Проект и переменные

Проект на сервере ожидается в `/root/axe-bot`:

```bash
cd /root/axe-bot
npm install
```

В серверном `.env` должны быть значения:

```env
BATTLEPASS_URL=https://axe.crystalcards.store
BATTLEPASS_HOST=127.0.0.1
BATTLEPASS_PORT=8081
BATTLEPASS_DEV=0
```

`BATTLEPASS_DEV=1` на публичном сервере использовать нельзя.

## 3. Запуск через PM2

`bot.js` запускает Telegram-бота и сервер AXE PASS одновременно:

```bash
cd /root/axe-bot
pm2 delete axe-bot
pm2 start bot.js --name axe-bot
pm2 save
```

Если процесса еще нет, ошибка от `pm2 delete` не мешает продолжить.

Проверка:

```bash
pm2 status
pm2 logs axe-bot --lines 100
curl http://127.0.0.1:8081/health
```

Последняя команда должна вернуть `{"ok":true}`.

## 4. Nginx

Установите Nginx и Certbot:

```bash
apt update
apt install -y nginx certbot python3-certbot-nginx
```

Подключите готовую конфигурацию:

```bash
cp /root/axe-bot/deploy/axe.crystalcards.store.nginx.conf /etc/nginx/sites-available/axe.crystalcards.store
ln -s /etc/nginx/sites-available/axe.crystalcards.store /etc/nginx/sites-enabled/axe.crystalcards.store
nginx -t
systemctl reload nginx
```

Если `ln` сообщает, что файл уже существует, сначала проверьте ссылку:

```bash
ls -l /etc/nginx/sites-enabled/axe.crystalcards.store
```

## 5. HTTPS

Когда DNS уже указывает на сервер:

```bash
certbot --nginx -d axe.crystalcards.store
```

Выберите перенаправление HTTP на HTTPS. Затем проверьте:

```bash
curl https://axe.crystalcards.store/health
systemctl status certbot.timer
```

## 6. Firewall

Откройте SSH, HTTP и HTTPS. Порт `8081` наружу открывать не нужно:

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
ufw status
```

## 7. Финальная проверка

1. Откройте `https://axe.crystalcards.store/health` — ожидается `{"ok":true}`.
2. В Telegram отправьте боту `/start`.
3. Откройте новое главное меню и нажмите `AXE PASS`.
4. Проверьте, что пользователь без новых профитов видит `LVL 0`.
5. Выполните `pm2 save`.

Quick Tunnel `trycloudflare.com`, `cloudflare-watch.ps1` и `npm run tunnel`
на сервере больше не нужны.
