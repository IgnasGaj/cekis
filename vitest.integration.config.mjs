import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "server-only": fileURLToPath(new URL("./tests/integration/empty-server-only.ts",import.meta.url)) } },
  test: { include: ["tests/integration/reminder-worker.test.ts"], pool: "forks",maxWorkers:1,minWorkers:1,testTimeout:30_000 },
});
