# Avana Learning Hub

Clickable prototype of the Learning & Development internal application for the Avana Group
(Avana Medical Devices, Avana Surgical Systems, Avana Technology Services).

Built from the **LD Application Requirements Checklist** as a working reference for the
development partner and for stakeholder review. Everything runs client-side on sample data —
no server, no database; data resets on page reload.

## Run it

Open `index.html` in any modern browser. Internet is needed once for the Google Fonts,
QR-code and Excel (SheetJS) libraries loaded from CDN; everything else is self-contained.

## What's implemented (Phase 1)

| Module | Highlights |
|---|---|
| Dashboard | Coverage / compliance / hours / budget tiles, attention list, upcoming trainings |
| 01 Employees | Full record with training history, add form, search, entity filter, Excel import with column mapping |
| 02 Trainings | Multi-day planning (per-day dates), participants per training, list + calendar views |
| 04 Attendance | Per-training / per-participant / per-day grid, organizer & trainer marking, admin corrections with reason, QR self check-in, audit log |
| 05 Feedback | Per-training form builder or file upload, QR / share link, auto-e-mail exclusion for early submitters, results export |
| 08 Expenses | Full expense record (budget / actual / part-payments / variance), multi-entity pro-rata split by headcount, multiple invoice uploads |
| 09 Reports | 14 report types; 5 generate live from sample data with real `.xlsx` export |
| Users & Access | Role list (Super admin / Admin / Manager), access levels, Zoho SSO sign-in model |

Phase 2 (planned, visible but locked in the menu): Nominations, Effectiveness, Assessments, Certificates.

## Key conventions baked in

- Entities: AMD / ASS / ATS; Zoho employee IDs; INR, IST, Apr–Mar financial year
- ISO 13485 audit trail: corrections logged with user, timestamp and reason; deactivate, never delete
- 80% pass mark and 75% attendance eligibility (thresholds pending final checklist sign-off)

## Stack

Single-file HTML/CSS/JS. CDN libraries: [SheetJS](https://cdnjs.com/libraries/xlsx) for Excel
import/export, [qrcodejs](https://cdnjs.com/libraries/qrcodejs) for QR generation. Light and
dark theme via CSS custom properties.
