# Čekis — Sprint 1 correction report

Date: 2026-10-05. Scope: audit findings F1–F3 on `feature/sprint-01-authentication-app-shell`. No Sprint 2 work was started.

## Corrections

| Finding | Result |
| --- | --- |
| F1 — rejected requests used the email quota | Fixed. The atomic PostgreSQL upsert runs inside Better Auth's supported `sendMagicLink` callback, after library validation, origin/CSRF checks and IP rate limiting, before SMTP delivery. Rejected requests leave the email quota unchanged. Failed SMTP attempts count toward the send limit to prevent transport retries from bypassing it. |
| F2 — omitted callbacks produced unusable links | Fixed. Direct sign-in requests require `/pradzia` and `/prisijungti/nuoroda-nebegalioja`; omission or an unsafe value yields HTTP 400 before email or quota consumption. The verification GET rejects incomplete/unsafe callback URLs to the Lithuanian invalid-link screen. |
| F3 — dependency findings | Reduced from 11 affected entries (7 high, 4 moderate) to five high development-only entries. Removed npm MailDev and documented/tested standalone Mailpit as the non-Docker SMTP option. An esbuild override removes Drizzle Kit's vulnerable nested esbuild; clean install, migration and generation commands passed. The override exceeds Drizzle Kit's declared esbuild range, so dependency updates require revalidation. |

The remaining five entries are one transitive chain: `eslint-config-next@16.3.8 → @next/eslint-plugin-next@16.3.8 → fast-glob@3.3.1 → micromatch@4.0.8 → braces@3.0.3`. The underlying [braces stack-exhaustion advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) applies to lint pattern processing. Lint is used by developers and CI; this chain is absent from the production dependency audit. There is no published patched `braces` version as of this report. npm suggests downgrading the Next ESLint config to 14.2.35, which does not match the Next 16 setup. A patched upstream release or a reviewed replacement for Next-specific lint rules is the blocked remedy. The full audit is **not clean**; the owner must decide separately whether to accept this tooling risk. `npm audit --omit=dev` reports zero findings.

## Verification

- Node 22 clean install: passed.
- Fresh disposable `cekis_audit_test` PostgreSQL migration, safe rerun and app-role grants: passed. Drizzle schema generation reported no changes.
- Real SMTP-backed Playwright suite: eight passed on two full reruns after forwarding a fresh validated request body to Better Auth resolved a development-server body-read error. It includes existing account lifecycle, isolation, expiry, replay, race, sign-out and redirect checks plus rejected-Origin/Fetch-Metadata, auth validation, callback, library rate-limit and concurrent quota regressions.
- Standalone non-Docker Mailpit SMTP/API smoke check: passed.
- Lint, typecheck, eight unit tests and production build: passed.
- Full npm audit: five high development-only entries; production dependency audit: zero.
- The first correction push failed at CI's unit-test step. Its lockfile lacked Linux optional native packages. After regenerating the lockfile, `npm ci` and all eight unit tests passed in a Node 22 Linux container. Full local checks and fresh/repeated migrations also passed with the new lockfile.
- External mailbox delivery and physical-device checks: not run; they require production configuration or devices.

The exact pushed commit and its CI run are reported in the handoff for this correction. A fresh audit of that commit is required before Sprint 2.
