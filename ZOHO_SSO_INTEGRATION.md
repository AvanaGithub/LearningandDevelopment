# Zoho SSO Integration Spec — Avana Learning Hub

Audience: development partner. Owner: L&D (Lokshni). Status: approved for build.

## Context

- Production URL: https://academy.avanasurgical.com
- Entities: AMD & ATS use **Zoho People** (login only); ASSP uses **Zoho One**.
  All staff therefore already hold Zoho accounts under the same Zoho Accounts
  sign-in layer — one "Sign in with Zoho" button serves all three entities.
- The entities may be **separate Zoho organisations**. That is irrelevant to
  this design: Zoho performs **authentication only** (who is this person).
  **Authorization** (may they enter, and with which role) is decided solely by
  the application's own **Users & Access** list. Never gate access on Zoho
  org/People membership.

## Flow (OAuth 2.0 authorization code — server side)

1. User clicks "Sign in with Zoho" → redirect to
   `https://accounts.zoho.in/oauth/v2/auth`
   with `client_id`, `response_type=code`, `redirect_uri`,
   `scope=openid email profile` (equivalently `AaaServer.profile.READ`),
   `access_type=online`, and a `state` anti-CSRF token.
2. Zoho authenticates the user (their normal Zoho password/2FA) and redirects
   to `https://academy.avanasurgical.com/auth/zoho/callback?code=…&state=…`.
3. Backend exchanges the code at `https://accounts.zoho.in/oauth/v2/token`
   (client_id + client_secret — **server side only, never in the browser**).
4. Backend reads the verified e-mail (ID token claim, or
   `https://accounts.zoho.in/oauth/user/info`).
5. Backend looks the e-mail up (case-insensitive) in **Users & Access**:
   - not found → reject with the existing message ("the administrator must add
     it in Users & Access first")
   - `status = Disabled` → reject ("account disabled")
   - found → create the app session with that record's user type and access
     (Super admin / Admin → admin UI, Manager → view-only manager UI, else
     employee self-service).
6. App session: signed HTTP-only session cookie, 8–12 h expiry, renewed on
   activity. Sign-out clears the app session (do not sign the user out of
   Zoho globally).

## Critical details

- **India data centre**: all endpoints are `accounts.zoho.in` (not .com).
  Verify by checking the URL staff see when logging into Zoho People/One.
  If any org turns out to be on another DC, use Zoho's multi-DC discovery.
- The Zoho client registration must **not** be restricted to a single Zoho
  organisation — users from all three entities' orgs must be able to
  authenticate. The Users & Access list is the only gate.
- QR participant pages (`#att/<code>`, `#fb/<code>`) currently require no
  login. For launch, require Zoho sign-in there too, then auto-identify the
  participant from the e-mail — removing the "I am" self-selection.
- Fallback for staff without Zoho accounts (checklist B3, open): choose one —
  e-mail OTP fallback, or issue Zoho People licences. External trainers:
  time-limited guest links, not Zoho accounts.
- Client secret handling: store in the server's secret store / env var.
  Never commit it to this repository.

## What replaces what in the prototype

| Prototype (today) | Production |
|---|---|
| E-mail typed, checked against Users & Access in the browser | Zoho OAuth; same list checked on the server |
| `#as/<email>` direct test links | Remove entirely |
| localStorage per-device data | Server database (shared) |
| "Try:" quick-fill buttons on sign-in | Remove |

## Registration data (filled by L&D)

- Zoho API Console client type: **Server-based Applications**
- Client name: Avana Learning Hub
- Homepage URL: https://academy.avanasurgical.com
- Authorized redirect URI: https://academy.avanasurgical.com/auth/zoho/callback
- Client ID: ______________________ (from api-console.zoho.in)
- Client Secret: shared separately via a secure channel — never in this repo

## Acceptance tests (UAT)

1. AMD user (Zoho People) signs in and lands in the role their Users & Access
   row grants.
2. ASSP user (Zoho One) — same.
3. ATS user (Zoho People) — same.
4. An e-mail NOT in Users & Access authenticates at Zoho but is rejected by
   the app with the standard message.
5. A user set to Disabled in Users & Access is rejected.
6. Deleting a user in Users & Access revokes their next sign-in.
7. Sign-out ends the app session but leaves the user signed into Zoho.
