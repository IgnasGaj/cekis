# Local Next.js ESLint plugin adaptation

This directory copies the published `@next/eslint-plugin-next@16.3.8` package's `dist/` files. Its upstream source is [Vercel Next.js, `packages/eslint-plugin-next`, tag `v16.3.8`](https://github.com/vercel/next.js/tree/v16.3.8/packages/eslint-plugin-next). The upstream MIT license and Vercel copyright notice are retained in `LICENSE.md`. The local `16.3.8-cekis.1` suffix identifies this copy; it is not an upstream patch release.

The only runtime change is `dist/utils/get-root-dirs.js`: it accepts the current project root (the default, `.`, or the same absolute directory), and rejects arrays, glob syntax and other directories. Čekis has one Next.js app at the repository root. Upstream's `fast-glob` import was needed for monorepo root discovery and brought in the vulnerable `braces` chain. All ESLint rules, recommended presets and their severities remain upstream code.

Maintenance: when upgrading `next` and `eslint-config-next`, compare the new official plugin's rules, helper and license with this copy. Reapply or remove this local adaptation as appropriate, regenerate the lockfile with Linux optional packages present, compare `eslint --print-config` output, run `npm run test:lint-rules`, and run the full CI/audit. Multi-app or glob-based root directories require a reviewed helper change before enabling them.
