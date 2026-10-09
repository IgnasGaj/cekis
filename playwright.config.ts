import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

if (!process.env.CI) loadEnv({ path: ".env.test.local", override: true });
if (process.env.CEKIS_E2E_APP_URL) process.env.APP_URL = process.env.CEKIS_E2E_APP_URL;
// Disposable services and a fixed local send-window clock for reminder integration cases.
const dateParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vilnius",year:"numeric",month:"2-digit",day:"2-digit" }).formatToParts(new Date()).map((part) => [part.type,part.value]));
const vilniusDay = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
process.env.CEKIS_TEST_WORKER = "true";
process.env.REMINDER_TEST_NOW = `${vilniusDay}T10:00:00.000Z`;
process.env.REMINDER_TRANSPORT_ENABLED = "true";
process.env.REMINDER_WORKER_SECRET ??= "disposable-browser-test-worker-secret-123456";
const testDatabase = new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/invalid");
const appDatabase = new URL(process.env.DATABASE_URL ?? "postgres://invalid/invalid");
if (testDatabase.pathname !== "/cekis_test" || appDatabase.pathname !== "/cekis_test") {
  throw new Error("Browser tests require a dedicated cekis_test database. See README.md.");
}
const appURL = new URL(process.env.APP_URL ?? "http://127.0.0.1:3100");

export default defineConfig({
  testDir: "./tests/e2e",
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: appURL.origin, ...devices["Desktop Chrome"] },
  webServer: {
    command: `npm run ocr:prepare && CEKIS_NEXT_DIST_DIR=.next-e2e npx next dev --hostname 127.0.0.1 --port ${appURL.port}`,
    url: `${appURL.origin}/prisijungti`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
