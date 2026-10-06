import { config } from "dotenv";
import { Client, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

config({ path: process.env.CEKIS_ENV_FILE ?? ".env.test.local" });
const ownerUrl = new URL(process.env.MIGRATION_DATABASE_URL);
const appUrl = new URL(process.env.DATABASE_URL);
if (ownerUrl.pathname !== "/cekis_test" || appUrl.pathname !== "/cekis_test") throw new Error("Use the disposable cekis_test connection only.");
const name = `cekis_sprint5_${randomUUID().replaceAll("-", "")}`;
const oldDir = await mkdtemp(join(tmpdir(), "cekis-sprint4-migrations-"));
const testOwnerUrl = new URL(ownerUrl); testOwnerUrl.pathname = `/${name}`;
const testAppUrl = new URL(appUrl); testAppUrl.pathname = `/${name}`;
const admin = new Client({ connectionString: ownerUrl.toString() });
await admin.connect();
let created = false;
try {
  await admin.query(`CREATE DATABASE "${name}"`); created = true;
  await mkdir(join(oldDir, "meta"));
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  journal.entries = journal.entries.filter((entry) => entry.idx <= 7);
  await writeFile(join(oldDir, "meta", "_journal.json"), JSON.stringify(journal));
  for (const entry of journal.entries) await copyFile(`drizzle/${entry.tag}.sql`, join(oldDir, `${entry.tag}.sql`));
  const pool = new Pool({ connectionString: testOwnerUrl.toString() });
  try { await migrate(drizzle(pool), { migrationsFolder: oldDir }); } finally { await pool.end(); }
  const owner = new Client({ connectionString: testOwnerUrl.toString() });
  await owner.connect();
  const ownerId = `sprint5-${randomUUID()}`;
  const purchaseId = randomUUID(), receiptId = randomUUID();
  try {
    await owner.query(`INSERT INTO "user" (id,name,email) VALUES ($1,'Sprint 5','synthetic@example.test')`, [ownerId]);
    await owner.query(`INSERT INTO purchase (id,owner_id,submission_key,product_name,seller,purchase_date) VALUES ($1,$2,$3,'Senas pirkinys','Pardavėjas','2024-01-31')`, [purchaseId,ownerId,randomUUID()]);
    await owner.query(`INSERT INTO receipt (id,owner_id,submission_key,target_purchase_id,object_key,filename,content_type,byte_size,sha256,state,expires_at)
      VALUES ($1,$2,$3,$4,$5,'synthetic.png','image/png',8,$6,'ready',now()+interval '1 day')`, [receiptId,ownerId,randomUUID(),purchaseId,`synthetic/${receiptId}`,"a".repeat(64)]);
    await owner.query(`INSERT INTO purchase_receipt (owner_id,purchase_id,receipt_id) VALUES ($1,$2,$3)`, [ownerId,purchaseId,receiptId]);
  } finally { await owner.end(); }
  const upgradedPool = new Pool({ connectionString: testOwnerUrl.toString() });
  try { await migrate(drizzle(upgradedPool), { migrationsFolder: "drizzle" }); await migrate(drizzle(upgradedPool), { migrationsFolder: "drizzle" }); }
  finally { await upgradedPool.end(); }
  const check = new Client({ connectionString: testOwnerUrl.toString() });
  await check.connect();
  try {
    const result = await check.query(`SELECT p.warranty_state,p.warranty_end_date,p.warranty_duration_months,p.warranty_source,p.revision,
      r.sha256,r.object_key,pr.receipt_id FROM purchase p JOIN purchase_receipt pr ON pr.purchase_id=p.id JOIN receipt r ON r.id=pr.receipt_id WHERE p.id=$1`, [purchaseId]);
    const row = result.rows[0];
    if (!row || row.warranty_state !== "unknown" || row.warranty_end_date !== null || row.warranty_duration_months !== null || row.warranty_source !== null || row.revision !== 1 || row.receipt_id !== receiptId || row.sha256 !== "a".repeat(64) || row.object_key !== `synthetic/${receiptId}`) throw new Error("Migration changed existing purchase or receipt metadata.");
    for (const statement of [
      `UPDATE purchase SET warranty_state='known' WHERE id=$1`,
      `UPDATE purchase SET warranty_state='known',warranty_end_date='infinity',warranty_source='date' WHERE id=$1`,
      `UPDATE purchase SET warranty_state='none',warranty_end_date='2025-01-01' WHERE id=$1`,
    ]) {
      try { await check.query(statement, [purchaseId]); throw new Error("Invalid warranty state was accepted."); }
      catch (error) { if (error.code !== "23514") throw error; }
    }
  } finally { await check.end(); }
  await admin.query(`GRANT CONNECT ON DATABASE "${name}" TO cekis_app`);
  const grants = new Client({ connectionString: testOwnerUrl.toString() });
  await grants.connect();
  try { await grants.query("GRANT USAGE ON SCHEMA public TO cekis_app"); await grants.query("GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO cekis_app"); }
  finally { await grants.end(); }
  const app = new Client({ connectionString: testAppUrl.toString() });
  await app.connect();
  try {
    const rights = (await app.query(`SELECT current_user,has_table_privilege(current_user,'purchase','SELECT,INSERT,UPDATE,DELETE') AS dml,has_schema_privilege(current_user,'public','CREATE') AS ddl`)).rows[0];
    if (rights.current_user !== "cekis_app" || !rights.dml || rights.ddl) throw new Error("App role permissions changed.");
  } finally { await app.end(); }
  console.log("Sprint 4 upgrade, repeat migration, receipt association, warranty constraints and limited app role: passed");
} finally {
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
  await rm(oldDir, { recursive: true, force: true });
}
