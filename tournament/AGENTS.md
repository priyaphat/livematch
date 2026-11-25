# Tournament AGENTS.md

## Scope and stack

- This directory is the React + TypeScript + Tailwind PWA for LiveMatch Tournament.
- It runs as Docker service `tournament` on port 5181. Development uses Vite; production uses the static Vite build behind Nginx.
- The authoritative runtime is the shared Go/PostgreSQL backend. `server.ts` and `mockData.ts` are prototype/test references only and must never be production state stores.

## API and authentication

- Auth routes: `/api/auth/tournament/login`, `/me`, `/logout`, and Director sub-routes.
- Authenticated resources: `/api/tournament/*`. Public, scrubbed resources: `/api/public-tournament/*`.
- Always send `credentials: 'include'` and `X-CSRF-Token` for unsafe authenticated requests.
- Never send or trust `x-user-role`, `x-user-name`, tenant IDs, or permission claims. The server session is authoritative.
- Owner uses the main LiveMatch account. Tournament Staff are separate from POS Staff and are limited to five accounts. Directors use one-time-visible 12-digit login codes.
- Hide role switchers and demo credentials outside tests.

## Data and privacy

- All money exchanged with the backend is integer satang; format as baht only at the UI boundary.
- Parse/display tournament times in `Asia/Bangkok` and preserve explicit offsets in API values.
- Public screens must not receive phone, email, birth date, health data, verification secrets, or payment evidence.
- Upload photos, documents and slips as staged multipart files and retain only returned file IDs. Do not persist base64 blobs in application state.
- Use `publicToken` in public URLs, never a database tournament ID.

## Realtime and offline scoring

- Staff SSE is scoped to one `admin_id`/tournament. Director SSE is restricted to assigned matches. Public SSE contains scrubbed projections only.
- Score mutations require a stable client-generated `eventId` and current `version`.
- Do not silently discard offline 4xx responses. Store them in the dead-letter queue for correction. On `409 version_conflict`, load authoritative match state and require reconciliation.
- Locked-result overrides require a reason. A started downstream match must use the explicit rollback flow.

## UI and testing

- Preserve the current paper-friendly sports theme, mobile-first layout, light/dark modes and Thai-first copy while keeping strings ready for th/en localization.
- Vitest contracts should cover login/bootstrap, permission-based controls, Coin Shop visibility, payment source labels, offline dead letters/reconciliation and public privacy.
- Production builds must contain no seeded tournament, player, payment, match or credential data.
- Replace legacy “LINE Notify” wording/integration with LINE Messaging API.
