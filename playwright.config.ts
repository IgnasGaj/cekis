import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

if (!process.env.CI) loadEnv({ path: ".env.test.local", override: true });
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
    command: `npx next dev --hostname 127.0.0.1 --port ${appURL.port}`,
    url: `${appURL.origin}/prisijungti`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
