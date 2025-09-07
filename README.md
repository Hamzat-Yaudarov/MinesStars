# Mines Stars — Telegram Bot

Краткое руководство по локальной разработке, миграциям Prisma и развёртыванию на Railway.

## Что уже сделано
- Бот на Node.js + TypeScript + grammy
- Prisma + Neon (Postgres) как БД
- Реализованы: профиль, кейсы, шахта (коп), магазин (покупка кирки), выводы, рефералы, мини‑игра «лесенка» с сохранением активной игры в БД
- Механика оплат через Telegram Stars (обработчики pre_checkout и successful_payment готовы)
- Админ‑эндпоинты: `/admin/stats` и `/admin/transactions` (HTTP, защищены заголовком `x-admin-id`)

## Важные переменные окружения
В корне проекта создайте `.env` (или настройте переменные в Railway):

- BOT_TOKEN — токен бота Telegram
- BOT_USERNAME — username бота (без @), например `tickpiarrobot`
- DATABASE_URL — строка подключения к Neon/Postgres
- WEBHOOK_URL — публичный URL сервера (Railway) без суффикса `/webhook`
- ADMIN_ID — id администратора (используется для проверки HTTP‑эндпоинтов)
- PORT — порт сервера (по умолчанию 3000)

Пример (файл `.env`):

```
BOT_TOKEN=8347551929:...yourtoken...
BOT_USERNAME=tickpiarrobot
DATABASE_URL="postgresql://..."
WEBHOOK_URL=https://your-app.up.railway.app
ADMIN_ID=7910097562
PORT=3000
```

> Подсказка: при разворачивании на Railway установите эти переменные через UI проекта (Settings → Variables).

## Установка и запуск в режиме разработки

1. Установите зависимости:

```bash
npm install
```

2. Скопируйте `.env.example` в `.env` и заполните переменные.

3. Локально (генерация миграции и запуск dev сервера):

```bash
# сгенерировать миграци�� и применить её локально (создаст папку prisma/migrations)
npx prisma migrate dev --name init
# сгенерировать клиента Prisma
npx prisma generate
# запустить dev сервер
npm run dev
```

После `npm run dev` сервер зарегистрирует webhook (если указан WEBHOOK_URL) и поднимет бота.

## Миграции в продакшн (Railway / хостинг)

1. Закомитьте миграции (если вы их создали локально через `prisma migrate dev`).
2. На проде выполните:

```bash
# выполнить все миграции, которые уже есть в репозитории
npx prisma migrate deploy
# сгенерировать клиент
npx prisma generate
```

В Railway можно добавить эти команды в `Build`/`Postdeploy` шаг проекта.

## Особенности базы данных
- Модель `ActiveGame` хранит активные игры (лесенка) для восстановления состояния после рестартов.
- Все финансовые изменения логируются в таблице `Transaction` для возможности аудита.

## Админ‑эндпоинты
- GET /admin/stats — возвращает сводку (требует заголовок `x-admin-id` равный `ADMIN_ID`)
- GET /admin/transactions?limit=100 — список транзакций (параметр limit)

Пример вызова с curl:

```bash
curl -H "x-admin-id: $ADMIN_ID" https://your-app.up.railway.app/admin/stats
```

## Безопасность и эксплуатация
- Пользовательские ставки списываются атомарно (через Prisma updateMany) — предотвращает гонки при быстром нажатии кнопок.
- Каждая анимация/игра выполняется в одном редактируемом сообщении (editMessageText) — минимизирует спам в чате.
- Активные игры восстанавливаются при перезапуске сервера (loadActiveGames).
- Таймауты: игроку даётся 90s на ход в «лесенке», затем ставка сгорает и фиксируется в транзакциях.

## Развёртывание на Railway (быстрый старт)
1. Создайте новый проект на Railway и подключите репозиторий (или загрузите код).
2. В `Variables` добавьт�� переменные окружения из раздела выше (BOT_TOKEN, DATABASE_URL, WEBHOOK_URL, ADMIN_ID, BOT_USERNAME).
3. Настройте команду `Build` (например `npm run build` или `npm install`) и `Start` → `npm start`.
4. Убедитесь, что WEBHOOK_URL указывает на публичный адрес Railway (например `https://your-app.up.railway.app`), бот автоматически выставит webhook при старте.
5. Выполните в консоли проекта миграции продакшн:

```
npx prisma migrate deploy
npx prisma generate
```

## Миграция данных / откат
- Локально можно пользоваться `npx prisma migrate reset` (внимание — очистит БД).
- В продакшне используйте только `prisma migrate deploy`.

## Полезные команды
- npm run dev — dev сервер (ts-node-dev)
- npm run build — собрать проект (tsc)
- npm start — запустить продакшн (node dist/server.js)
- npx prisma studio — UI для просмотра БД

## Поддержка и изменение токена/Neon URL
Все ключи хранятся в переменных окружения. Чтобы сменить токе�� или Neon URL — поменяйте BOT_TOKEN / DATABASE_URL (или NEON_URL) в файле `.env` для локального запуска или в настройках проекта Railway.

## Что дальше (рекомендации)
- Записать unit/integration тесты для критичных транзакций (ladder_bet/ladder_win/withdrawal).
- Подключить мониторинг и алерты (Sentry, Prometheus) для отслеживания ошибок и аномалий.

---
Если нужно — могу сгенерировать пример миграции SQL, однако рекомендуется запускать `npx prisma migrate dev --name init` локально чтобы Prisma сгенерировал корректную миграцию из `prisma/schema.prisma`.
