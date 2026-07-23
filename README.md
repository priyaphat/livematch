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

## ระบบสมาชิกและระบบจองสนาม

ฟีเจอร์ใหม่ปิดเป็นค่าเริ่มต้นสำหรับ admin เดิม เปิดได้ที่ `/backoffice` → สมาชิก → Admin DB Preview โดยแยกสวิตช์ “ระบบสมาชิก” และ “ระบบจองสนาม” ต่อ admin การปิดสิทธิ์มีผลทั้งการ์ดใน dashboard และ API โดยตรง

ก่อนใช้งาน public booking ให้ตั้งค่า Google OpenID Connect และ security values ใน `.env`:

```text
GOOGLE_CLIENT_ID=google-client-id
GOOGLE_CLIENT_SECRET=google-client-secret
GOOGLE_REDIRECT_URL=http://localhost:5173/api/public-auth/google/callback
APP_ENV=development
APP_ALLOWED_ORIGINS=http://localhost:5173
APP_TRUSTED_PROXY_CIDRS=
APP_ENCRYPTION_KEY=long-random-secret-at-least-32-characters
COOKIE_SECURE=false
```

Production ต้องใช้ HTTPS, เปลี่ยน redirect URL ให้ตรงกับ Google Console, กำหนด `COOKIE_SECURE=true` และใส่ production origin ใน `APP_ALLOWED_ORIGINS` ระบบชำระเงิน v1 ใช้ PromptPay QR และให้ admin ตรวจสลิปด้วยตนเอง

Telegram สำหรับอนุมัติการจองตั้งค่า Bot token/Chat ID แยกในหน้าจัดการระบบจองของแต่ละ admin โดย bot ต้องไม่ซ้ำกับ bot ของ Backoffice หรือ admin รายอื่น ระบบจะลงทะเบียน webhook เฉพาะ admin และส่งสลิปพร้อมปุ่มอนุมัติ/ปฏิเสธ

## Telegram Alert

Coin order alerts use Telegram Bot messages. Set the bot token and chat ID in `/backoffice` under the setting/overview page.

Environment variables are still supported as a fallback for deployments that prefer Docker-level config:

```text
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=chat-id-or-group-id
TELEGRAM_WEBHOOK_SECRET=random-secret-for-inline-buttons
APP_BASE_URL=https://your-production-domain.example
```

Leave both Backoffice fields and env values empty to disable Telegram alerts. Failed Telegram delivery is logged but does not block coin order creation.

Telegram accepts webhook URLs over HTTPS only. A local `http://localhost` URL can run the app, but cannot be registered as a Telegram webhook. Use the deployed HTTPS domain or an HTTPS tunnel, then restart the backend after changing `APP_BASE_URL`.

To use approve/reject buttons in Telegram, set your bot webhook to:

```text
https://your-domain.example/api/telegram/webhook/{TELEGRAM_WEBHOOK_SECRET}
```

## Google Thai Text-to-Speech

Queue announcements can use Google Cloud's Thai Standard voice. The backend stops new Google synthesis at 3.9 million characters per UTC month and the frontend automatically falls back to the device Web Speech voice. Generated MP3 files are cached in the `tts_cache` Docker volume, while the frontend also caches them for repeated clicks in the same browser session.

1. Enable Cloud Text-to-Speech in a Google Cloud project and create a service-account JSON credential.
2. Save it locally as `./secrets/google-tts.json`. This path is ignored by Git.
3. Add these values to `.env`:

```text
GOOGLE_TTS_ENABLED=true
GOOGLE_TTS_VOICE=th-TH-Standard-A
GOOGLE_TTS_SPEAKING_RATE=0.82
```

4. Recreate the backend:

```bash
docker compose up -d --build backend frontend
```

Never copy the service-account JSON into an image or commit it to the repository.

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
