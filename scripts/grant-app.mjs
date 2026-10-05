import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import pg from "pg";

config({ path: process.env.CEKIS_ENV_FILE ?? ".env.local" });
if (!process.env.MIGRATION_DATABASE_URL) throw new Error("Trūksta MIGRATION_DATABASE_URL. Patikrink .env.example.");
if (!process.env.DATABASE_URL) throw new Error("Trūksta DATABASE_URL. Patikrink .env.example.");
const appUrl = new URL(process.env.DATABASE_URL);
if (appUrl.username !== "cekis_app" || !appUrl.password) throw new Error("DATABASE_URL turi naudoti cekis_app su slaptažodžiu.");
const client = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
await client.connect();
try {
  const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'cekis_app'");
  const verb = role.rowCount ? "ALTER ROLE" : "CREATE ROLE";
  const statement = await client.query(`SELECT format('${verb} cekis_app WITH LOGIN PASSWORD %L', $1::text) AS sql`, [decodeURIComponent(appUrl.password)]);
  await client.query(statement.rows[0].sql);
  const databaseName = new URL(process.env.MIGRATION_DATABASE_URL).pathname.slice(1);
  const connectGrant = await client.query("SELECT format('GRANT CONNECT ON DATABASE %I TO cekis_app', $1::text) AS sql", [databaseName]);
  await client.query(connectGrant.rows[0].sql);
  await client.query(await readFile("scripts/create-app-role.sql", "utf8"));
}
finally { await client.end(); }
