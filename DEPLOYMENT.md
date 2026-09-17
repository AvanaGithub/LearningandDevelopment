# Deploying academy.avanasurgical.com with Zoho SSO

The app is now a small Node.js service (`server.js`) that serves the interface
AND handles the real Zoho sign-in. Static hosting (plain file copy / GitHub
Pages) still works but keeps the *simulated* login; real SSO needs this server
running.

## Digital Ocean App Platform (recommended)

1. DO dashboard → **Apps** → Create App → source: GitHub →
   `AvanaGithub/LearningandDevelopment`, branch `main`,
   **Autodeploy: ON** (every git push goes live).
2. It detects Node.js automatically (`npm start`). HTTP port: **8080**.
3. Component → **Environment Variables** (mark all as *Encrypted*):

   | Key | Value |
   |---|---|
   | `ZOHO_CLIENT_ID` | from api-console.zoho.in |
   | `ZOHO_CLIENT_SECRET` | from api-console.zoho.in — enter here only, never in git/chat |
   | `SESSION_SECRET` | any long random string, e.g. from https://www.uuidgenerator.net (two UUIDs joined) |
   | `BASE_URL` | `https://academy.avanasurgical.com` |
   | `ZOHO_ACCOUNTS` | `https://accounts.zoho.in` |

4. Settings → **Domains** → add `academy.avanasurgical.com`, update the DNS
   CNAME as instructed (if the domain currently points at the old static
   deployment, repoint it here).
5. Deploy. Verify:
   - `https://academy.avanasurgical.com/healthz` → `ok`
   - `https://academy.avanasurgical.com/api/me` → `{"sso":true,"configured":true,...}`
   - The sign-in screen shows no e-mail box — the button goes straight to Zoho.

## Zoho API console (already registered — verify these fields)

- Client type: Server-based Applications
- Homepage URL: `https://academy.avanasurgical.com`
- Authorized Redirect URI: `https://academy.avanasurgical.com/auth/zoho/callback`
  (must match **exactly**, https and path included)

## How sign-in decides access

Zoho only proves *who* the person is. The app then matches the verified
e-mail (case-insensitive) against **Users & Access**; not listed or disabled →
rejected. Manage access entirely from the Users & Access screen / built-in
list — no Zoho change needed to grant or revoke the app.

## Local development

```
npm install
set SESSION_SECRET=dev && set ZOHO_CLIENT_ID=... && set ZOHO_CLIENT_SECRET=... && set BASE_URL=http://localhost:8080 && npm start
```
Without the Zoho variables the server still runs; the sign-in screen will say
SSO is not configured. Opening `index.html` directly from disk keeps the old
simulated login — handy for offline demos.

## Current limitation (next build step)

Data (employees, trainings, attendance …) is still stored per browser via
localStorage. The server currently adds authentication only. The next step is
moving data into a server database so everyone sees the same records.
