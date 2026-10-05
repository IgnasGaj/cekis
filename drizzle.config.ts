import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: process.env.CEKIS_ENV_FILE ?? ".env.local" });
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("Trūksta MIGRATION_DATABASE_URL. Patikrink .env.example.");

export default defineConfig({
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});
