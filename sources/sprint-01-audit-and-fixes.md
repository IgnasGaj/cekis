# Čekis — Sprint 1 audit and correction prompt

Date: 2026-10-05. Verdict: **changes required; Sprint 2 is not authorised by this audit**.

## Audited baseline

Repository: https://github.com/IgnasGaj/cekis.git

Branch: `feature/sprint-01-authentication-app-shell` (current remote default).

Commit: `8dc4e38b8d61d3a1108aef8690c376dc79685b22`.

The audit read the supplied Sprint 1 prompt, complete roadmap, all four design references, application source, SQL migrations, setup scripts, tests, documentation, lockfile and CI definition. Repository code was inspected without modifying or pushing it. This is Čekis, not the older Pirkėjo Skydas project.

## Verification results

| Check | Result and evidence |
| --- | --- |
| Clean install | Passed with `npm ci`. Audit runtime is Node 24.19.0; package requires Node 22, so npm emitted an engine warning. This is an audit environment limitation, not a project defect. CI used `.nvmrc`. |
| Lint | `npm run lint` passed. |
| Unit tests | `npm test` passed: 8 cases in one file, covering redirect restrictions. |
| Typecheck | `npm run typecheck` passed. |
| Production build | `npm run build` passed with generated local placeholder configuration; no production service was provisioned. |
| Exact-commit CI | GitHub run https://github.com/IgnasGaj/cekis/actions/runs/37312751403 succeeded for the audited SHA. Its job steps passed clean install, migrations, grants, lint, typecheck, unit tests, Playwright and build. |
| Auth integration evidence | CI exercises the five committed Playwright cases with disposable PostgreSQL and Mailpit: genuine SMTP links, account lifecycle, two accounts, expiry/replay/concurrent consumption and send limits. These were not rerun locally during this audit because PostgreSQL and Docker were unavailable. |
| Dependency audit | `npm audit --json` reported 11 affected dependency entries: 7 high, 4 moderate. These entries include propagated dependency findings, not 11 independent application exploits. All reported affected entries are development dependencies. |
| Git delivery | Three commits have the owner's configured author/committer identity and ordinary messages. No Codex/OpenAI attribution or co-author trailers were found in commit metadata. No real environment file was tracked. |
| Product scope | Auth-only schema, Lithuanian screens, server-protected home/settings, honest empty state and inactive future navigation match Sprint 1. |
| Design | Source styling matches the reference direction. This audit did not rerun visual browser inspection, keyboard/large-text checks or physical-device checks. Earlier manual visual checks are reported in `docs/progress.md`, not independently verified here. |

A passing CI does not establish production readiness or cover the findings below. External mailbox delivery remains unverified, as already documented. Live production migration state is outside this local Sprint 1 audit.

## F1 — Validate request trust before consuming email send quota

Priority: medium. Location: `src/app/api/auth/[...all]/route.ts`, POST handler.

The wrapper calls `consumeEmailSendLimit()` before `handlers.POST()`. Better Auth's origin/CSRF checks execute inside the latter. Consequently, a syntactically valid request that the auth library rejects can still increment the victim email's database quota. Five rejected requests can spend its default hourly allowance without delivering any email. Rejections by the library's global rate limiter can similarly occur after the custom quota mutation.

Evidence: direct code inspection plus a small isolated route harness using the actual transpiled wrapper, real Zod validation and mocked quota/auth boundaries. A simulated 403 auth rejection produced:

```json
{"status":403,"events":["quota-consumed","auth-origin-rejection"]}
```

This harness proves ordering; it is not a live database or browser exploit demonstration. Existing integration tests check successful send quotas but do not assert that rejected-origin requests leave the quota unchanged.

Required fix: move quota consumption to a supported point after request trust and relevant auth request validation, but before SMTP delivery. Preserve the atomic PostgreSQL upsert and library CSRF protections. Prefer an appropriate supported library hook/email transport boundary over duplicating the library's security logic. Never disable CSRF/origin checks. Decide and document whether transport failures count toward abuse limits.

Required regression: send repeated requests with an untrusted Origin and relevant Fetch Metadata, assert rejection and no email delivery, inspect the quota row/count, then verify the legitimate user still receives the full configured send allowance. Verify valid concurrent sends still obey the exact limit. Include requests rejected by library validation/rate limiting where applicable.

## F2 — Resolve inconsistent default callback handling

Priority: low. Same route, POST and GET handlers.

`callbackURL` is optional in the wrapper. A direct request with only an email passes wrapper validation and triggers SMTP. The installed magic-link plugin defaults the emailed callback to `/`. The wrapper's verification GET then rejects `/`, because `safePostLoginPath()` permits only `/pradzia`. The result is an accepted request that emails an unusable link. The current UI supplies `/pradzia`, so its normal flow is unaffected.

Required fix: either require the callback and reject omission before quota mutation/email, or normalise omitted callbacks to the supported internal destination using a supported request flow. Preserve external redirect rejection. Make error callback defaults consistently produce the Lithuanian invalid-link screen.

Required regression: direct sign-in request omitting callback must either return a clear 400 without consuming quota/sending mail or produce a genuine working link to `/pradzia`. Test the actual emailed URL. Retest external, protocol-relative and malformed callbacks.

## F3 — Dependency audit remains unresolved

Priority: medium for development tooling; no production exploit was established.

Fresh audit matches the completion report: 11 affected dependency entries, 7 high and 4 moderate. Paths include:

- `maildev` → nested `nodemailer` (high findings).
- `eslint-config-next` → Next ESLint plugin → `fast-glob` → `micromatch` → `braces` (high finding).
- `drizzle-kit` → deprecated esbuild-kit loader/core utilities → nested `esbuild` (moderate finding).

The application's direct Nodemailer dependency is not the nested vulnerable MailDev copy. Do not describe these as demonstrated production vulnerabilities.

Required fix: review the exact current advisories, upgrade compatible supported packages or replace unnecessary development tools. Preserve a practical non-Docker SMTP option. Do not blindly use `npm audit fix --force`: current suggested changes include incompatible historical downgrades of Next ESLint configuration and Drizzle Kit. If using overrides, verify compatibility and justify them. Rerun clean install, migrations, real SMTP tests, lint, types, unit tests and build.

For an error-free audit, resolve the findings. If an upstream fix is unavailable, provide exact affected paths, exposure analysis and the blocked remedy; do not mark a clean audit or silently defer it to Sprint 10. The owner can separately decide whether to accept a remaining tooling risk.

## Codex correction instruction

Implement F1–F3 in the existing Čekis repository. First read applicable repository instructions, this audit, the roadmap, Sprint 1 requirements and current working-tree state. Recheck findings against latest remote code; preserve unrelated changes. Complete fixes and verification, not just a plan. Do not start purchases, receipts, OCR, warranty logic or any other Sprint 2+ feature.

Use Node 22 as declared. Add only meaningful regression coverage for the identified behavior. Run migrations against a fresh disposable test database and rerun them safely; never reset real data. Run real local SMTP link lifecycle tests, including the regressions above, and check CI on the exact final pushed SHA. Keep existing auth, expiry, replay, race, isolation, redirect and sign-out cases passing. Record pass/fail/skipped results honestly. Keep Lithuanian user-facing errors.

Update `docs/progress.md` and the Sprint 1 completion evidence with the final state. Save user-facing audit/correction Markdown files in `sources/`. Preserve internal project documentation in its established locations. Do not hardcode another ChatGPT workspace's image paths; resolve supplied sources by basename or use the inspected repository reference copies.

Commit and push the corrected code normally to `https://github.com/IgnasGaj/cekis.git`, using the existing appropriate branch and configured owner identity. Verify the remote before pushing. Use ordinary descriptive commits; no Codex/AI attribution, generated-by text, co-author trailers or assistant identity in git metadata. Do not fabricate an identity if configuration is missing. Do not force-push, rewrite history, merge or deploy as part of this correction prompt. No paid service activation is authorised.

Finish with the branch, exact pushed SHA, CI link/results, fixed findings, dependency audit result and any limitations. If interrupted, leave a continuation note with working-tree state and remaining commands. A fresh audit of that SHA is required before Sprint 2 is issued.
