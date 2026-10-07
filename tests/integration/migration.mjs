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
const name = `cekis_sprint6_${randomUUID().replaceAll("-", "")}`;
const oldDir = await mkdtemp(join(tmpdir(), "cekis-sprint5-migrations-"));
const legacyName = `cekis_sprint6_fix_${randomUUID().replaceAll("-", "")}`;
const legacyDir = await mkdtemp(join(tmpdir(), "cekis-sprint6-migrations-"));
const testOwnerUrl = new URL(ownerUrl); testOwnerUrl.pathname = `/${name}`;
const testAppUrl = new URL(appUrl); testAppUrl.pathname = `/${name}`;
const admin = new Client({ connectionString: ownerUrl.toString() });
await admin.connect();
let created = false;
let legacyCreated = false;
try {
  await admin.query(`CREATE DATABASE "${name}"`); created = true;
  await mkdir(join(oldDir, "meta"));
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  journal.entries = journal.entries.filter((entry) => entry.idx <= 8);
  await writeFile(join(oldDir, "meta", "_journal.json"), JSON.stringify(journal));
  for (const entry of journal.entries) await copyFile(`drizzle/${entry.tag}.sql`, join(oldDir, `${entry.tag}.sql`));
  const pool = new Pool({ connectionString: testOwnerUrl.toString() });
  try { await migrate(drizzle(pool), { migrationsFolder: oldDir }); } finally { await pool.end(); }
  const owner = new Client({ connectionString: testOwnerUrl.toString() });
  await owner.connect();
  const ownerId = `sprint5-${randomUUID()}`;
  const purchaseId = randomUUID(), receiptId = randomUUID();
  try {
    await owner.query(`INSERT INTO "user" (id,name,email,email_verified) VALUES ($1,'Sprint 6','synthetic@example.test',true)`, [ownerId]);
    await owner.query(`INSERT INTO purchase (id,owner_id,submission_key,product_name,seller,purchase_date,warranty_state,warranty_end_date,warranty_source)
      VALUES ($1,$2,$3,'Senas pirkinys','Pardavėjas','2024-01-31','known','2028-02-29','date')`, [purchaseId,ownerId,randomUUID()]);
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
    const result = await check.query(`SELECT p.warranty_state,p.warranty_end_date::text AS warranty_end_date,p.warranty_duration_months,p.warranty_source,p.revision,
      r.sha256,r.object_key,pr.receipt_id FROM purchase p JOIN purchase_receipt pr ON pr.purchase_id=p.id JOIN receipt r ON r.id=pr.receipt_id WHERE p.id=$1`, [purchaseId]);
    const row = result.rows[0];
    if (!row || row.warranty_state !== "known" || row.warranty_end_date !== "2028-02-29" || row.warranty_duration_months !== null || row.warranty_source !== "date" || row.revision !== 1 || row.receipt_id !== receiptId || row.sha256 !== "a".repeat(64) || row.object_key !== `synthetic/${receiptId}`) throw new Error("Migration changed existing purchase or receipt metadata.");
    const defaults = (await check.query(`SELECT p.reminder_mode,p.reminder_offset,p.reminder_pref_revision,u.reminder_recipient_version,
      (SELECT count(*)::int FROM warranty_reminder) AS work FROM purchase p JOIN "user" u ON u.id=p.owner_id WHERE p.id=$1`, [purchaseId])).rows[0];
    if (defaults.reminder_mode !== "inherit" || defaults.reminder_offset !== null || defaults.reminder_pref_revision !== 0 || defaults.reminder_recipient_version !== 1 || defaults.work !== 0) throw new Error("Migration silently enabled reminders.");
    await check.query(`UPDATE "user" SET email_verified=false WHERE id=$1`, [ownerId]);
    const version = (await check.query(`SELECT reminder_recipient_version FROM "user" WHERE id=$1`,[ownerId])).rows[0].reminder_recipient_version;
    if (version !== 2) throw new Error("Verification change did not invalidate recipient version.");
    for (const statement of [
      `UPDATE purchase SET reminder_mode='custom',reminder_offset=60 WHERE id=$1`,
      `UPDATE purchase SET reminder_mode='off',reminder_offset=30 WHERE id=$1`,
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
    const rights = (await app.query(`SELECT current_user,has_table_privilege(current_user,'purchase','SELECT,INSERT,UPDATE,DELETE') AS dml,
      has_table_privilege(current_user,'reminder_preference','SELECT,INSERT,UPDATE,DELETE') AS preferences,
      has_table_privilege(current_user,'warranty_reminder','SELECT,INSERT,UPDATE,DELETE') AS work,
      has_schema_privilege(current_user,'public','CREATE') AS ddl`)).rows[0];
    if (rights.current_user !== "cekis_app" || !rights.dml || !rights.preferences || !rights.work || rights.ddl) throw new Error("App role permissions changed.");
  } finally { await app.end(); }
  const legacyOwnerUrl = new URL(ownerUrl); legacyOwnerUrl.pathname = `/${legacyName}`;
  const legacyAppUrl = new URL(appUrl); legacyAppUrl.pathname = `/${legacyName}`;
  await admin.query(`CREATE DATABASE "${legacyName}"`); legacyCreated = true;
  await mkdir(join(legacyDir,"meta"));
  const legacyJournal = JSON.parse(await readFile("drizzle/meta/_journal.json","utf8"));
  legacyJournal.entries = legacyJournal.entries.filter((entry)=>entry.idx <= 10);
  await writeFile(join(legacyDir,"meta","_journal.json"),JSON.stringify(legacyJournal));
  for (const entry of legacyJournal.entries) await copyFile(`drizzle/${entry.tag}.sql`,join(legacyDir,`${entry.tag}.sql`));
  const legacyPool = new Pool({connectionString:legacyOwnerUrl.toString()});
  try {
    await migrate(drizzle(legacyPool),{migrationsFolder:legacyDir});
    const legacyOwner = `legacy-${randomUUID()}`;
    await legacyPool.query(`INSERT INTO "user"(id,name,email,email_verified) VALUES($1,'Legacy','legacy@example.test',true)`,[legacyOwner]);
    const ids=[randomUUID(),randomUUID(),randomUUID()];
    for (const [index,mode,offset] of [[0,"inherit",null],[1,"off",null],[2,"custom",7]]) {
      await legacyPool.query(`INSERT INTO purchase(id,owner_id,submission_key,product_name,seller,purchase_date,warranty_state,warranty_end_date,warranty_source,reminder_mode,reminder_offset)
        VALUES($1,$2,$3,'Senas pirkinys','Pardavėjas','2028-01-01','known','2029-01-01','date',$4,$5)`,[ids[index],legacyOwner,randomUUID(),mode,offset]);
    }
    await migrate(drizzle(legacyPool),{migrationsFolder:"drizzle"});
    await migrate(drizzle(legacyPool),{migrationsFolder:"drizzle"});
    const valid=(await legacyPool.query("SELECT reminder_mode,reminder_offset FROM purchase WHERE owner_id=$1 ORDER BY reminder_mode",[legacyOwner])).rows;
    if (valid.length!==3 || valid[0].reminder_mode!=="custom" || valid[0].reminder_offset!==7 || valid[1].reminder_mode!=="inherit" || valid[1].reminder_offset!==null || valid[2].reminder_mode!=="off" || valid[2].reminder_offset!==null)
      throw new Error("Forward constraint migration changed valid reminder rows.");
    await legacyPool.query(`GRANT USAGE ON SCHEMA public TO cekis_app`);
    await legacyPool.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO cekis_app`);
    await admin.query(`GRANT CONNECT ON DATABASE "${legacyName}" TO cekis_app`);
    const legacyApp = new Client({connectionString:legacyAppUrl.toString()});
    await legacyApp.connect();
    try {
      for (const statement of [
        `UPDATE purchase SET reminder_mode='custom',reminder_offset=NULL WHERE id=$1`,
        `INSERT INTO purchase(owner_id,submission_key,product_name,seller,purchase_date,warranty_state,warranty_end_date,warranty_source,reminder_mode,reminder_offset)
         VALUES($1,$2,'Blogas pirkinys','Pardavėjas','2028-01-01','known','2029-01-01','date','custom',NULL)`,
      ]) {
        try { await legacyApp.query(statement,statement.startsWith("UPDATE")?[ids[0]]:[legacyOwner,randomUUID()]); throw new Error("NULL custom offset was accepted."); }
        catch(error) { if(error.code!=="23514" || error.constraint!=="purchase_reminder_check") throw error; }
      }
    } finally { await legacyApp.end(); }
  } finally { await legacyPool.end(); }
  console.log("Sprint 5 and populated Sprint 6 upgrades, repeat migration, receipt association, reminder constraints and limited app role: passed");
} finally {
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  if (legacyCreated) await admin.query(`DROP DATABASE "${legacyName}" WITH (FORCE)`);
  await admin.end();
  await rm(oldDir, { recursive: true, force: true });
  await rm(legacyDir, { recursive: true, force: true });
}
