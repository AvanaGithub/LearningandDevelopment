# Avana Learning Hub

Internal Learning & Development application for the Avana Group
(Avana Medical Devices, Avana Surgical Systems, Avana Technology Services).

Live at **https://academy.avanasurgical.com** — sign-in is Zoho SSO
(Zoho People for AMD/ATS, Zoho One for ASS); access is granted in the app's
**Users & Access** screen.

| Folder | What it is |
|---|---|
| `client/` | React (Vite) front-end |
| `server/` | Express API + PostgreSQL + Zoho SSO |
| `prototype/` | The original single-file clickable prototype — the working spec for modules not yet rebuilt. Browsable at [/prototype/](https://academy.avanasurgical.com/prototype/) with a simulated login. |

**Start here: [CLAUDE.md](CLAUDE.md)** — full project guide: history,
architecture, security model, production/deploy runbook, local development,
roadmap, and hard-won gotchas. Written for Claude Code sessions but equally
useful to humans.

## Quick start (local)

```
cd server && cp .env.example .env   # point DATABASE_URL at local Postgres, set DEV_LOGIN=true
npm install && npm start            # API on :3200, migrations run automatically
cd ../client
npm install && npm run dev          # app on http://localhost:5174
```
