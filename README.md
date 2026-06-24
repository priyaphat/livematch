# LiveMatch

LiveMatch คือเว็บแอปแบบ mobile-first สำหรับจัดการ session เล่นแบดมินตัน: ลงทะเบียนผู้เล่น, สุ่มทีม, คุมแมตช์ที่กำลังเล่น, และสรุปค่าใช้จ่ายรายคน

## Stack

- Frontend: Vue 3, Vite, Tailwind CSS, Vitest
- Backend: Go, PostgreSQL, pgx
- Local services: Docker Compose, PostgreSQL, pgAdmin

## Run With Docker

```bash
docker compose up --build
```

Services:

- Frontend: http://localhost:5173
- Backend health: http://localhost:8080/health
- pgAdmin: http://localhost:5050

Backend connects to PostgreSQL through the Docker network with host `postgres`.

## Telegram Alert

Coin order alerts use Telegram Bot messages. Set the bot token and chat ID in `/backoffice` under the setting/overview page.

Environment variables are still supported as a fallback for deployments that prefer Docker-level config:

```text
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=chat-id-or-group-id
TELEGRAM_WEBHOOK_SECRET=random-secret-for-inline-buttons
APP_BASE_URL=http://localhost:5173
```

Leave both Backoffice fields and env values empty to disable Telegram alerts. Failed Telegram delivery is logged but does not block coin order creation.

To use approve/reject buttons in Telegram, set your bot webhook to:

```text
https://your-domain.example/api/telegram/webhook/{TELEGRAM_WEBHOOK_SECRET}
```

## Local Development

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Backend:

```bash
cd backend
go test ./...
go run .
```

If running backend outside Docker, set `DATABASE_URL` or use the default local PostgreSQL URL:

```text
postgres://livematch:livematch@localhost:5432/livematch?sslmode=disable
```

## Current Scope

- Create badminton venue/session and generate admin passcode.
- Show dashboard summary cards.
- Show player cost/payment table with Thai-first content.
- Show queued live match cards for the next court flow.
- Support light/dark theme styling with an eye-care paper palette.

## Tests

```bash
cd backend && go test ./...
cd frontend && npm test
```
