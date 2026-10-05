# Sprint 1 foundation decisions

Reviewed 2026-10-05. The complete `cekis-project-roadmap.md` was found in the supplied iCloud Downloads source after a broader search and inspected alongside the sprint prompt and four image files. Its Phase 0 and Sprint 1 boundaries match the implementation below.

## Runtime and architecture

Node 22, Next.js 16.3.8 App Router, React 19.3.0, TypeScript 5.9, Tailwind 4.3.3, Drizzle ORM 0.45.3 and Drizzle Kit 0.31.11 are pinned through `package-lock.json`. Next.js 16 requires Node 20.9+ and uses a separate `.next/dev` output by default ([Next.js upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16), [isolated development build](https://nextjs.org/docs/app/api-reference/config/next-config-js/isolatedDevBuild)). SQL migrations are generated and applied with [Drizzle Kit](https://orm.drizzle.team/docs/drizzle-kit-migrate). The architecture is browser → Next.js server → PostgreSQL plus SMTP.

## Authentication

Auth.js's current Next.js documentation covers `next-auth@5.0.0-beta` ([Auth.js getting started](https://authjs.dev/getting-started)); the stable version requirement led to Better Auth 1.7.7 with its supported [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [magic-link plugin](https://better-auth.com/docs/plugins/magic-link) and [Next.js integration](https://better-auth.com/docs/integrations/next). The first verified email creates a user; a later verified email signs in to the same user. There are no passwords or password reset. Recovery requires continued control of the email mailbox.

Better Auth stores opaque sessions and single-use, hashed magic-link identifiers in PostgreSQL. Its current plugin consumes tokens atomically. Cookies are HttpOnly/SameSite Lax and Secure for HTTPS. The library validates origins and callbacks; this app additionally permits only `/pradzia` as the post-login destination. The auth API uses Better Auth's database rate limit, while an atomic PostgreSQL upsert limits sends per normalized email across instances. The default per-email limit is five sends per hour. [Better Auth security](https://better-auth.com/docs/reference/security), [magic-link consumption](https://better-auth.com/docs/plugins/magic-link), [rate limits](https://better-auth.com/docs/concepts/rate-limit), and [sessions](https://better-auth.com/docs/concepts/session-management) informed the configuration.

## Providers and cost boundaries

Local auth email uses Mailpit (Docker) or MailDev (npm) through SMTP. External delivery is not configured. For later production selection, [Resend pricing](https://resend.com/pricing) lists 3,000 free transactional emails/month and 100/day; its [Ireland region](https://resend.com/changelog/multi-region-for-everyone) is available on the free plan. A verified sending domain and potentially a paid tier would be needed as usage grows. No Resend account was created.

PostgreSQL hosting is undecided. [Neon's October 2026 free-plan update](https://neon.com/blog/neon-free-plan-1-gb-per-project) lists 1 GB storage and 100 CU-hours per free project; European regions are available, but data residency and backup requirements need review before selection. Local PostgreSQL remains the only configured database.

Object storage is deferred to receipt files. [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) lists 10 GB-month of Standard storage and operation allowances free; [EU jurisdiction](https://developers.cloudflare.com/r2/reference/data-location/) can constrain object location. Paid usage can start past quotas. No bucket exists.

Scheduler choice is deferred to reminders. [Upstash QStash pricing](https://upstash.com/pricing/qstash) lists 1,000 free messages/day, while [EU Central availability](https://upstash.com/docs/workflow/howto/multi-region) is documented. Delivery retries and retention limits need later evaluation. No scheduler is provisioned. These figures are time-sensitive and must be checked again before paid or production commitments.
