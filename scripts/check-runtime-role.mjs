import { config } from "dotenv";
import pg from "pg";

config({ path: process.env.CEKIS_ENV_FILE ?? ".env.local" });
if (!process.env.DATABASE_URL) throw new Error("Trūksta DATABASE_URL.");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows } = await client.query(`SELECT current_user AS role,
    has_table_privilege(current_user, 'public.purchase', 'SELECT') AS read,
    has_table_privilege(current_user, 'public.purchase', 'INSERT') AS create,
    has_table_privilege(current_user, 'public.purchase', 'UPDATE') AS edit,
    has_table_privilege(current_user, 'public.purchase', 'DELETE') AS remove,
    has_schema_privilege(current_user, 'public', 'CREATE') AS ddl,
    has_table_privilege(current_user, 'public.receipt', 'SELECT,INSERT,UPDATE,DELETE') AS receipts,
    has_table_privilege(current_user, 'public.purchase_receipt', 'SELECT,INSERT,UPDATE,DELETE') AS links,
    has_table_privilege(current_user, 'public.receipt_cancellation', 'SELECT,INSERT,UPDATE,DELETE') AS cancellations`);
  const rights = rows[0];
  if (rights.role !== "cekis_app" || !rights.read || !rights.create || !rights.edit || !rights.remove || rights.ddl || !rights.receipts || !rights.links || !rights.cancellations) {
    throw new Error("Programos rolės teisės neatitinka nustatytų ribų.");
  }
  console.log("Limited purchase and receipt runtime role: passed");
} finally { await client.end(); }
