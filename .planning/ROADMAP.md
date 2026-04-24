# Internal Planning Roadmap

This file tracks internal / backlog items managed via the `/gsd:` workflow.
The customer-facing roadmap lives at [/ROADMAP.md](../ROADMAP.md).

## Backlog

### Phase 999.1: Winlink Express CSV ingestion for EmComm dashboard (BACKLOG)

**Goal:** [Captured for future planning]
**Requirements:** TBD
**Plans:** 0 plans

Origin: suggested by Lor W3QA (Winlink Team) via email 2026-04-24, during the #297 Winlink gateway discussion.

Context captured (verbatim from Lor's message):

> You might consider a high-demand feature for EOCs and other emergency locations. Winlink Express HTML forms are used across the country and in Europe. Many forms have geo-location data embedded from the sending site. Particularly, the Field Situation Report and Damage Assessment forms, are sent from operators in the field to coordination points (typically command posts or EOCs) needing ground-truth information. An EOC running Express and receiving these reports will have a continuously-updated CSV file that is used to update dashboards and group displays. That would be a great application and addition to your EmComm display as well. Unfortunately, no API is supported by the Express client receiving these reports, but the CSV can be set to be continuously available anywhere on a shared or native drive to pull from.

Feature sketch:

- Point OpenHamClock's EmComm dashboard at a watched CSV path (local or network share)
- Parse new rows (Field Situation Report, Damage Assessment, other Express forms)
- Render incident pins on the EmComm map using embedded geo-location data
- Live feed panel of arriving reports with timestamps + originating station
- Field parsing for ICS-213 / Field Sitrep schemas

Dependencies / open questions before planning:

- Mirror Express's CSV schema precisely — loop Lor back in when ready to design
- Watch mechanism — fs.watch on a drive, polling fallback
- Security: the CSV path is a file-system read from user config, not internet data

Not blocking #297 — different data source entirely. Likely slots into a post-WASM EmComm phase.

Plans:

- [ ] TBD (promote with /gsd:review-backlog when ready)
