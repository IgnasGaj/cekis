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

## Audit correction evidence

The 2026-10-05 correction moved email quota consumption behind Better Auth request checks, required supported success/error callbacks, and removed MailDev's vulnerable npm dependency. Node 22 clean install, fresh and repeated migrations, generation, SMTP-backed browser tests, lint, typecheck, unit tests and build passed locally. The complete browser suite has eight cases; it now asserts no quota/email after rejected requests and follows a direct sign-in email's actual URL. The full dependency audit still reports five high development-only entries in the Next ESLint → braces chain; the production-only audit reports zero. Details and the blocked upstream remedy are in [progress](../progress.md). A fresh audit of the corrected commit is required before Sprint 2.
