import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { ESLint } from "eslint";

const require = createRequire(import.meta.url);
const { getRootDirs } = require("../vendor/eslint-plugin-next/dist/utils/get-root-dirs.js");
const eslint = new ESLint();

async function expectRule(name, source, ruleId, severity) {
  const filePath = path.join(process.cwd(), "src", "app", `__lint_${name}.tsx`);
  const [result] = await eslint.lintText(source, { filePath });
  assert(result, `${name}: ESLint returned no result`);
  assert(!result.messages.some((message) => message.fatal), `${name}: TypeScript/JSX parse failed`);
  const message = result.messages.find((item) => item.ruleId === ruleId);
  assert(message, `${name}: ${ruleId} did not report the defect`);
  assert.equal(message.severity, severity, `${name}: ${ruleId} severity changed`);
}

await expectRule(
  "hooks",
  'import { useState } from "react"; export function Widget({ active }: { active: boolean }) { if (active) useState(0); return null; }',
  "react-hooks/rules-of-hooks",
  2,
);
await expectRule(
  "typescript",
  "const value: any = 1; export { value };",
  "@typescript-eslint/no-explicit-any",
  2,
);
await expectRule(
  "accessibility",
  'export default function Widget() { return <img src="/receipt.png" />; }',
  "jsx-a11y/alt-text",
  1,
);
await expectRule(
  "client",
  '"use client"; export default async function Page() { return <div />; }',
  "@next/next/no-async-client-component",
  1,
);
await expectRule(
  "document",
  'import Document from "next/document"; export default Document;',
  "@next/next/no-document-import-in-page",
  2,
);

const cwd = process.cwd();
for (const rootDir of [undefined, ".", "./", cwd]) {
  assert.deepEqual(getRootDirs({ cwd, settings: { next: rootDir === undefined ? {} : { rootDir } } }), [cwd]);
}
for (const rootDir of ["src", "../another-app", "**/apps/*", "{app,other}", ["."], null, 7, ""]) {
  assert.throws(() => getRootDirs({ cwd, settings: { next: { rootDir } } }), /only the project root/);
}

process.stdout.write("Lint defects and single-app root handling: passed\n");
