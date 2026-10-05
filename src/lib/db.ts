import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "./env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { cekisPool?: Pool };
const pool = globalForDb.cekisPool ?? new Pool({ connectionString: getEnv().DATABASE_URL, max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.cekisPool = pool;

export const db = drizzle(pool, { schema });
export { pool };
