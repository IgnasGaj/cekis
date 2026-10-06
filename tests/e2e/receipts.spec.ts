import { expect, test, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { Client } from "pg";
import { S3Client, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

type Mail = { ID: string; To: { Address: string }[] };
async function signIn(page: Page, email: string) {
  await page.goto("/prisijungti");
  await page.getByLabel("El. pašto adresas").fill(email);
  await page.getByRole("button", { name: "Siųsti prisijungimo nuorodą" }).click();
  await expect(page.getByRole("heading", { name: "Patikrink el. paštą" })).toBeVisible();
  let id = "";
  for (let i = 0; i < 40; i++) {
    const response = await fetch("http://localhost:1080/api/v1/messages");
    const { messages } = await response.json() as { messages: Mail[] };
    id = messages.find((message) => message.To.some((recipient) => recipient.Address === email))?.ID ?? "";
    if (id) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!id) throw new Error("Test inbox did not receive message");
  const detail = await fetch(`http://localhost:1080/api/v1/message/${id}`);
  const link = (await detail.json() as { Text: string }).Text.match(/https?:\/\/[^\s]+/)?.[0];
  if (!link) throw new Error("Sign-in link missing");
  await page.goto(link);
  await expect(page).toHaveURL(/\/pradzia/);
}
async function createPurchase(page: Page, name: string) {
  await page.goto("/pirkiniai/naujas");
  await page.getByLabel("Prekės pavadinimas").fill(name);
  await page.getByLabel("Pardavėjas").fill("Bandymų pardavėjas");
  await page.getByLabel("Pirkimo data").fill("2024-01-01");
  await page.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(page).toHaveURL(/\/pirkiniai\/[0-9a-f-]+/);
  return new URL(page.url()).pathname.split("/").pop()!;
}
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function db<T>(work: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try { return await work(client); } finally { await client.end(); }
}

test("originalai, bendri ryšiai, atskirtis ir saugus ištrynimas", async ({ browser }) => {
  test.setTimeout(120000);
  const suffix = randomUUID(); const a = await browser.newContext(); const b = await browser.newContext();
  const pageA = await a.newPage(); const pageB = await b.newPage();
  await signIn(pageA, `receipt-a-${suffix}@example.test`);
  const first = await createPurchase(pageA, "Pirmas pirkinys");
  const second = await createPurchase(pageA, "Antras pirkinys");
  await pageA.goto(`/pirkiniai/${first}`);
  const png = await sharp({ create: { width: 12, height: 12, channels: 3, background: "white" } }).png().toBuffer();
  const jpeg = await sharp({ create: { width: 12, height: 12, channels: 3, background: "teal" } }).jpeg().toBuffer();
  const pdfDoc = await PDFDocument.create(); pdfDoc.addPage([200, 200]); const pdf = Buffer.from(await pdfDoc.save());
  let uploaded = 0;
  for (const [name, mime, bytes] of [["pirmas.png", "image/png", png], ["antras.jpg", "image/jpeg", jpeg], ["trecias.pdf", "application/pdf", pdf]] as const) {
    const [chooser] = await Promise.all([pageA.waitForEvent("filechooser"), pageA.getByRole("button", { name: name.endsWith(".pdf") ? /Įkelti PDF Pasirinkti/ : /Įkelti nuotrauką Pasirinkti/ }).click()]);
    await chooser.setFiles({ name, mimeType: mime, buffer: bytes });
    await pageA.getByRole("button", { name: "Įkelti čekį" }).click();
    uploaded++;
    await expect(pageA.getByRole("link", { name: "Atsisiųsti originalą" })).toHaveCount(uploaded);
    await expect(pageA.getByText(name).first()).toBeVisible();
  }
  const rows = await db(async (client) => (await client.query("SELECT id,object_key,filename,sha256 FROM receipt WHERE target_purchase_id=$1 AND state='ready' ORDER BY created_at", [first])).rows);
  expect(rows).toHaveLength(3);
  for (const row of rows) {
    const expected = row.filename.endsWith("png") ? png : row.filename.endsWith("jpg") ? jpeg : pdf;
    const response = await pageA.request.get(`/api/receipts/${row.id}/content?download=1`);
    expect(response.status()).toBe(200); expect(sha(await response.body())).toBe(sha(expected)); expect(row.sha256).toBe(sha(expected));
  }
  const shared = rows[0];
  await pageA.goto(`/pirkiniai/${second}`);
  await pageA.getByLabel("Ieškoti turimo čekio pagal failo pavadinimą").fill("pirmas");
  await pageA.getByRole("button", { name: "Ieškoti čekių" }).click();
  await expect(pageA.locator("#existing-receipt option")).toHaveCount(2);
  await pageA.getByLabel("Pridėti turimą čekį").selectOption(shared.id);
  await pageA.getByRole("button", { name: "Pridėti turimą čekį" }).click();
  await expect(pageA.getByText(shared.filename).first()).toBeVisible();
  expect((await pageA.request.post(`/api/receipts/${shared.id}/links`, { headers: { Origin: process.env.APP_URL! }, data: { purchaseId: second } })).status()).toBe(200);
  await db(async (client) => expect((await client.query("SELECT count(*)::int AS n FROM purchase_receipt WHERE receipt_id=$1 AND purchase_id=$2", [shared.id,second])).rows[0].n).toBe(1));
  const emailB = `receipt-b-${suffix}@example.test`;
  await signIn(pageB, emailB);
  const foreign = await createPurchase(pageB, "Kito savininko pirkinys");
  expect((await pageB.request.get(`/api/receipts/${shared.id}/content`)).status()).toBe(404);
  const foreignLink = await pageB.request.post(`/api/receipts/${shared.id}/links`, { headers: { Origin: process.env.APP_URL! }, data: { purchaseId: foreign } });
  expect(foreignLink.status()).toBe(404);
  expect((await pageB.request.delete(`/api/receipts/${shared.id}/links`, { headers: { Origin: process.env.APP_URL! }, data: { purchaseId: foreign } })).status()).toBe(404);
  expect((await pageB.request.delete(`/api/receipts/${shared.id}`, { headers: { Origin: process.env.APP_URL! } })).status()).toBe(404);
  const foreignList = await pageB.request.get(`/api/receipts/list?purchaseId=${foreign}&q=pirmas`);
  expect((await foreignList.json()).receipts).toEqual([]);
  const anonymous = await browser.newContext();
  expect((await anonymous.request.get(`/api/receipts/${shared.id}/content`)).status()).toBe(401);
  await anonymous.close();
  await db(async (client) => {
    const owner = await client.query("SELECT owner_id FROM purchase WHERE id=$1", [foreign]);
    await expect(client.query("INSERT INTO purchase_receipt (owner_id,purchase_id,receipt_id) VALUES ($1,$2,$3)", [owner.rows[0].owner_id, foreign, shared.id])).rejects.toMatchObject({ code: "23503" });
  });
  await pageA.goto(`/pirkiniai/${first}`);
  await pageA.locator(".receipt-item").filter({ hasText: shared.filename }).getByRole("button", { name: "Ištrinti čekį visur" }).click();
  await expect(pageA.getByText("Čekis bus pašalintas iš 2 pirkinių")).toBeVisible();
  await pageA.getByRole("button", { name: "Atšaukti" }).click();
  await pageA.getByRole("button", { name: "Ištrinti pirkinį" }).click();
  await pageA.getByRole("button", { name: "Ištrinti", exact: true }).click();
  await pageA.goto(`/pirkiniai/${second}`);
  await expect(pageA.getByText(shared.filename).first()).toBeVisible();
  expect((await pageA.request.get(`/api/receipts/${shared.id}/content`)).status()).toBe(200);
  const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! } });
  expect((await s3.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: shared.object_key }))).ContentLength).toBe(png.length);
  await pageA.goto("/nustatymai");
  await pageA.getByRole("button", { name: "Atsijungti" }).click();
  await expect(pageA).toHaveURL(/\/prisijungti/);
  await signIn(pageA, emailB);
  await pageA.goto(`/pirkiniai/${second}`);
  await expect(pageA.getByRole("heading", { name: "Pirkinys nerastas" })).toBeVisible();
  expect((await pageA.request.get(`/api/receipts/${shared.id}/content`)).status()).toBe(404);
  await pageA.goBack();
  await expect(pageA.getByText(shared.filename)).toHaveCount(0);
  await a.close(); await b.close();
});

test("pakartojimas, atšaukimas, validacija ir valymas", async ({ page }) => {
  test.setTimeout(90000);
  await signIn(page, `receipt-retry-${randomUUID()}@example.test`);
  const purchaseId = await createPurchase(page, "Pakartojamas čekis");
  const secondPurchaseId = await createPurchase(page, "Lygiagretus susiejimas");
  const png = await sharp({ create: { width: 6, height: 6, channels: 3, background: "white" } }).png().toBuffer();
  const other = await sharp({ create: { width: 6, height: 6, channels: 3, background: "black" } }).png().toBuffer();
  const key = randomUUID();
  const upload = (bytes: Buffer, submissionKey = key, type = "image/png", name = "bandymas.png") => page.request.post("/api/receipts", {
    headers: { Origin: process.env.APP_URL!, "Content-Type": type, "X-File-Name": encodeURIComponent(name), "X-Purchase-Id": purchaseId, "X-Submission-Key": submissionKey }, data: bytes,
  });
  const ownerId = await db(async (client) => (await client.query("SELECT owner_id FROM purchase WHERE id=$1", [purchaseId])).rows[0].owner_id as string);
  const blocker = new Client({ connectionString: process.env.DATABASE_URL }); await blocker.connect();
  const [{ pid }] = (await blocker.query("SELECT pg_advisory_lock(hashtextextended($1,90817)),pg_backend_pid() AS pid", [ownerId])).rows;
  let responses;
  try {
    const first = upload(png); const second = upload(png);
    await expect.poll(async () => (await blocker.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [pid])).rows[0].n, { timeout: 10000 }).toBeGreaterThanOrEqual(2);
    await blocker.query("SELECT pg_advisory_unlock(hashtextextended($1,90817))", [ownerId]);
    responses = await Promise.all([first, second]);
  } finally {
    await blocker.query("SELECT pg_advisory_unlock(hashtextextended($1,90817))", [ownerId]).catch(() => {});
    await blocker.end();
  }
  expect(responses.map((response) => response.status())).toEqual([200,200]);
  const id = (await responses[0].json()).id as string;
  expect((await responses[1].json()).id).toBe(id);
  expect((await upload(other)).status()).toBe(409);
  const cancelledKey = randomUUID();
  const cancelBlocker = new Client({ connectionString: process.env.DATABASE_URL }); await cancelBlocker.connect();
  const [{ pid: cancelBlockerPid }] = (await cancelBlocker.query("SELECT pg_advisory_lock(hashtextextended($1,90817)),pg_backend_pid() AS pid", [ownerId])).rows;
  let cancelledUpload;
  try {
    const pending = upload(png,cancelledKey);
    await expect.poll(async () => (await cancelBlocker.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [cancelBlockerPid])).rows[0].n, { timeout: 10000 }).toBeGreaterThanOrEqual(1);
    const cancel = await page.request.post("/api/receipts/cancel", { headers: { Origin: process.env.APP_URL! }, data: { key: cancelledKey } });
    expect(cancel.status()).toBe(200);
    await cancelBlocker.query("SELECT pg_advisory_unlock(hashtextextended($1,90817))", [ownerId]);
    cancelledUpload = await pending;
  } finally { await cancelBlocker.query("SELECT pg_advisory_unlock(hashtextextended($1,90817))", [ownerId]).catch(() => {}); await cancelBlocker.end(); }
  expect(cancelledUpload.status()).toBe(409);
  expect((await upload(png,cancelledKey)).status()).toBe(409);
  expect((await upload(Buffer.alloc(0),randomUUID())).status()).toBe(400);
  expect((await upload(Buffer.alloc(10485761),randomUUID())).status()).toBe(400);
  expect((await upload(png,randomUUID(),"application/pdf")).status()).toBe(400);
  expect((await upload(png.subarray(0,20),randomUUID())).status()).toBe(400);
  expect((await upload(png,randomUUID(),"image/png","../../evil.pdf")).status()).toBe(400);
  const row = await db(async (client) => {
    const result = await client.query("SELECT id,object_key FROM receipt WHERE id=$1", [id]);
    expect((await client.query("SELECT count(*)::int AS n FROM receipt WHERE submission_key=$1", [key])).rows[0].n).toBe(1);
    expect((await client.query("SELECT count(*)::int AS n FROM purchase_receipt WHERE receipt_id=$1", [id])).rows[0].n).toBe(1);
    return result.rows[0];
  });
  const receiptBlocker = new Client({ connectionString: process.env.DATABASE_URL }); await receiptBlocker.connect();
  await receiptBlocker.query("BEGIN");
  const [{ pid: receiptBlockerPid }] = (await receiptBlocker.query("SELECT pg_backend_pid() AS pid FROM receipt WHERE id=$1 FOR UPDATE", [id])).rows;
  let linkedStatus: number; let deletedStatus: number;
  try {
    const attach = page.request.post(`/api/receipts/${id}/links`, { headers: { Origin: process.env.APP_URL! }, data: { purchaseId: secondPurchaseId } });
    const remove = page.request.delete(`/api/receipts/${id}`, { headers: { Origin: process.env.APP_URL! } });
    await expect.poll(async () => (await receiptBlocker.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [receiptBlockerPid])).rows[0].n, { timeout: 10000 }).toBeGreaterThanOrEqual(1);
    await receiptBlocker.query("COMMIT");
    [linkedStatus, deletedStatus] = (await Promise.all([attach, remove])).map((response) => response.status());
  } finally { await receiptBlocker.query("ROLLBACK").catch(() => {}); await receiptBlocker.end(); }
  expect([200, 404]).toContain(linkedStatus);
  expect(deletedStatus).toBe(200);
  await db(async (client) => {
    expect((await client.query("SELECT state FROM receipt WHERE id=$1", [id])).rows[0].state).toBe("deleting");
    expect((await client.query("SELECT count(*)::int AS n FROM purchase_receipt WHERE receipt_id=$1", [id])).rows[0].n).toBe(0);
  });
  expect((await page.request.get(`/api/receipts/${id}/content`)).status()).toBe(404);
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, ["scripts/cleanup-receipts.mjs"], { cwd: process.cwd(), env: { ...process.env, S3_ENDPOINT: "http://127.0.0.1:9" } });
  await db(async (client) => {
    const state = await client.query("SELECT state,cleanup_attempts FROM receipt WHERE id=$1", [id]);
    expect(state.rows[0]).toMatchObject({ state: "deleting", cleanup_attempts: 1 });
    await client.query("UPDATE receipt SET expires_at=now() WHERE id=$1", [id]);
  });
  execFileSync(process.execPath, ["scripts/cleanup-receipts.mjs"], { cwd: process.cwd(), env: process.env });
  await db(async (client) => expect((await client.query("SELECT state FROM receipt WHERE id=$1", [id])).rows[0].state).toBe("deleted"));
  const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! } });
  await expect(s3.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: row.object_key }))).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
});

test("naujas pirkinys su čekiu iš pliuso ekrano", async ({ page }) => {
  test.setTimeout(90000);
  await signIn(page, `receipt-new-${randomUUID()}@example.test`);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/prideti");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /Įkelti nuotrauką Pasirinkti/ }).click()]);
  await chooser.setFiles({ name: "naujas.png", mimeType: "image/png", buffer: png });
  await page.getByLabel("Prekės pavadinimas").fill("Naujas su čekiu");
  await page.getByLabel("Pardavėjas").fill("Parduotuvė");
  await page.getByLabel("Pirkimo data").fill("2024-03-01");
  await page.getByRole("button", { name: "Išsaugoti pirkinį ir čekį" }).click();
  await expect(page).toHaveURL(/\/pirkiniai\/[0-9a-f-]+\?busena=cekis-pridetas/);
  await expect(page.getByText("naujas.png")).toBeVisible();
  await expect(page.getByRole("link", { name: "Peržiūrėti čekį" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("objektas išlieka, kai galutinis DB įrašas nepavyksta, ir pakartojimas jį užbaigia", async ({ page }) => {
  test.setTimeout(90000);
  const email = `receipt-db-failure-${randomUUID()}@example.test`;
  await signIn(page, email);
  const purchaseId = await createPurchase(page, "DB atkūrimo bandymas");
  const key = randomUUID();
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
  const ownerDb = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL }); await ownerDb.connect();
  const upload = () => page.request.post("/api/receipts", { headers: { Origin: process.env.APP_URL!, "Content-Type": "image/png", "X-File-Name": "atkurti.png", "X-Purchase-Id": purchaseId, "X-Submission-Key": key }, data: png });
  try {
    await ownerDb.query("DROP TRIGGER IF EXISTS receipt_fail_ready_test ON receipt");
    await ownerDb.query(`CREATE OR REPLACE FUNCTION receipt_fail_ready_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.submission_key = '${key}'::uuid AND NEW.state='ready' THEN RAISE EXCEPTION 'test injection'; END IF;
      RETURN NEW; END $$`);
    await ownerDb.query("CREATE TRIGGER receipt_fail_ready_test BEFORE UPDATE ON receipt FOR EACH ROW EXECUTE FUNCTION receipt_fail_ready_test()");
    expect((await upload()).status()).toBe(503);
    const row = await db(async (client) => {
      const result = await client.query("SELECT id,object_key,state FROM receipt WHERE submission_key=$1", [key]);
      expect(result.rows[0].state).toBe("reserved");
      return result.rows[0];
    });
    const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! } });
    expect((await s3.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: row.object_key }))).ContentLength).toBe(png.length);
    await ownerDb.query("DROP TRIGGER receipt_fail_ready_test ON receipt");
    await ownerDb.query("DROP FUNCTION receipt_fail_ready_test()");
    const retry = await upload(); expect(retry.status()).toBe(200); expect((await retry.json()).id).toBe(row.id);
    expect(sha(await (await page.request.get(`/api/receipts/${row.id}/content?download=1`)).body())).toBe(sha(png));
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: row.object_key }));
    expect((await page.request.get(`/api/receipts/${row.id}/content`)).status()).toBe(503);
    await db(async (client) => client.query("UPDATE session SET expires_at=now()-interval '1 second' WHERE user_id=(SELECT id FROM \"user\" WHERE email=$1)", [email]));
    expect((await page.request.get(`/api/receipts/${row.id}/content`)).status()).toBe(401);
    await db(async (client) => {
      await client.query("DELETE FROM purchase_receipt WHERE receipt_id=$1", [row.id]);
      await client.query("UPDATE receipt SET state='deleting',expires_at=now() WHERE id=$1", [row.id]);
    });
    const { execFileSync } = await import("node:child_process");
    execFileSync(process.execPath, ["scripts/cleanup-receipts.mjs"], { cwd: process.cwd(), env: process.env });
  } finally {
    await ownerDb.query("DROP TRIGGER IF EXISTS receipt_fail_ready_test ON receipt").catch(() => {});
    await ownerDb.query("DROP FUNCTION IF EXISTS receipt_fail_ready_test()").catch(() => {});
    await ownerDb.end();
  }
});
