# Čekis — Sprint 01.2: Resolve remaining lint dependency vulnerability

## Instruction to Codex

Resolve the remaining Sprint 1 dependency finding in `https://github.com/IgnasGaj/cekis.git`. Implement, verify, commit and push the completed correction. Do not stop at a plan or a recommendation to accept the risk. The owner explicitly chose remediation before Sprint 2.

Read applicable repository instructions, current `package.json`, lockfile, ESLint configuration, the Sprint 1 correction report, post-correction audit and progress documentation. Inspect git status and current remote refs before changing anything. The last audited baseline was branch `feature/sprint-01-authentication-app-shell`, SHA `433a5c1d4061c94c24abcf4ab0cb0c8a154e726d`; work from the current appropriate branch and preserve newer/unrelated work.

This is a tooling correction, not a UI sprint. The design images do not need reinspection. Never depend on `/workspace/scratch/...` paths from ChatGPT; they are not portable. Missing reference-image copies must not block this fix.

## Problem and required outcome

The last fresh full npm audit reported five high affected entries in one chain:

`eslint-config-next@16.3.8 → @next/eslint-plugin-next@16.3.8 → fast-glob@3.3.1 → micromatch@4.0.8 → braces@3.0.3`

Underlying advisory: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm. It concerns stack exhaustion while parsing deeply nested patterns. These are development dependencies; the production audit previously reported zero. Five entries represent one propagated underlying issue.

Required final outcome: clean full and production dependency audits, with meaningful TypeScript, React, Hooks, accessibility and Next.js lint protection preserved. Auth and CI must keep working. Do not add purchase features or start Sprint 2.

## Choose and implement a durable remedy

1. Recheck current advisory details and supported package releases using primary sources and the registry. Prefer compatible patched upstream packages if available. Verify actual installed versions, not just package.json ranges. Do not assume that the previous report's package availability remains current.
2. If the upstream chain still has no compatible patch, remove that chain through a reviewed equivalent lint implementation. Do not simply uninstall `eslint-config-next` and keep only generic JavaScript rules. Preserve the existing effective rules and their severities for representative `.ts` and `.tsx` files.
3. Before replacing configuration, capture `eslint --print-config` output for existing server, client and TypeScript files. Inventory active TypeScript, React, Hooks, JSX accessibility and Next-specific rules. Use this inventory to review the replacement and explain any intentional change.
4. Inspect actual dependency imports. In the audited plugin, `dist/utils/get-root-dirs.js` imports `fast-glob`; importing the official Next plugin directly therefore still installs the vulnerable chain. Turning off a rule or supplying a non-glob root does not remove a vulnerable installed dependency. Verify the final tree.
5. If equivalent maintained packages cannot preserve necessary Next-specific checks, a small reviewed local implementation or transparently maintained fork is permitted. Preserve relevant existing Next rules and avoid importing the vulnerable chain. Prefer reducing the root-directory discovery helper to the repository's actual single-app requirement rather than reimplementing an unrestricted glob parser. If vendoring upstream code, retain its license and copyright notices, record upstream version/source, and document update maintenance. Third-party license attribution must not be removed under the owner's git-attribution preference.
6. Do not fake a patched package version, edit node_modules as the lasting fix, suppress the advisory, omit development packages from the full audit, remove audit checks, change registries to hide findings, or use `npm audit fix --force`. Do not downgrade Next or install an incompatible historical ESLint config just because npm suggests it.
7. If introducing an override, prove that it fixes the installed affected version and fits the consumer API. Avoid expanding the existing broad esbuild override or adding unrelated overrides. Keep the previously verified auth corrections and Mailpit setup.

Keep architecture small. A complete lint-system rewrite is unnecessary if a narrow supported replacement solves the dependency problem. If a fork/local rule is needed, document exactly what maintenance it requires rather than promising zero future dependency problems.

## Meaningful verification

Use Node 22 as declared by `.nvmrc`. Regenerate the lockfile correctly and verify optional native packages on Linux CI; the previous correction already exposed a macOS/Linux lockfile problem. Do not remove platform entries or commit node_modules.

Run and record:

- Clean `npm ci` from the final lockfile.
- `npm audit` and `npm audit --omit=dev`: both must succeed with zero reported vulnerabilities. Report scanner/network failures as unavailable, never as zero.
- `npm ls`/`npm explain` checks showing the vulnerable braces chain is removed or truly patched. Do not claim removal based on an ignored lint rule.
- `npm run lint`, `npm run typecheck`, unit tests and production build.
- Effective lint-config comparison against the baseline. Preserve TypeScript parsing, React/Hooks correctness checks, accessibility checks and the applicable Next-specific safeguards.
- A small meaningful negative fixture suite proving lint still detects representative defects: hook misuse, invalid TypeScript lint patterns, JSX accessibility issues, an async client component and prohibited `next/document` imports outside `_document`, where those rules were active in the baseline. Respect original warn/error severities when asserting results. Use isolated fixtures or ESLint's programmatic API so deliberately bad files do not pollute normal application linting. If implementing a local directory helper, cover its supported path handling and malformed/unneeded pattern rejection without accepting arbitrary recursive glob syntax.
- Existing real SMTP-backed Playwright suite with disposable PostgreSQL/Mailpit: account creation, returning access, two accounts, expiry/replay/concurrent consumption, sign-out, redirects, rejected-request quota protection and valid concurrent send limits. Do not replace live tests with mocked sessions.
- Fresh disposable migrations, safe rerun and application-role grants. Recheck schema generation if modifying any Drizzle tooling dependency or override; it should produce no unexpected auth schema change.
- GitHub Actions on the exact final pushed SHA. All existing required steps must pass. Add an explicit full dependency audit CI step so this problem cannot silently return through future package updates. Do not mask audit failure with `continue-on-error` or a severity threshold that ignores known findings.

One suitable negative fixture suite is enough; do not inflate test counts. Never reset a real database. External mailbox delivery and physical-device checks are unrelated to this change and remain accurately labelled as unrun.

## Documentation and repository delivery

Save the completion report as `sources/sprint-01-2-lint-dependency-fix-report.md`. Include the actual remedy, changed dependency tree, lint-rule preservation evidence, exact checks and results, any fork/license/update obligations, branch, final pushed SHA and CI URL. Update `docs/progress.md` and setup/decision notes where the tooling changes affect them. Do not overwrite historical audit results; label them historical and add the new resolution.

The owner authorises ordinary commits and a normal push to `https://github.com/IgnasGaj/cekis.git` after verification. Verify remote and configured owner identity. Preserve unrelated work and commit only relevant changes. No Codex/OpenAI/assistant authors, co-author trailers, generated-by statements or AI attribution in git metadata/messages. Do not invent an identity, force-push, rewrite history, merge or deploy. No paid services or production provisioning.

Finish with implemented changes, complete audit results, preserved lint coverage, exact pushed SHA and final CI status. If interrupted, leave a precise continuation note with working-tree state, completed work and pending checks. If a clean resolution is genuinely blocked, provide the concrete reason and attempted remedy; do not mark this sprint complete, accept the risk for the owner, or advance to Sprint 2.
