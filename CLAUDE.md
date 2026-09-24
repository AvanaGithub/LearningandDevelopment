# Avana Learning Hub — project guide for Claude

Internal Learning & Development application for the Avana Group
(AMD = Avana Medical Devices, ASS = Avana Surgical Systems, ATS = Avana
Technology Services). Live at **https://academy.avanasurgical.com**.

## History (how we got here)

1. `prototype/index.html` — a single-file clickable prototype of the full
   product, built from the *LD Application Requirements Checklist*. Everything
   runs client-side on sample data. It is the **working spec**: when building a
   module, open the prototype and match its behaviour and fields. It stays
   browsable at https://academy.avanasurgical.com/prototype/ (simulated login).
2. Sep 2026 — real Zoho SSO was added to the prototype, then the project was
   rebuilt as a proper application (this repo's `client/` + `server/`) on the
   same stack as the company's Maverick app. Phase 1 (below) is live.

## Architecture

- `client/` — React 18 + Vite + react-router SPA. Design tokens in
  `client/src/styles.css` are carried over from the prototype (cream/gold
  theme, Fira Sans / Arimo) — keep new UI consistent with them.
- `server/` — Express API. PostgreSQL via `pg`. No ORM: plain SQL.
  - `src/migrations/*.sql` — forward-only migrations, applied automatically at
    server start (`src/db.js`). Never edit an applied migration; add a new one.
  - `src/auth.js` — DB-backed sessions (SHA-256 token hash in `sessions`),
    `requireAuth` / `requireRole('admin')` middleware, `audit()` helper.
  - `src/zoho.js` + `src/routes/auth.js` — Zoho OAuth (authorization code).
- Config via `server/.env` (see `.env.example`). Secrets are NEVER committed.

### Security model — do not weaken this

- Zoho only proves identity (works for Zoho One **and** Zoho People-only
  accounts, so both entities sign in the same way at accounts.zoho.in).
- **Access is enforced server-side**: every `/api` route passes through
  `requireAuth`, which joins the session to `users` and requires `active=TRUE`.
  Disabling a user deletes their sessions → instant revocation.
- Roles: `super_admin` > `admin` > `manager`. Only super admins manage super
  admins. Self-deactivation is blocked.
- ISO 13485 conventions: **deactivate, never delete**; corrections carry a
  `reason` recorded in `audit_log`. Keep every new module on this pattern.

## Production (DigitalOcean droplet 165.227.86.162)

- Checkout: `/var/www/academy-next` (tracks `main`).
- Process: pm2 **`academy`** → `server/src/index.js` on port **3200**.
- nginx (`/etc/nginx/sites-available/academy`): serves `client/dist` static,
  proxies `/auth`, `/api`, `/healthz` to :3200, aliases `/prototype/` to the
  `prototype/` folder. Let's Encrypt auto-renews.
- Database: PostgreSQL `academy`, user `academy_user` (password only in
  `server/.env` on the droplet and `/root/.academy_dbpass`).
- Zoho OAuth client (api-console.zoho.in, Avana Surgical org): redirect URI
  `https://academy.avanasurgical.com/auth/zoho/callback`. Credentials only in
  the droplet `.env`.
- **Deploy:** push to `main`, then on the droplet:
  `cd /var/www/academy-next && git pull`
  (+ `cd client && npm ci && npm run build` if the client changed;
  + `cd server && npm ci` if server deps changed) then `pm2 restart academy`.
  Migrations run automatically on restart.
- The droplet hosts other production apps (maverick, okrpulse, avana-track,
  osteokart, avanasurgical) — never `pm2 restart all`, never touch other vhosts.

## Local development

- `server/`: copy `.env.example` → `.env`, point `DATABASE_URL` at a local
  Postgres, set `DEV_LOGIN=true` (e-mail-only login on the sign-in screen —
  the user must exist in `users`; insert one by hand or via `npm run seed`
  with `SEED_ADMIN_EMAIL` set). `npm install && npm start`.
- `client/`: `npm install && npm run dev` → http://localhost:5174 (proxies
  `/api` and `/auth` to :3200).
- Real Zoho login cannot work locally (redirect URI is bound to the prod
  domain) — that's what `DEV_LOGIN` is for. It is hard-disabled when
  `NODE_ENV=production`.

## Roadmap (from the prototype, in build order)

1. **Trainings** — multi-day planning, participants, list + calendar views.
2. **Attendance** — per-training/per-day grid, QR self check-in (prototype has
   participant pages under `#att/`), admin corrections with reason.
3. Employees **Excel import** with column mapping (prototype uses SheetJS).
4. **Feedback** — form builder, QR/share link, results export.
5. **Expenses** — budget/actual/part-payments, multi-entity pro-rata split.
6. **Reports** — 14 types, real `.xlsx` export.
7. Phase 2: Nominations, Effectiveness, Assessments, Certificates.

Business rules baked into the checklist: INR, IST, Apr–Mar financial year,
80% pass mark, 75% attendance eligibility, Zoho employee IDs.

## Gotchas learned so far

- pm2 `--update-env` does **not** re-read an ecosystem file; recreate the
  process (`pm2 delete` + `pm2 start`) after env changes. Plain `.env` via
  dotenv (current setup) only needs `pm2 restart academy`.
- In ssh one-liners, `pkill -f 'node src/index.js'` kills its own shell
  (pattern matches itself) — write it as `pkill -f 'node src/[i]ndex.js'`.
- On Windows, running Vite from an 8.3 short path (`PUSHPA~1`) crashes its
  file watcher — always use full long paths.
- Session cookies are `Secure` when `BASE_URL` is https — for local http
  testing `BASE_URL` must be http or the browser drops the cookie.
- The droplet checkout used to live at `/var/www/academy` (prototype era);
  that directory is only a rollback artifact now.
