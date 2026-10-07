import { afterAll,afterEach,beforeAll,describe,expect,it } from "vitest";
import { config } from "dotenv";
import { Client,Pool } from "pg";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

config({ path:process.env.CEKIS_ENV_FILE ?? ".env.test.local" });
const source = new URL(process.env.MIGRATION_DATABASE_URL!);
if (source.pathname !== "/cekis_test") throw new Error("Reminder integration tests require cekis_test.");
const name = `cekis_reminders_${randomUUID().replaceAll("-","")}`;
const isolated = new URL(source); isolated.pathname = `/${name}`;
const admin = new Client({connectionString:source.toString()});
const now = new Date("2028-06-10T10:00:00Z");
let pool: Pool;
let service: typeof import("../../src/lib/reminders");
let worker: typeof import("../../src/lib/reminder-worker");

beforeAll(async()=>{
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  pool=new Pool({connectionString:isolated.toString()});
  await migrate(drizzle(pool),{migrationsFolder:"drizzle"});
  process.env.DATABASE_URL=isolated.toString();
  process.env.REMINDER_TRANSPORT_ENABLED="true";
  service=await import("../../src/lib/reminders");
  worker=await import("../../src/lib/reminder-worker");
});
afterEach(async()=>{ await pool.query(`TRUNCATE warranty_reminder,purchase,reminder_preference,"user" CASCADE`); });
afterAll(async()=>{
  if (service) await (await import("../../src/lib/db")).pool.end();
  if (pool) await pool.end();
  if (admin) { await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); await admin.end(); }
});

async function purchase(endDate="2028-07-10") {
  const owner=`test-${randomUUID()}`;
  const id=randomUUID();
  await pool.query(`INSERT INTO "user"(id,name,email,email_verified) VALUES($1,'Bandymas',$2,true)`,[owner,`${owner}@example.test`]);
  await pool.query(`INSERT INTO reminder_preference(user_id,enabled,default_offset) VALUES($1,true,30)`,[owner]);
  await pool.query(`INSERT INTO purchase(id,owner_id,submission_key,product_name,seller,purchase_date,warranty_state,warranty_end_date,warranty_source)
    VALUES($1,$2,$3,'Bandoma prekė','Parduotuvė','2028-06-01','known',$4,'date')`,[id,owner,randomUUID(),endDate]);
  const client=await pool.connect();
  try { await client.query("BEGIN"); await service.reconcilePurchase(client,owner,id,now); await client.query("COMMIT"); }
  catch(error){await client.query("ROLLBACK");throw error;}
  finally{client.release();}
  return {owner,id};
}
async function row(id:string) {
  return (await pool.query<{status:string;attempts:number;claim_token:string|null;dispatch_authorized_at:Date|null}>(
    "SELECT status,attempts,claim_token,dispatch_authorized_at FROM warranty_reminder WHERE purchase_id=$1 ORDER BY created_at DESC LIMIT 1",[id])).rows[0];
}
async function reconcile(owner:string,id:string) {
  const client=await pool.connect();
  try { await client.query("BEGIN"); await service.reconcilePurchase(client,owner,id,now); await client.query("COMMIT"); }
  catch(error){await client.query("ROLLBACK");throw error;}
  finally{client.release();}
}

describe("durable reminder worker",()=>{
  it("changes the account default for inherited purchases only",async()=>{
    const inherited=await purchase();
    const customId=randomUUID();
    await pool.query(`INSERT INTO purchase(id,owner_id,submission_key,product_name,seller,purchase_date,warranty_state,warranty_end_date,warranty_source,
      reminder_mode,reminder_offset) VALUES($1,$2,$3,'Kitas pirkinys','Parduotuvė','2028-06-01','known','2028-07-10','date','custom',7)`,
      [customId,inherited.owner,randomUUID()]);
    await reconcile(inherited.owner,customId);
    expect((await service.saveReminderSettings(inherited.owner,true,90,1))).toBe("saved");
    const before=(await pool.query("SELECT offset_days,status FROM warranty_reminder WHERE purchase_id=$1",[customId])).rows;
    expect(before).toMatchObject([{offset_days:7,status:"pending"}]);
    expect(await service.reconcileDirtyPurchases(10,now)).toBe(2);
    const rows=(await pool.query("SELECT offset_days,status FROM warranty_reminder WHERE purchase_id=$1 ORDER BY offset_days",[inherited.id])).rows;
    expect(rows).toMatchObject([{offset_days:30,status:"cancelled"},{offset_days:90,status:"pending"}]);
    const after=(await pool.query("SELECT offset_days,status FROM warranty_reminder WHERE purchase_id=$1",[customId])).rows;
    expect(after).toMatchObject([{offset_days:7,status:"pending"}]);
  });
  it("serializes simultaneous saves of the same settings revision",async()=>{
    const item=await purchase();
    const results=await Promise.all([
      service.saveReminderSettings(item.owner,true,90,1),
      service.saveReminderSettings(item.owner,false,7,1),
    ]);
    expect(results.sort()).toEqual(["conflict","saved"]);
    const revision=(await pool.query("SELECT revision FROM reminder_preference WHERE user_id=$1",[item.owner])).rows[0].revision;
    expect(revision).toBe(2);
  });
  it("reconciles inheritance, stable accepted identities, and owner-scoped revisions",async()=>{
    const item=await purchase();
    expect((await service.saveReminderSettings(item.owner,true,90,1))).toBe("saved");
    expect((await service.saveReminderSettings(item.owner,true,7,1))).toBe("conflict");
    expect((await service.savePurchaseReminder("forged-owner",item.id,"off",null,1))).toBe("missing");
    expect((await service.savePurchaseReminder(item.owner,item.id,"custom",60 as never,1))).toBe("invalid");
    const current=(await pool.query<{revision:number}>("SELECT revision FROM purchase WHERE id=$1",[item.id])).rows[0].revision;
    expect((await service.savePurchaseReminder(item.owner,item.id,"custom",7,current))).toBe("saved");
    const rows=await pool.query<{offset_days:number;status:string}>("SELECT offset_days,status FROM warranty_reminder WHERE purchase_id=$1 ORDER BY offset_days",[item.id]);
    expect(rows.rows).toMatchObject([{offset_days:7,status:"pending"},{offset_days:30,status:"cancelled"}]);
    const customDue=new Date("2028-07-03T10:00:00Z");
    expect((await worker.runReminderWorker({now:customDue,send:async()=>"<accepted@test>"})).accepted).toBe(1);
    const revision=(await pool.query<{revision:number}>("SELECT revision FROM purchase WHERE id=$1",[item.id])).rows[0].revision;
    expect((await service.savePurchaseReminder(item.owner,item.id,"off",null,revision))).toBe("saved");
    expect((await service.savePurchaseReminder(item.owner,item.id,"custom",7,revision+1))).toBe("saved");
    expect((await service.savePurchaseReminder(item.owner,item.id,"custom",30,revision+2))).toBe("saved");
    expect((await service.savePurchaseReminder(item.owner,item.id,"custom",7,revision+3))).toBe("saved");
    expect((await worker.runReminderWorker({now:customDue,send:async()=>{throw new Error("duplicate");}})).claimed).toBe(0);
    await pool.query("UPDATE purchase SET warranty_end_date='2028-07-11' WHERE id=$1",[item.id]);
    await reconcile(item.owner,item.id);
    await pool.query("UPDATE purchase SET warranty_end_date='2028-07-10' WHERE id=$1",[item.id]);
    await reconcile(item.owner,item.id);
    expect((await worker.runReminderWorker({now:customDue,send:async()=>{throw new Error("duplicate");}})).claimed).toBe(0);
    const accepted=(await pool.query("SELECT count(*)::int AS n FROM warranty_reminder WHERE purchase_id=$1 AND status='accepted'",[item.id])).rows[0].n;
    expect(accepted).toBe(1);
  });
  it("cancels omitted or cleared warranty schedules and rebuilds after verified-recipient changes",async()=>{
    const item=await purchase();
    const original=(await pool.query<{identity:string}>("SELECT identity FROM warranty_reminder WHERE purchase_id=$1",[item.id])).rows[0].identity;
    await pool.query("UPDATE purchase SET notes='Nesusijęs pakeitimas',revision=revision+1 WHERE id=$1",[item.id]);
    const client=await pool.connect();
    try {await client.query("BEGIN");await service.reconcilePurchase(client,item.owner,item.id,now);await client.query("COMMIT");}
    finally{client.release();}
    expect((await pool.query("SELECT identity FROM warranty_reminder WHERE purchase_id=$1",[item.id])).rows[0].identity).toBe(original);
    await pool.query("UPDATE purchase SET warranty_state='unknown',warranty_end_date=NULL,warranty_source=NULL WHERE id=$1",[item.id]);
    const next=await pool.connect();
    try {await next.query("BEGIN");await service.reconcilePurchase(next,item.owner,item.id,now);await next.query("COMMIT");}
    finally{next.release();}
    expect(await row(item.id)).toMatchObject({status:"cancelled",attempts:0});
    await pool.query("UPDATE purchase SET warranty_state='known',warranty_end_date='2028-07-10',warranty_source='date' WHERE id=$1",[item.id]);
    await pool.query(`UPDATE "user" SET email='changed@example.test',email_verified=false WHERE id=$1`,[item.owner]);
    expect((await pool.query("SELECT reminder_recipient_version FROM \"user\" WHERE id=$1",[item.owner])).rows[0].reminder_recipient_version).toBe(2);
    await pool.query("UPDATE \"user\" SET email_verified=true WHERE id=$1",[item.owner]);
    expect((await pool.query("SELECT reminder_recipient_version FROM \"user\" WHERE id=$1",[item.owner])).rows[0].reminder_recipient_version).toBe(3);
    expect(await service.reconcileDirtyPurchases(10,now)).toBe(1);
    const identities=(await pool.query("SELECT identity,status,recipient_version FROM warranty_reminder WHERE purchase_id=$1",[item.id])).rows;
    expect(identities).toHaveLength(2);
    expect(identities.find((entry)=>entry.identity===original)).toMatchObject({status:"cancelled",recipient_version:1});
    expect(identities.find((entry)=>entry.identity!==original)).toMatchObject({status:"pending",recipient_version:3});
  });
  it("repairs larger accounts in bounded chunks and defers outside the send window",async()=>{
    const item=await purchase();
    await pool.query("UPDATE reminder_preference SET enabled=false,revision=revision+1 WHERE user_id=$1",[item.owner]);
    for(let index=0;index<54;index++) {
      await pool.query(`INSERT INTO purchase(owner_id,submission_key,product_name,seller,purchase_date,warranty_state,warranty_end_date,warranty_source)
        VALUES($1,$2,$3,'Parduotuvė','2028-06-01','known','2028-07-10','date')`,[item.owner,randomUUID(),`Prekė ${index}`]);
    }
    await pool.query("UPDATE reminder_preference SET enabled=true,revision=revision+1 WHERE user_id=$1",[item.owner]);
    expect(await service.reconcileDirtyPurchases(20,now)).toBe(20);
    expect(await service.reconcileDirtyPurchases(20,now)).toBe(20);
    expect(await service.reconcileDirtyPurchases(20,now)).toBe(15);
    const due=(await pool.query("SELECT count(*)::int AS n FROM warranty_reminder WHERE owner_id=$1 AND status='pending'",[item.owner])).rows[0].n;
    expect(due).toBe(55);
    expect((await worker.runReminderWorker({now:new Date("2028-06-10T04:00:00Z"),send:async()=>{throw new Error("too early");}})).claimed).toBe(0);
  });
  it("fails missing transport configuration without sending",async()=>{
    const item=await purchase();
    process.env.REMINDER_TRANSPORT_ENABLED="false";
    try {
      expect((await worker.runReminderWorker({now,send:async()=>{throw new Error("send should not run");}})).failed).toBe(1);
      expect(await row(item.id)).toMatchObject({status:"failed",attempts:0});
    } finally { process.env.REMINDER_TRANSPORT_ENABLED="true"; }
  });
  it("claims once across overlapping workers and a bounded batch",async()=>{
    const one=await purchase();
    const two=await purchase();
    const three=await purchase();
    let sends=0;
    const send=async()=>{ sends++; await new Promise((resolve)=>setTimeout(resolve,20)); return "<accepted@test>"; };
    const results=await Promise.all([worker.runReminderWorker({now,send,batchSize:1}),worker.runReminderWorker({now,send,batchSize:1})]);
    expect(results.reduce((sum,result)=>sum+result.accepted,0)).toBe(2);
    expect(sends).toBe(2);
    expect((await worker.runReminderWorker({now,send,batchSize:1})).accepted).toBe(1);
    expect(sends).toBe(3);
    expect((await worker.runReminderWorker({now,send})).accepted).toBe(0);
    for(const item of [one,two,three]) expect(await row(item.id)).toMatchObject({status:"accepted",attempts:1});
  });
  it("retries a definite temporary rejection with the persisted attempt budget",async()=>{
    const item=await purchase();
    let sends=0;
    const send=async()=>{ sends++; if(sends===1) throw Object.assign(new Error("temporary"),{responseCode:451}); return "<accepted@test>"; };
    expect((await worker.runReminderWorker({now,send})).retried).toBe(1);
    expect(await row(item.id)).toMatchObject({status:"pending",attempts:1});
    expect((await worker.runReminderWorker({now:new Date(now.getTime()+14*60_000),send})).claimed).toBe(0);
    expect((await worker.runReminderWorker({now:new Date(now.getTime()+15*60_000),send})).accepted).toBe(1);
    expect(await row(item.id)).toMatchObject({status:"accepted",attempts:2});
  });
  it("stops at five attempts and after expiry",async()=>{
    const item=await purchase();
    const send=async()=>{ throw Object.assign(new Error("temporary"),{responseCode:451}); };
    for(let attempt=0;attempt<5;attempt++) {
      const date=attempt===0 ? now : new Date(now.getTime()+[0,15,75,435,1875][attempt]*60_000);
      await worker.runReminderWorker({now:date,send});
    }
    expect(await row(item.id)).toMatchObject({status:"failed",attempts:5});
    const expiring=await purchase("2028-06-10");
    expect((await worker.runReminderWorker({now,send})).retried).toBe(1);
    await worker.runReminderWorker({now:new Date("2028-06-11T10:00:00Z"),send});
    expect(await row(expiring.id)).toMatchObject({status:"cancelled",attempts:1});
  });
  it("keeps permanent rejection and ambiguous timeout terminal",async()=>{
    const permanent=await purchase();
    expect((await worker.runReminderWorker({now,send:async()=>{throw Object.assign(new Error("rejected"),{responseCode:550});}})).failed).toBe(1);
    expect(await row(permanent.id)).toMatchObject({status:"failed",attempts:1});
    const ambiguous=await purchase();
    let attempts=0;
    const send=async()=>{attempts++;throw new Error("timeout after DATA");};
    expect((await worker.runReminderWorker({now,send})).uncertain).toBe(1);
    await worker.runReminderWorker({now:new Date(now.getTime()+3600_000),send});
    expect(attempts).toBe(1);
    expect(await row(ambiguous.id)).toMatchObject({status:"uncertain",attempts:1});
  });
  it("recovers a lease before dispatch and quarantines a lost acknowledgement",async()=>{
    const before=await purchase();
    await pool.query(`UPDATE warranty_reminder SET status='processing',claim_token=$2,lease_until=$3 WHERE purchase_id=$1`,
      [before.id,randomUUID(),new Date(now.getTime()-60_000)]);
    expect((await worker.runReminderWorker({now,send:async()=>"<accepted@test>"})).accepted).toBe(1);
    const after=await purchase();
    await pool.query(`UPDATE warranty_reminder SET status='processing',claim_token=$2,lease_until=$3,dispatch_authorized_at=$3,attempts=1 WHERE purchase_id=$1`,
      [after.id,randomUUID(),new Date(now.getTime()-60_000)]);
    expect((await worker.runReminderWorker({now,send:async()=>{throw new Error("should not send");}})).accepted).toBe(0);
    expect(await row(after.id)).toMatchObject({status:"uncertain",attempts:1});
  });
  it("suppresses cancellation before authorization but records a send authorized first",async()=>{
    const early=await purchase();
    let sends=0;
    await worker.runReminderWorker({now,send:async()=>{sends++;return "<accepted@test>";},beforeAuthorize:async()=>{
      await pool.query("UPDATE reminder_preference SET enabled=false,revision=revision+1 WHERE user_id=$1",[early.owner]);
    }});
    expect(sends).toBe(0);
    expect(await row(early.id)).toMatchObject({status:"cancelled",attempts:0});
    const late=await purchase();
    expect((await worker.runReminderWorker({now,send:async()=>{sends++;return "<accepted@test>";},beforeSend:async()=>{
      await pool.query("UPDATE reminder_preference SET enabled=false,revision=revision+1 WHERE user_id=$1",[late.owner]);
    }})).accepted).toBe(1);
    expect(sends).toBe(1);
    expect(await row(late.id)).toMatchObject({status:"accepted",attempts:1});
  });
  it("does not finalize with a lost claim token after apparent acceptance",async()=>{
    const item=await purchase();
    let sends=0;
    await worker.runReminderWorker({now,send:async()=>{
      sends++;
      await pool.query("UPDATE warranty_reminder SET status='uncertain',claim_token=NULL,lease_until=NULL,error_class='acknowledgement_lost' WHERE purchase_id=$1",[item.id]);
      return "<accepted@test>";
    }});
    expect(await row(item.id)).toMatchObject({status:"uncertain",attempts:1});
    await worker.runReminderWorker({now,send:async()=>{sends++;return "<duplicate@test>";}});
    expect(sends).toBe(1);
  });
});
