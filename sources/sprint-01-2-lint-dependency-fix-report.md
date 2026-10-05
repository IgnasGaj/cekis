# Čekis — Sprint 01.2 lint dependency correction report

Date: 2026-10-05. Branch: `feature/sprint-01-authentication-app-shell`. Scope: development lint tooling only; Sprint 2 was not started.

## Remedy and dependency tree

The registry still lists `braces@3.0.3` as the latest release, and [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) lists no patched version. `@next/eslint-plugin-next@16.3.8` still directly depends on `fast-glob@3.3.1`. Importing it without changing the package leaves the vulnerable chain installed.

The repository now has a local `16.3.8-cekis.1` adaptation of that plugin. Its `dist/` rules are copied from the official 16.3.8 package, with the upstream MIT license and Vercel copyright retained. The only runtime edit is `dist/utils/get-root-dirs.js`: it accepts this repository's single app root and rejects arrays, glob patterns and other directories. The fork's package metadata omits `fast-glob`; `eslint-config-next@16.3.8` resolves the local package through an npm override. The separate esbuild override from Sprint 1 is unchanged.

| Before | After |
| --- | --- |
| `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces@3.0.3` | `eslint-config-next@16.3.8 → @next/eslint-plugin-next@16.3.8-cekis.1` (local) → `@eslint-community/eslint-utils@4.9.1` |
| Full audit: five high entries in one chain | Full audit: zero vulnerabilities |
| Production audit: zero | Production audit: zero |

`npm ls` confirms that `fast-glob`, `micromatch` and `braces` are absent. The plugin copy is excluded from application linting because it is unchanged third-party compiled code except for the reviewed helper. It is covered by the helper fixtures and audit. The local copy is not an upstream security release; the suffix identifies its ownership and maintenance obligation.

## Lint protection retained

Before editing, `eslint --print-config` was captured for `src/lib/auth.ts`, `src/app/prisijungti/sign-in-form.tsx` and `tests/e2e/auth.spec.ts`. The replacement has identical active rule IDs, rule options and severities and identical settings for all three files: 86 active rules, including 20 TypeScript, 17 React, 16 Hooks, six JSX accessibility and 22 Next-specific rules. The parser remains TypeScript ESLint; a patch refresh changed its printed version from 8.71.0 to 8.71.1 without changing effective rule settings.

Programmatic negative fixtures verified these baseline severities: conditional Hook use (error), explicit TypeScript `any` (error), image without alt text (warning), async client component (warning), and `next/document` import outside `_document` (error). Helper fixtures accept omitted, relative-current and absolute-current roots; they reject other roots, arrays, malformed values and glob syntax. These fixtures do not live in the application source tree.

## Verification

| Check | Result |
| --- | --- |
| Node 22 `npm ci` with the final cross-platform lockfile | Passed locally and in a Linux Node 22 container; Linux optional native packages are present. |
| `npm audit`; `npm audit --omit=dev`; `npm ls` | Passed; zero vulnerabilities in both audits and no vulnerable glob chain installed. |
| `npm run lint`; `npm run test:lint-rules` | Passed, including representative negative fixtures at original severities. |
| `npm run typecheck`; `npm test`; `npm run build` | Passed; eight unit tests. |
| `npm run test:e2e` against PostgreSQL and Mailpit | Passed; eight real SMTP/browser cases cover the established auth lifecycle, isolation, expiry, replay, race, sign-out, redirects, rejected-request quota and concurrent send limits. |
| Fresh disposable PostgreSQL migrations, safe rerun, role grants; `npm run db:generate` | Passed; no schema change generated. |
| Linux Node 22 clean install, full audit, lint and fixture suite | Passed. |
| External mailbox delivery and physical-device checks | Not run; unrelated production configuration/device work remains. |

CI now fails on a nonzero full `npm audit` result and runs the negative lint fixtures. [CI runs for this branch](https://github.com/IgnasGaj/cekis/actions/workflows/ci.yml?query=branch%3Afeature%2Fsprint-01-authentication-app-shell) show the exact final pushed SHA and run; these are also stated in the delivery handoff. A commit cannot contain its own SHA or resulting CI run URL without changing that SHA.

## Maintenance

When Next or its ESLint config changes, compare the official plugin's rules, helper and license against this copy, then update or remove the local adaptation. Rerun print-config comparison, fixture checks, full audit, Linux clean install and CI. A future monorepo layout needs a reviewed root helper; this fork deliberately does not accept unrestricted glob patterns. See the [local plugin notes](../vendor/eslint-plugin-next/README.md).
