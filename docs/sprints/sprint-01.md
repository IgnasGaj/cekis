# Sprint 1 — authentication and app shell

## Outcome and dependencies

The first usable Čekis slice lets a person request a passwordless email link, create or return to an account after verifying mailbox control, stay signed in across reloads and server restarts, use a protected Lithuanian mobile shell and sign out. Phase 0 supplies a clean project, supported stable runtime, PostgreSQL, migrations, local SMTP and design tokens. The complete roadmap remains the product scope authority; later purchase, receipt and warranty work waits for its sprint.

## Bounded changes

- Auth-only user, account, verification, session and rate-limit tables with versioned SQL migrations.
- Better Auth magic-link flow with hashed, expiring, atomic single-use verification and revocable database sessions.
- PostgreSQL-backed send limits, same-origin destination checks, Lithuanian form/email/error states.
- Protected home/settings pages and a four-item mobile navigation with future entries visibly unavailable.
- Local Docker and non-Docker instructions, environment example, CI and browser tests using a real local SMTP inbox.

No purchase, receipt file, OCR, warranty, reminder, PWA, legal, analytics or deployment functionality is part of this sprint.

## Acceptance and checks

- [x] Fresh Čekis repository and documented Node/npm/PostgreSQL/SMTP setup
- [x] Versioned auth-only PostgreSQL schema and limited application role
- [x] Stable passwordless library, Lithuanian email and single-use link
- [x] Protected home and settings, session persistence and sign-out
- [x] Email/IP request limits backed by PostgreSQL
- [x] Honest mobile shell with future navigation visibly unavailable
- [x] Local SMTP browser flow, two-account separation and security checks
- [ ] External email delivery and real-device check (require production configuration/device)
- [x] Remote CI passed for the Sprint 1 implementation branch

The next implementation boundary is Sprint 2's purchase vault.
