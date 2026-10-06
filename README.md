# Čekis

Sprint 2 adds a private manual purchase vault to the existing passwordless email account and mobile shell. Purchases persist in PostgreSQL and can be searched, edited and deleted. Receipt uploads and warranty tracking are planned for later sprints. The [roadmap](docs/roadmap.md) defines product scope; [Sprint 2](docs/sprints/sprint-02.md) records this slice.

## Requirements

- Node 22 (`.nvmrc`) and npm 10 or newer
- PostgreSQL 17 (Docker or a local installation)
- An SMTP inbox/catcher for local development

## Quick start with Docker

```sh
npm ci
npm run setup:local
docker compose --env-file .env.local up -d postgres postgres_test mailpit
npm run db:migrate
npm run db:grant
npm run db:check-role
npm run dev
```

Open `http://127.0.0.1:3100/prisijungti`. View local email at `http://localhost:1080`. The generated database credentials are for local development only. `.env.local` and `.env.test.local` are ignored by Git. `npm run db:migrate` is safe to rerun; it applies only unapplied versioned SQL migrations. `npm run db:grant` gives the application role DML access to auth and purchase tables. The migration owner retains DDL rights. Do not point these commands at a database containing unrelated data.

## Without Docker

Use an existing PostgreSQL 17 installation. Run `npm run setup:local` first, then create database `cekis` with owner role `cekis_owner` and your own strong password, and change `MIGRATION_DATABASE_URL` in `.env.local`. Set `DATABASE_URL` to a distinct password for `cekis_app`. The migration owner needs permission to create the application role; otherwise a database administrator must run `npm run db:grant`. Run `npm run db:migrate` and `npm run db:grant`. PostgreSQL does not provide per-user row isolation automatically; access control for purchases is enforced in owner-scoped server queries. The application role has SELECT, INSERT, UPDATE and DELETE on public tables, including `purchase`, but no schema ownership or migration privileges. Default privileges cover later owner-created tables.

For a non-Docker SMTP inbox, [install the free Mailpit binary](https://mailpit.axllent.org/docs/install/) (on macOS: `brew install mailpit`), then run `npm run mail:dev` in another terminal. This starts SMTP on port 1025 and its web inbox at `http://localhost:1080`. The Docker option runs the same catcher at those ports. Keep `SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025` and the local sender in `.env.local`. The automated browser tests use Mailpit's API. Neither catcher delivers to an external mailbox.

## Configuration

`.env.example` lists required values. `APP_URL` must be the exact browser origin, including port. `BETTER_AUTH_SECRET` must have at least 32 characters. `DATABASE_URL` is for the limited application role; `MIGRATION_DATABASE_URL` is for the schema owner. Set `SMTP_USER` and `SMTP_PASSWORD` together only for a real SMTP provider. Production needs HTTPS, a domain, a real email transport and a reviewed deployment/database setup. Auth links expire after five minutes and are single use. Losing access to the mailbox means email-link recovery is unavailable.

Direct magic-link sign-in requests must include `callbackURL: "/pradzia"` and `errorCallbackURL: "/prisijungti/nuoroda-nebegalioja"`. Missing or unsupported destinations return HTTP 400 without sending mail or using the per-email quota. Better Auth checks request trust and its own rate limit before the atomic database quota check at the email-send boundary. An SMTP failure still uses one send attempt; otherwise repeated transport failures could evade the abuse limit. Request a new link after the transport is restored.

## Commands

```sh
npm ci
npm run db:migrate
npm run db:grant
npm run db:check-role
npm run dev
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run start
```

The browser tests require the dedicated `cekis_test` database on port 5434, Mailpit on ports 1025/1080, and Chromium (`npx playwright install chromium`). Prepare the test database with:

```sh
CEKIS_ENV_FILE=.env.test.local npm run db:migrate
CEKIS_ENV_FILE=.env.test.local npm run db:grant
npm run test:e2e
```

Playwright refuses to run unless both database URLs name `cekis_test`. It starts the app automatically if port 3100 is free. In CI, PostgreSQL and Mailpit are disposable services. `npm run db:generate` creates a new SQL migration after a schema change; review its SQL before applying it.

## Manual purchases

Sign in, then open **Pirkiniai** or **+ Čekis → Įvesti rankiniu būdu**. The purchase list supports product/seller substring search and purchase-date ordering, with 50 records per page. The URL keeps search, sort and page state. Purchase detail, edit and delete require the current owner session. Deleting clears user-entered fields while retaining an owner-bound submission-key tombstone, so a replayed create request cannot restore a deleted purchase. The tombstone remains until the owning account is deleted; each new form receives a fresh UUID key. Replaying a successful key returns its original purchase without overwriting later edits. A new key allows a separate intentional purchase with identical fields.

Product and seller are required trimmed text (1–200 characters); notes are optional plain text (up to 2,000). Purchase date is a real `YYYY-MM-DD` calendar day no later than **today in Europe/Vilnius**; the form leaves it blank until entered. Price is optional exact `numeric(12,2)`, from 0 to 9,999,999,999.99, with a comma or point decimal separator and at most two decimals. Grouping separators are not accepted. Currency is stored only with a price; supported codes are EUR, USD, GBP and PLN. The form defaults to EUR. All price values remain decimal strings on the server; there is no conversion or floating-point money arithmetic. Ties in purchase-date ordering use creation timestamp then ID in the same direction. Search is case-insensitive with literal `%` and `_`; accent folding is not enabled.

Every purchase says **Garantija nenurodyta** and **Čekis nepridėtas**. Sprint 3 will add private receipt upload. Sprint 5 will add reviewed warranty states (unknown, none, known) through a separate migration; no warranty value is inferred today.

Next.js 16 separates development output under `.next/dev` from production output under `.next`. `npm run typecheck` generates route types first; `next-env.d.ts` is generated and ignored by Git. If a build or server gets into a bad state, stop the relevant process, then rerun the command. Never remove output files while that process is running.

## Lint tooling

`eslint-config-next@16.3.8` uses a [local Next ESLint plugin adaptation](vendor/eslint-plugin-next/README.md). It preserves the official rules while limiting root-directory discovery to this single app, removing the vulnerable glob dependency. Run `npm run test:lint-rules` when changing lint configuration. CI runs the fixture checks and full `npm audit`; do not add monorepo glob roots without reviewing the local helper and its tests.
