import { expect, test, type Locator, type Page } from "@playwright/test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { Client } from "pg";
import { S3Client, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

type Mail = { ID: string; To: { Address: string }[] };
async function signIn(page: Page, email: string) {
  const ip = randomBytes(2);
  await page.setExtraHTTPHeaders({ "X-Forwarded-For": `198.51.${ip[0]}.${ip[1]}` });
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
async function tabTo(page: Page, control: Locator) {
  for (let step = 0; step < 60; step++) {
    if (await control.evaluate((element) => element === document.activeElement)) {
      expect(await control.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error("Keyboard could not reach the review control");
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
    if (mime !== "application/pdf") await pageA.getByRole("button", { name: "Atšaukti nuskaitymą" }).click();
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
  await expect(pageA.locator(".receipt-item").filter({ hasText: shared.filename })).toBeVisible();
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
  await pageA.getByRole("button", { name: "Atšaukti", exact: true }).click();
  await pageA.getByRole("button", { name: "Ištrinti pirkinį" }).click();
  await pageA.getByRole("button", { name: "Ištrinti", exact: true }).click();
  await pageA.goto(`/pirkiniai/${second}`);
  await expect(pageA.locator(".receipt-item").filter({ hasText: shared.filename })).toBeVisible();
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

test("pavėluotas atšaukimas ir failo keitimas išsaugo bendrą čekį", async ({ browser }) => {
  test.setTimeout(120000);
  const context = await browser.newContext(); const page = await context.newPage();
  await signIn(page, `receipt-late-${randomUUID()}@example.test`);
  const first = await createPurchase(page, "Pradinis pirkinys");
  const second = await createPurchase(page, "Bendras pirkinys");
  const third = await createPurchase(page, "Lygiagretus pirkinys");
  await page.goto(`/pirkiniai/${first}`);
  const png = await sharp({ create: { width: 9, height: 9, channels: 3, background: "white" } }).png().toBuffer();
  let lost = false;
  await page.route("**/api/receipts", async (route) => {
    if (lost) return route.continue();
    lost = true;
    const saved = await route.fetch(); expect(saved.status()).toBe(200);
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Atsakymas nutrūko. Bandyk dar kartą." }) });
  });
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /Įkelti nuotrauką Pasirinkti/ }).click()]);
  await chooser.setFiles({ name: "bendras.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Įkelti čekį" }).click();
  await expect(page.getByText("Atsakymas nutrūko. Bandyk dar kartą.")).toBeVisible();
  const row = await db(async (client) => (await client.query("SELECT id,owner_id,submission_key,object_key FROM receipt WHERE target_purchase_id=$1 AND state='ready'", [first])).rows[0]);
  const other = await context.newPage();
  expect((await other.request.post(`/api/receipts/${row.id}/links`, { headers: { Origin: process.env.APP_URL! }, data: { purchaseId: second } })).status()).toBe(200);
  const [replacement] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /Įkelti nuotrauką Pasirinkti/ }).click()]);
  await replacement.setFiles({ name: "kitas.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("Ankstesnis čekis jau pridėtas ir liko prie pirkinio.")).toBeVisible();
  await page.getByRole("button", { name: "Atšaukti", exact: true }).click();
  const cancel = () => page.request.post("/api/receipts/cancel", { headers: { Origin: process.env.APP_URL! }, data: { key: row.submission_key } });
  expect((await (await cancel()).json()).completed).toBe(true);
  const blocker = new Client({ connectionString: process.env.DATABASE_URL }); await blocker.connect();
  await blocker.query("BEGIN");
  const [{ pid }] = (await blocker.query("SELECT pg_backend_pid() AS pid FROM receipt WHERE id=$1 FOR UPDATE", [row.id])).rows;
  try {
    const attach = other.request.post(`/api/receipts/${row.id}/links`, { headers: { Origin: process.env.APP_URL! }, data: { purchaseId: third } });
    const lateCancel = cancel();
    await expect.poll(async () => (await blocker.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [pid])).rows[0].n, { timeout: 20000 }).toBeGreaterThanOrEqual(1);
    await blocker.query("COMMIT");
    expect((await attach).status()).toBe(200);
    expect((await (await lateCancel).json()).completed).toBe(true);
  } finally { await blocker.query("ROLLBACK").catch(() => {}); await blocker.end(); }
  await db(async (client) => {
    expect((await client.query("SELECT state FROM receipt WHERE id=$1", [row.id])).rows[0].state).toBe("ready");
    expect((await client.query("SELECT count(*)::int AS n FROM purchase_receipt WHERE receipt_id=$1", [row.id])).rows[0].n).toBe(3);
  });
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, ["scripts/cleanup-receipts.mjs"], { cwd: process.cwd(), env: process.env });
  expect(sha(await (await page.request.get(`/api/receipts/${row.id}/content?download=1`)).body())).toBe(sha(png));
  const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! } });
  expect((await s3.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: row.object_key }))).ContentLength).toBe(png.length);
  s3.destroy(); await context.close();
});

test("atšaukimas galutinio įrašymo metu neištrina jau paruošto čekio", async ({ page }) => {
  test.setTimeout(90000);
  await signIn(page, `receipt-final-cancel-${randomUUID()}@example.test`);
  const purchaseId = await createPurchase(page, "Galutinis įrašymas");
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
  const key = randomUUID();
  const barrierKey = `receipt-final-${key}`;
  const blocker = new Client({ connectionString: process.env.DATABASE_URL }); await blocker.connect();
  const ownerDb = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL }); await ownerDb.connect();
  const [{ pid: blockerPid }] = (await blocker.query("SELECT pg_advisory_lock(hashtextextended($1,91732)),pg_backend_pid() AS pid", [barrierKey])).rows;
  try {
    await ownerDb.query("DROP TRIGGER IF EXISTS receipt_pause_ready_test ON receipt");
    await ownerDb.query(`CREATE OR REPLACE FUNCTION receipt_pause_ready_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.submission_key = '${key}'::uuid AND NEW.state='ready' THEN
        PERFORM pg_advisory_lock(hashtextextended('${barrierKey}',91732));
        PERFORM pg_advisory_unlock(hashtextextended('${barrierKey}',91732));
      END IF; RETURN NEW; END $$`);
    await ownerDb.query("CREATE TRIGGER receipt_pause_ready_test BEFORE UPDATE ON receipt FOR EACH ROW EXECUTE FUNCTION receipt_pause_ready_test()");
    const upload = page.request.post("/api/receipts", { headers: { Origin: process.env.APP_URL!, "Content-Type": "image/png", "X-File-Name": "galutinis.png", "X-Purchase-Id": purchaseId, "X-Submission-Key": key }, data: png });
    let uploadPid = 0;
    await expect.poll(async () => {
      const rows = await blocker.query("SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [blockerPid]);
      uploadPid = rows.rows[0]?.pid ?? 0; return uploadPid;
    }, { timeout: 10000 }).toBeGreaterThan(0);
    const cancellation = page.request.post("/api/receipts/cancel", { headers: { Origin: process.env.APP_URL! }, data: { key } });
    await expect.poll(async () => (await blocker.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [uploadPid])).rows[0].n, { timeout: 10000 }).toBeGreaterThanOrEqual(1);
    await blocker.query("SELECT pg_advisory_unlock(hashtextextended($1,91732))", [barrierKey]);
    expect((await upload).status()).toBe(200);
    expect((await (await cancellation).json()).completed).toBe(true);
    const row = await db(async (client) => (await client.query("SELECT id,state FROM receipt WHERE submission_key=$1", [key])).rows[0]);
    expect(row.state).toBe("ready");
    await db(async (client) => expect((await client.query("SELECT count(*)::int AS n FROM purchase_receipt WHERE receipt_id=$1", [row.id])).rows[0].n).toBe(1));
    const { execFileSync } = await import("node:child_process");
    execFileSync(process.execPath, ["scripts/cleanup-receipts.mjs"], { cwd: process.cwd(), env: process.env });
    expect(sha(await (await page.request.get(`/api/receipts/${row.id}/content`)).body())).toBe(sha(png));
  } finally {
    await blocker.query("SELECT pg_advisory_unlock(hashtextextended($1,91732))", [barrierKey]).catch(() => {});
    await blocker.end();
    await ownerDb.query("DROP TRIGGER IF EXISTS receipt_pause_ready_test ON receipt").catch(() => {});
    await ownerDb.query("DROP FUNCTION IF EXISTS receipt_pause_ready_test()").catch(() => {});
    await ownerDb.end();
  }
});

test("pridėjimo formos pakartojimas rodo tik išsaugotus pirkinio duomenis", async ({ page }) => {
  test.setTimeout(90000);
  const email = `receipt-fields-${randomUUID()}@example.test`;
  await signIn(page, email); await page.goto("/prideti");
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /Įkelti nuotrauką Pasirinkti/ }).click()]);
  await chooser.setFiles({ name: "pradinis.png", mimeType: "image/png", buffer: png });
  await page.getByLabel("Prekės pavadinimas").fill("Pradinis produktas");
  await page.getByLabel("Pardavėjas").fill("Pradinis pardavėjas");
  await page.getByLabel("Pirkimo data").fill("2024-03-01");
  let lost = false;
  await page.route("**/api/purchases", async (route) => {
    if (lost) return route.continue();
    lost = true;
    const saved = await route.fetch(); expect(saved.status()).toBe(200);
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Atsakymas nutrūko." }) });
  });
  await page.getByRole("button", { name: "Išsaugoti pirkinį ir čekį" }).click();
  await expect(page.getByText("Atsakymas nutrūko.")).toBeVisible();
  await page.getByRole("button", { name: "Atšaukti", exact: true }).click();
  await expect(page.getByText(/Pirkinio išsaugojimo būsena neaiški/)).toBeVisible();
  const [again] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /Įkelti nuotrauką Pasirinkti/ }).click()]);
  await again.setFiles({ name: "pakeistas.png", mimeType: "image/png", buffer: png });
  await page.getByLabel("Kaina (neprivaloma)").fill("netinkama");
  await page.getByRole("button", { name: "Išsaugoti pirkinį ir čekį" }).click();
  await expect(page.getByText("Įvesk tinkamą kainą")).toBeVisible();
  await page.getByLabel("Prekės pavadinimas").fill("Pakeistas produktas");
  await page.getByLabel("Kaina (neprivaloma)").fill("29.99");
  await page.getByRole("button", { name: "Išsaugoti pirkinį ir čekį" }).click();
  await expect(page.getByText(/Pirkinys jau buvo išsaugotas su kitais duomenimis/)).toBeVisible();
  await expect(page.getByLabel("Prekės pavadinimas")).toHaveValue("Pradinis produktas");
  await expect(page.getByLabel("Prekės pavadinimas")).toBeDisabled();
  await expect(page.getByRole("link", { name: "Redaguoti išsaugotą pirkinį" })).toBeVisible();
  let uploadFailed = false;
  await page.route("**/api/receipts", async (route) => {
    if (uploadFailed) return route.continue();
    uploadFailed = true;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Saugykla laikinai nepasiekiama." }) });
  });
  await page.getByRole("button", { name: "Bandyti dar kartą" }).click();
  await expect(page.getByText(/Saugykla laikinai nepasiekiama/)).toBeVisible();
  await expect(page.getByLabel("Pardavėjas")).toBeDisabled();
  await page.getByRole("button", { name: "Atšaukti", exact: true }).click();
  await expect(page.getByText("Pirkinys išsaugotas be čekio.")).toBeVisible();
  const [replacement] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /Įkelti nuotrauką Pasirinkti/ }).click()]);
  await replacement.setFiles({ name: "naujas.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Bandyti dar kartą" }).click();
  await expect(page).toHaveURL(/\/pirkiniai\/[0-9a-f-]+\?busena=cekis-pridetas/);
  await db(async (client) => {
    const records = await client.query("SELECT p.id,p.product_name,p.seller,p.price,(SELECT count(*)::int FROM purchase_receipt pr WHERE pr.purchase_id=p.id) AS links FROM purchase p JOIN \"user\" u ON u.id=p.owner_id WHERE u.email=$1", [email]);
    expect(records.rows).toHaveLength(1);
    expect(records.rows[0]).toMatchObject({ product_name: "Pradinis produktas", seller: "Pradinis pardavėjas", price: null, links: 1 });
  });
});

test("garantijos valdikliai užrakinami per kūrimą, o atšaukimas nepakeičia naujo bandymo", async ({ page }) => {
  test.setTimeout(90000);
  const email = `receipt-pending-${randomUUID()}@example.test`;
  await signIn(page, email); await page.goto("/prideti");
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
  const choose = async () => {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /Įkelti nuotrauką Pasirinkti/ }).click()]);
    await chooser.setFiles({ name: "garantija.png", mimeType: "image/png", buffer: png });
  };
  await choose();
  await page.getByLabel("Prekės pavadinimas").fill("Laukiantis pirkinys");
  await page.getByLabel("Pardavėjas").fill("Pardavėjas");
  await page.getByLabel("Pirkimo data").fill("2024-01-01");
  await page.getByLabel("Garantijos būsena").selectOption("known");
  await page.getByLabel("Kaip nurodysi pabaigą?").selectOption("duration");
  await page.getByLabel("Trukmė mėnesiais (1–600)").fill("48");
  await page.getByLabel(/Patvirtinu garantijos pabaigos datą/).check();

  let firstRelease!: () => void;
  const firstGate = new Promise<void>((resolve) => { firstRelease = resolve; });
  let secondRelease!: () => void;
  const secondGate = new Promise<void>((resolve) => { secondRelease = resolve; });
  let requests = 0;
  let secondCommitted!: () => void;
  const committed = new Promise<void>((resolve) => { secondCommitted = resolve; });
  await page.route("**/api/purchases", async (route) => {
    requests++;
    if (requests === 1) {
      await firstGate;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Laikina klaida." }) });
    } else if (requests === 2) {
      const saved = await route.fetch(); expect(saved.status()).toBe(200);
      secondCommitted();
      await secondGate;
      await route.fulfill({ response: saved }).catch(() => {});
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Išsaugoti pirkinį ir čekį" }).click();
  await expect(page.getByLabel("Garantijos būsena")).toBeDisabled();
  await expect(page.getByLabel("Kaip nurodysi pabaigą?")).toBeDisabled();
  await expect(page.getByLabel("Trukmė mėnesiais (1–600)")).toBeDisabled();
  await expect(page.getByLabel(/Patvirtinu garantijos pabaigos datą/)).toBeDisabled();
  await page.locator("form.purchase-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
  expect(requests).toBe(1);
  firstRelease();
  await expect(page.getByText("Laikina klaida.")).toBeVisible();
  await expect(page.getByLabel("Garantijos būsena")).toBeEnabled();
  await expect(page.getByLabel("Trukmė mėnesiais (1–600)")).toHaveValue("48");
  await expect(page.getByLabel(/Patvirtinu garantijos pabaigos datą/)).toBeChecked();

  await page.getByLabel("Kaip nurodysi pabaigą?").selectOption("date");
  await page.getByLabel("Garantijos pabaigos data").fill("2029-01-01");
  await page.getByLabel(/Patvirtinu garantijos pabaigos datą/).check();
  await page.getByRole("button", { name: "Išsaugoti pirkinį ir čekį" }).click();
  await committed;
  await expect(page.getByLabel("Garantijos būsena")).toBeDisabled();
  await expect(page.getByLabel("Kaip nurodysi pabaigą?")).toBeDisabled();
  await expect(page.getByLabel("Garantijos pabaigos data")).toBeDisabled();
  await expect(page.getByLabel(/Patvirtinu garantijos pabaigos datą/)).toBeDisabled();
  await page.getByRole("button", { name: "Atšaukti", exact: true }).click();
  await expect(page.getByText(/Pirkinio išsaugojimo būsena neaiški/)).toBeVisible();
  secondRelease();
  await choose();
  await expect(page.getByLabel("Garantijos pabaigos data")).toHaveValue("2029-01-01");
  await expect(page.getByLabel(/Patvirtinu garantijos pabaigos datą/)).toBeChecked();
  await page.getByRole("button", { name: "Išsaugoti pirkinį ir čekį" }).click();
  await expect(page).toHaveURL(/\/pirkiniai\/[0-9a-f-]+\?busena=cekis-pridetas/);
  await db(async (client) => {
    const rows = await client.query("SELECT p.warranty_state,p.warranty_end_date::text,p.warranty_source,(SELECT count(*)::int FROM purchase_receipt WHERE purchase_id=p.id) AS receipts FROM purchase p JOIN \"user\" u ON u.id=p.owner_id WHERE u.email=$1", [email]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ warranty_state: "known", warranty_end_date: "2029-01-01", warranty_source: "date", receipts: 1 });
  });
});

test("pridėjimo formos pavėluotas atšaukimas palieka jau pridėtą čekį", async ({ page }) => {
  test.setTimeout(90000);
  const email = `receipt-add-late-${randomUUID()}@example.test`;
  await signIn(page, email); await page.goto("/prideti");
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /Įkelti nuotrauką Pasirinkti/ }).click()]);
  await chooser.setFiles({ name: "veluojantis.png", mimeType: "image/png", buffer: png });
  await page.getByLabel("Prekės pavadinimas").fill("Pavėluotas atsakymas");
  await page.getByLabel("Pardavėjas").fill("Parduotuvė");
  await page.getByLabel("Pirkimo data").fill("2024-03-01");
  let lost = false;
  await page.route("**/api/receipts", async (route) => {
    if (lost) return route.continue();
    lost = true;
    const saved = await route.fetch(); expect(saved.status()).toBe(200);
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Atsakymas nutrūko." }) });
  });
  await page.getByRole("button", { name: "Išsaugoti pirkinį ir čekį" }).click();
  await expect(page.getByText(/Atsakymas nutrūko/)).toBeVisible();
  await expect(page.getByLabel("Prekės pavadinimas")).toBeDisabled();
  const row = await db(async (client) => (await client.query("SELECT r.id,r.object_key FROM receipt r JOIN \"user\" u ON u.id=r.owner_id WHERE u.email=$1", [email])).rows[0]);
  await page.getByRole("button", { name: "Atšaukti", exact: true }).click();
  await expect(page.getByText("Čekis jau pridėtas ir liko prie pirkinio.")).toBeVisible();
  await db(async (client) => {
    expect((await client.query("SELECT state FROM receipt WHERE id=$1", [row.id])).rows[0].state).toBe("ready");
    expect((await client.query("SELECT count(*)::int AS n FROM purchase_receipt WHERE receipt_id=$1", [row.id])).rows[0].n).toBe(1);
  });
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, ["scripts/cleanup-receipts.mjs"], { cwd: process.cwd(), env: process.env });
  expect(sha(await (await page.request.get(`/api/receipts/${row.id}/content`)).body())).toBe(sha(png));
});

test("netinkami įkėlimai išnaudoja patvarų bandymų limitą", async ({ page }) => {
  test.setTimeout(90000);
  const email = `receipt-limit-${randomUUID()}@example.test`;
  await signIn(page, email);
  const purchaseId = await createPurchase(page, "Įkėlimo riba");
  const ownerId = await db(async (client) => (await client.query("SELECT owner_id FROM purchase WHERE id=$1", [purchaseId])).rows[0].owner_id as string);
  const limit = Number(process.env.RECEIPT_ATTEMPTS_PER_HOUR ?? 60);
  await db(async (client) => client.query("INSERT INTO receipt_upload_limit (owner_id,window_started_at,attempts) VALUES ($1,now(),$2)", [ownerId,limit-1]));
  const invalid = () => page.request.post("/api/receipts", { headers: { Origin: process.env.APP_URL!, "Content-Type": "image/png", "X-File-Name": "blogas.png", "X-Purchase-Id": purchaseId, "X-Submission-Key": randomUUID() }, data: Buffer.from("invalid png") });
  const blocker = new Client({ connectionString: process.env.DATABASE_URL }); await blocker.connect();
  const [{ pid }] = (await blocker.query("SELECT pg_advisory_lock(hashtextextended($1,90817)),pg_backend_pid() AS pid", [ownerId])).rows;
  let responses;
  try {
    const first = invalid(); const second = invalid();
    await expect.poll(async () => (await blocker.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [pid])).rows[0].n, { timeout: 10000 }).toBeGreaterThanOrEqual(2);
    await blocker.query("SELECT pg_advisory_unlock(hashtextextended($1,90817))", [ownerId]);
    responses = await Promise.all([first,second]);
  } finally { await blocker.query("SELECT pg_advisory_unlock(hashtextextended($1,90817))", [ownerId]).catch(() => {}); await blocker.end(); }
  expect(responses.map((response) => response.status()).sort()).toEqual([400,429]);
  expect((await invalid()).status()).toBe(429);
  await db(async (client) => {
    expect((await client.query("SELECT attempts FROM receipt_upload_limit WHERE owner_id=$1", [ownerId])).rows[0].attempts).toBe(limit+1);
    expect((await client.query("SELECT count(*)::int AS n FROM receipt WHERE owner_id=$1", [ownerId])).rows[0].n).toBe(0);
    await client.query("UPDATE receipt_upload_limit SET window_started_at=now()-interval '61 minutes' WHERE owner_id=$1", [ownerId]);
  });
  expect((await invalid()).status()).toBe(400);
  await db(async (client) => expect((await client.query("SELECT attempts FROM receipt_upload_limit WHERE owner_id=$1", [ownerId])).rows[0].attempts).toBe(1));
  const png = await sharp({ create: { width: 6, height: 6, channels: 3, background: "white" } }).png().toBuffer();
  const key = randomUUID();
  const upload = () => page.request.post("/api/receipts", { headers: { Origin: process.env.APP_URL!, "Content-Type": "image/png", "X-File-Name": "geras.png", "X-Purchase-Id": purchaseId, "X-Submission-Key": key }, data: png });
  expect((await upload()).status()).toBe(200);
  expect((await upload()).status()).toBe(200);
  await db(async (client) => expect((await client.query("SELECT attempts FROM receipt_upload_limit WHERE owner_id=$1", [ownerId])).rows[0].attempts).toBe(3));
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

test("OCR peržiūra, atšaukimas, rankinis įrašymas ir savininkų atskirtis", async ({ browser }) => {
  test.setTimeout(240000);
  const suffix = randomUUID();
  const owner = await browser.newContext(); const other = await browser.newContext();
  const page = await owner.newPage(); const foreign = await other.newPage();
  await signIn(page, `ocr-owner-${suffix}@example.test`);
  const purchaseId = await createPurchase(page, "Pradinis pirkinys");
  await page.goto(`/pirkiniai/${purchaseId}`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="950"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" font-size="46" fill="black"><text x="65" y="100">TOPO CENTRAS UAB</text><text x="65" y="190">SONY WH1000XM6 449,00 EUR</text><text x="65" y="290">Is viso 449,00 EUR</text><text x="65" y="390">Data: 2026-10-05</text><text x="65" y="490">Cekio Nr. K12345</text></g></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /Įkelti nuotrauką Pasirinkti/ }).click()]);
  await chooser.setFiles({ name: "sintetinis-cekis.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Atšaukti nuskaitymą" }).click();
  await page.getByRole("button", { name: "Įkelti čekį" }).click();
  await expect(page.getByRole("link", { name: "Nuskaityti ir peržiūrėti" })).toBeVisible();
  const receiptId = await db(async (client) => (await client.query("SELECT id FROM receipt WHERE target_purchase_id=$1 AND state='ready'", [purchaseId])).rows[0].id as string);
  const original = await page.request.get(`/api/receipts/${receiptId}/content`);
  expect(sha(await original.body())).toBe(sha(png));
  await page.getByRole("link", { name: "Nuskaityti ir peržiūrėti" }).click();
  await expect(page.getByRole("heading", { name: "Peržiūrėk duomenis" })).toBeVisible();
  for (const width of [320, 390, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.body.style.zoom = "1.25"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => { document.body.style.zoom = ""; });
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement !== document.body && getComputedStyle(document.activeElement!).outlineStyle !== "none")).toBe(true);
  await page.getByRole("button", { name: "Nuskaityti čekį" }).click();
  await page.getByRole("button", { name: "Atšaukti nuskaitymą" }).click();
  await expect(page.getByText("Nuskaitymas atšauktas. Čekis išsaugotas.")).toBeVisible();
  const contentPath = `**/api/receipts/${receiptId}/content`;
  await page.route(contentPath, (route) => route.fulfill({ status: 503, body: "Neprieinama" }));
  await page.getByRole("button", { name: "Bandyti dar kartą" }).click();
  await expect(page.getByText("Nepavyko nuskaityti čekio.")).toBeVisible();
  await page.unroute(contentPath);
  const start = Date.now();
  await page.getByRole("button", { name: "Bandyti dar kartą" }).click();
  await expect(page.getByText("Nuskaityta. Peržiūrėk pasiūlymus.")).toBeVisible({ timeout: 30000 });
  console.log(`Synthetic Lithuanian-style PNG OCR: ${Date.now() - start} ms including retry startup`);
  await expect(page.getByText("449.00 EUR")).toBeVisible();
  await expect(page.getByLabel("Prekės kaina (neprivaloma)")).toHaveValue("");
  await page.getByLabel("Pardavėjas").fill("");
  await page.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(page.getByText("Įvesk pardavėją")).toBeVisible();
  await page.getByLabel("Prekės pavadinimas").fill("Sony ausinės, patikrinta");
  await page.getByLabel("Pardavėjas").fill("Topo Centras");
  await page.getByLabel("Pirkimo data").fill("2026-10-05");
  await page.getByLabel("Čekio numeris (neprivaloma)").fill("K12345");
  await page.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/pirkiniai/${purchaseId}\\?busena=atnaujinta`));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sony ausinės, patikrinta" })).toBeVisible();
  await page.getByRole("link", { name: "Nuskaityti ir peržiūrėti" }).click();
  await expect(page.getByLabel("Čekio numeris (neprivaloma)")).toHaveValue("K12345");
  expect(sha(await (await page.request.get(`/api/receipts/${receiptId}/content`)).body())).toBe(sha(png));
  const payload = { purchaseId, productName: "Sony ausinės, patikrinta", seller: "Topo Centras", purchaseDate: "2026-10-05", price: "", currency: "", notes: "", receiptNumber: "K12345" };
  const post = () => page.request.post(`/api/receipts/${receiptId}/review`, { headers: { Origin: process.env.APP_URL! }, data: payload });
  expect((await post()).status()).toBe(200);
  expect((await Promise.all([post(), post()])).map((response) => response.status())).toEqual([200, 200]);
  expect((await page.request.post(`/api/receipts/${receiptId}/review`, { headers: { Origin: process.env.APP_URL! }, data: { ...payload, purchaseId: { toString: "broken" } } })).status()).toBe(404);
  await db(async (client) => {
    expect((await client.query("SELECT count(*)::int AS n FROM purchase WHERE id=$1", [purchaseId])).rows[0].n).toBe(1);
    expect((await client.query("SELECT receipt_number FROM receipt WHERE id=$1", [receiptId])).rows[0].receipt_number).toBe("K12345");
  });
  await page.goto(`/pirkiniai/${purchaseId}`);
  const pdfDoc = await PDFDocument.create(); pdfDoc.addPage([240, 300]);
  const pdf = Buffer.from(await pdfDoc.save());
  const [pdfChooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /Įkelti PDF Pasirinkti/ }).click()]);
  await pdfChooser.setFiles({ name: "rankinis.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("button", { name: "Įkelti čekį" }).click();
  const pdfItem = page.locator(".receipt-item").filter({ hasText: "rankinis.pdf" });
  await expect(pdfItem.getByRole("link", { name: "Nuskaityti ir peržiūrėti" })).toBeVisible();
  await pdfItem.getByRole("link", { name: "Nuskaityti ir peržiūrėti" }).click();
  await expect(page.getByText("Šio PDF automatinis nuskaitymas neprieinamas.", { exact: false })).toBeVisible();
  await page.getByLabel("Prekės pavadinimas").fill("Rankiniu būdu patvirtinta prekė");
  await page.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/pirkiniai/${purchaseId}\\?busena=atnaujinta`), { timeout: 15000 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Rankiniu būdu patvirtinta prekė" })).toBeVisible();
  const variants = [
    { name: "keli-produktai", lines: ["PREKYBOS CENTRAS", "Pienas 2,30 EUR", "Duona 1,40 EUR", "Is viso 3,70 EUR", "Data 2026-10-05"] },
    { name: "neryskus", lines: ["PREKYBOS CENTRAS", "Preke 12,30 EUR", "Is viso 12,30 EUR"], blur: true },
    { name: "dviprasme-data", lines: ["PREKYBOS CENTRAS", "Data 2026-10-05", "Data 2026-10-06", "Terminal ID 123456", "Preke 12,30 EUR"] },
    { name: "nepalaikoma-valiuta", lines: ["PREKYBOS CENTRAS", "Preke 12,30 CZK", "Total 12,30 CZK", "Data 2026-10-05"] },
  ];
  let confirmedName = "Rankiniu būdu patvirtinta prekė";
  for (const variant of variants) {
    const body = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="900"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" font-size="46" fill="black">${variant.lines.map((line, index) => `<text x="65" y="${100 + index * 85}">${line}</text>`).join("")}</g></svg>`;
    const image = sharp(Buffer.from(body));
    const bytes = await (variant.blur ? image.blur(2.2) : image).png().toBuffer();
    const uploaded = await page.request.post("/api/receipts", { headers: { Origin: process.env.APP_URL!, "Content-Type": "image/png", "X-File-Name": `${variant.name}.png`, "X-Purchase-Id": purchaseId, "X-Submission-Key": randomUUID() }, data: bytes });
    expect(uploaded.status()).toBe(200);
    const variantId = (await uploaded.json()).id as string;
    await page.goto(`/pirkiniai/${purchaseId}/cekis/${variantId}`);
    const started = Date.now();
    await page.getByRole("button", { name: "Nuskaityti čekį" }).click();
    await expect(page.getByText(/Nuskaityta\. Peržiūrėk pasiūlymus\.|Teksto atpažinti nepavyko\.|Nepavyko nuskaityti čekio\./)).toBeVisible({ timeout: 30000 });
    console.log(`${variant.name} OCR: ${Date.now() - started} ms`);
    await expect(page.getByLabel("Prekės kaina (neprivaloma)")).toHaveValue("");
    await expect(page.getByLabel("Prekės pavadinimas")).toHaveValue(confirmedName);
    if (variant.name === "keli-produktai") {
      const productField = page.locator(".field").filter({ has: page.getByLabel("Prekės pavadinimas") });
      await expect(productField.getByText("Pienas", { exact: true })).toBeVisible();
      await expect(productField.getByText("Duona", { exact: true })).toBeVisible();
      const priceField = page.locator(".field").filter({ has: page.getByLabel("Prekės kaina (neprivaloma)") });
      await expect(priceField.getByText("2.30", { exact: true })).toBeVisible();
      await expect(priceField.getByText("1.40", { exact: true })).toBeVisible();
      confirmedName = "Kelių prekių čekis, pasirinkta rankiniu būdu";
      await page.getByLabel("Prekės pavadinimas").fill(confirmedName);
      await page.getByRole("button", { name: "Išsaugoti", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/pirkiniai/${purchaseId}\\?busena=atnaujinta`));
      await page.reload();
      await expect(page.getByRole("heading", { name: confirmedName })).toBeVisible();
    }
    if (variant.name === "nepalaikoma-valiuta") await expect(page.getByText("Čekio suma").locator("..")).not.toContainText("EUR");
    expect(sha(await (await page.request.get(`/api/receipts/${variantId}/content`)).body())).toBe(sha(bytes));
  }
  await signIn(foreign, `ocr-other-${suffix}@example.test`);
  await foreign.goto(`/pirkiniai/${purchaseId}/cekis/${receiptId}`);
  await expect(foreign.getByRole("heading", { name: "Pirkinys nerastas" })).toBeVisible();
  expect((await foreign.request.get(`/api/receipts/${receiptId}/content`)).status()).toBe(404);
  expect((await foreign.request.post(`/api/receipts/${receiptId}/review`, { headers: { Origin: process.env.APP_URL! }, data: payload })).status()).toBe(404);
  const anonymous = await browser.newContext();
  expect((await anonymous.request.get(`/api/receipts/${receiptId}/content`)).status()).toBe(401);
  expect((await anonymous.request.post(`/api/receipts/${receiptId}/review`, { headers: { Origin: process.env.APP_URL! }, data: payload })).status()).toBe(401);
  await anonymous.close(); await owner.close(); await other.close();
});

test("čekio peržiūrą galima valdyti klaviatūra", async ({ page }) => {
  test.setTimeout(120000);
  await signIn(page, `ocr-keyboard-${randomUUID()}@example.test`);
  const purchaseId = await createPurchase(page, "Klaviatūros bandymas");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" font-size="40" fill="black"><text x="50" y="90">PREKYBOS CENTRAS</text><text x="50" y="170">Preke 19,90 EUR</text><text x="50" y="250">Is viso 19,90 EUR</text></g></svg>`;
  const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
  const upload = await page.request.post("/api/receipts", { headers: { Origin: process.env.APP_URL!, "Content-Type": "image/png", "X-File-Name": "klaviatura.png", "X-Purchase-Id": purchaseId, "X-Submission-Key": randomUUID() }, data: bytes });
  expect(upload.status()).toBe(200);
  const receiptId = (await upload.json()).id as string;
  await page.goto(`/pirkiniai/${purchaseId}`);
  const reviewLink = page.getByRole("link", { name: "Nuskaityti ir peržiūrėti" });
  await tabTo(page, reviewLink);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Peržiūrėk duomenis" })).toBeVisible();
  const contentPath = `**/api/receipts/${receiptId}/content`;
  let releaseScan: (() => void) | undefined;
  await page.route(contentPath, async (route) => {
    if (route.request().resourceType() !== "fetch") return route.continue();
    await new Promise<void>((resolve) => { releaseScan = resolve; });
    await route.continue().catch(() => {});
  });
  await tabTo(page, page.getByRole("button", { name: "Nuskaityti čekį" }));
  await page.keyboard.press("Enter");
  await expect.poll(() => Boolean(releaseScan)).toBe(true);
  await tabTo(page, page.getByRole("button", { name: "Atšaukti nuskaitymą" }));
  await page.keyboard.press("Enter");
  await expect(page.getByText("Nuskaitymas atšauktas. Čekis išsaugotas.")).toBeVisible();
  releaseScan?.();
  await page.unroute(contentPath);
  await tabTo(page, page.getByRole("button", { name: "Bandyti dar kartą" }));
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Nuskaityta\. Peržiūrėk pasiūlymus\.|Teksto atpažinti nepavyko\./)).toBeVisible({ timeout: 30000 });
  await tabTo(page, page.getByRole("link", { name: "Įvesti rankiniu būdu" }));
  await page.keyboard.press("Enter");
  const product = page.getByLabel("Prekės pavadinimas");
  await tabTo(page, product);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Klaviatūra patvirtinta prekė");
  await tabTo(page, page.getByLabel("Pardavėjas"));
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Prekybos centras");
  await tabTo(page, page.getByLabel("Pirkimo data"));
  await tabTo(page, page.getByLabel("Prekės kaina (neprivaloma)"));
  await page.keyboard.type("19,90");
  const currency = page.getByLabel("Prekės kainos valiuta");
  await tabTo(page, currency);
  await page.keyboard.press("e");
  await page.keyboard.press("Tab");
  await expect(currency).toHaveValue("EUR");
  await tabTo(page, page.getByLabel("Čekio numeris (neprivaloma)"));
  await page.keyboard.type("K-KEY-001");
  await tabTo(page, page.getByRole("button", { name: "Išsaugoti", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Klaviatūra patvirtinta prekė" })).toBeVisible();
  await page.goto(`/pirkiniai/${purchaseId}/cekis/${receiptId}`);
  await expect(page.getByLabel("Čekio numeris (neprivaloma)")).toHaveValue("K-KEY-001");
});

test("čekio peržiūra saugo garantiją ir atmeta pasenusį patvirtinimą", async ({ page }) => {
  const email = `warranty-review-${randomUUID()}@example.test`;
  await signIn(page, email);
  const purchaseId = await createPurchase(page, "Garantijos čekis");
  await page.goto(`/pirkiniai/${purchaseId}/redaguoti`);
  await page.getByLabel("Garantijos būsena").selectOption("known");
  await page.getByLabel("Garantijos pabaigos data").fill("2028-01-01");
  await page.getByLabel(/Patvirtinu garantijos pabaigos datą/).check();
  await page.getByRole("button", { name: "Išsaugoti pakeitimus" }).click();
  await expect(page.getByText("Pabaigos data:")).toContainText("2028");
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
  const uploaded = await page.request.post("/api/receipts", { headers: { Origin: process.env.APP_URL!, "Content-Type": "image/png", "X-File-Name": "garantija.png", "X-Purchase-Id": purchaseId, "X-Submission-Key": randomUUID() }, data: png });
  expect(uploaded.status()).toBe(200);
  const receiptId = (await uploaded.json()).id as string;
  await page.goto(`/pirkiniai/${purchaseId}/cekis/${receiptId}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel(/Patvirtinu garantijos pabaigos datą/)).toBeChecked();
  await page.getByLabel("Pirkimo data").fill("2024-02-01");
  await expect(page.getByText("Pirkimo data pasikeitė. Patikrink išsaugotą garantijos datą ir patvirtink ją iš naujo.")).toBeVisible();
  await expect(page.getByLabel(/Patvirtinu garantijos pabaigos datą/)).not.toBeChecked();
  await page.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(page.getByText("Patvirtink pasirinktą garantijos pabaigos datą.")).toBeVisible();
  await page.getByLabel(/Patvirtinu garantijos pabaigos datą/).check();
  await page.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(page.getByText("Pabaigos data:")).toContainText("2028");
  await page.goto(`/pirkiniai/${purchaseId}/cekis/${receiptId}`);
  const stale = await page.context().newPage(); await stale.goto(`/pirkiniai/${purchaseId}/cekis/${receiptId}`);
  await page.getByLabel("Prekės pavadinimas").fill("Naujesnis įrašas");
  await page.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Naujesnis įrašas" })).toBeVisible();
  await stale.getByLabel("Prekės pavadinimas").fill("Pasenęs įrašas");
  await stale.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(stale.getByText(/Pirkinys pasikeitė kitur/)).toBeVisible();
  await expect(stale.getByLabel("Prekės pavadinimas")).toHaveValue("Pasenęs įrašas");
  await db(async (client) => {
    const result = await client.query("SELECT product_name,warranty_state,warranty_end_date::text FROM purchase WHERE id=$1", [purchaseId]);
    expect(result.rows[0]).toMatchObject({ product_name: "Naujesnis įrašas", warranty_state: "known", warranty_end_date: "2028-01-01" });
  });
});

// Anonymous generated photo-style fixture; the owner's real receipt stays out of git.
async function anonymousReceiptPhoto() {
  const lines = ["UAB Bandymų prekyba", "TEST60420 Prietaisas", "bandomasis įrenginys 19,99 A", "Mokėti 19,99", "Apvalinimo suma 0,01", "Mokėti suapvalinus 20,00", "Grynaisiais 20,00", "Kvito Nr. 1/1/12345", "2024-01-30 12:41:21", "Kvito numeris 12345"];
  const image = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1500"><defs><pattern id="texture" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="#70644d"/><path d="M0 8h24M8 0v24" stroke="#ae9974" stroke-width="3"/></pattern></defs><rect width="100%" height="100%" fill="url(#texture)"/><rect x="170" y="100" width="660" height="1290" fill="#eeeeeb"/><g font-family="DejaVu Sans" font-size="28" fill="#333333">${lines.map((line, index) => `<text x="205" y="${200 + index * 92}">${line}</text>`).join("")}</g></svg>`;
  return sharp(Buffer.from(image)).jpeg({ quality: 90 }).toBuffer();
}

async function wrappedReceiptPhoto() {
  const lines = ["Pavyzdžio salonas", "UAB Bandymų technika", "TEST60420CK", "Bandymų indukcinė kaitlentė", "179,49 A", "Mokėti 179,49", "Mokėti suapvalinus 179,50", "Kvito Nr. 3/4/12345", "2024-01-30 12:41"];
  const image = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1500"><defs><pattern id="cloth" width="18" height="18" patternUnits="userSpaceOnUse"><rect width="18" height="18" fill="#645c4c"/><path d="M0 4H18M3 0V18M12 0V18" stroke="#a79a82" stroke-width="3"/></pattern></defs><rect width="100%" height="100%" fill="url(#cloth)"/><rect x="130" y="80" width="740" height="1340" fill="#eeeae1"/><g font-family="DejaVu Sans" font-size="32" fill="#303030">${lines.map((line, index) => `<text x="180" y="${180 + index * 115}">${line}</text>`).join("")}</g></svg>`;
  return sharp(Buffer.from(image)).jpeg({ quality: 84 }).toBuffer();
}

test("suvyniota prekė ir atskira PVM kainos eilutė pasiekia naujo pirkinio formą", async ({ page }) => {
  test.setTimeout(120000);
  await signIn(page, `wrapped-ocr-${randomUUID()}@example.test`);
  await page.goto("/prideti");
  const photo = await wrappedReceiptPhoto();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /Įkelti nuotrauką Pasirinkti/ }).click()]);
  await chooser.setFiles({ name: "fictional-wrapped.jpeg", mimeType: "image/jpeg", buffer: photo });
  await expect(page.getByText(/Nuskaityta\. Patikrink pasiūlytus duomenis/)).toBeVisible({ timeout: 90000 });
  await expect(page.getByLabel("Pardavėjas", { exact: true })).toHaveValue("UAB Bandymų technika");
  await expect(page.locator(".field").filter({ has: page.getByLabel("Prekės pavadinimas", { exact: true }) })).toContainText("indukcinė kaitlentė");
  await expect(page.getByLabel("Kaina (neprivaloma)", { exact: true })).toHaveValue("179.49");
  await expect(page.getByText(/Čekio suma: 179.50/)).toBeVisible();
  await page.getByLabel("Prekės pavadinimas", { exact: true }).fill("TEST60420CK Bandymų indukcinė kaitlentė");
  await page.getByRole("button", { name: "Išsaugoti pirkinį ir čekį" }).click();
  await expect(page).toHaveURL(/\/pirkiniai\/[0-9a-f-]+\?busena=cekis-pridetas/);
  const purchaseId = new URL(page.url()).pathname.split("/").pop()!;
  await page.reload();
  await expect(page.getByRole("heading", { name: "TEST60420CK Bandymų indukcinė kaitlentė" })).toBeVisible();
  const saved = await db(async (client) => (await client.query("SELECT p.price,r.id FROM purchase p JOIN receipt r ON r.target_purchase_id=p.id WHERE p.id=$1 AND r.state='ready'", [purchaseId])).rows[0]);
  expect(saved.price).toBe("179.49");
  expect(sha(await (await page.request.get(`/api/receipts/${saved.id}/content`)).body())).toBe(sha(photo));
});

test("kelių prekių OCR variantai rodomi naujo pirkinio peržiūroje", async ({ page }) => {
  test.setTimeout(120000);
  await signIn(page, `ambiguous-ocr-${randomUUID()}@example.test`);
  await page.goto("/prideti");
  const lines = ["UAB Bandymų prekyba", "Bandymų puodelis 17,49 A", "Bandymų lėkštė 29,99 B", "Mokėti 47,48", "Kvito Nr. 3/4/54321", "2024-01-30 12:41"];
  const image = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="100%" height="100%" fill="#5d5345"/><rect x="100" y="60" width="700" height="1080" fill="#f2f0e9"/><g font-family="DejaVu Sans" font-size="34" fill="#242424">${lines.map((line, index) => `<text x="145" y="${150 + index * 145}">${line}</text>`).join("")}</g></svg>`;
  const photo = await sharp(Buffer.from(image)).jpeg({ quality: 88 }).toBuffer();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /Įkelti nuotrauką Pasirinkti/ }).click()]);
  await chooser.setFiles({ name: "fictional-multiple.jpeg", mimeType: "image/jpeg", buffer: photo });
  await expect(page.getByText(/Nuskaityta\. Patikrink pasiūlytus duomenis/)).toBeVisible({ timeout: 90000 });
  await expect(page.getByLabel("Kaina (neprivaloma)", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "17.49", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "29.99", exact: true })).toBeVisible();
  await expect(page.getByText(/Čekio suma: 47.48/)).toBeVisible();
  await page.getByRole("button", { name: "17.49", exact: true }).click();
  await expect(page.getByLabel("Kaina (neprivaloma)", { exact: true })).toHaveValue("17.49");
});

test("prie esamo pirkinio pridėto čekio nuskaitymo pasiūlymai išlieka peržiūroje", async ({ page }) => {
  test.setTimeout(120000);
  await signIn(page, `existing-ocr-${randomUUID()}@example.test`);
  const purchaseId = await createPurchase(page, "Patvirtintas pirkinys");
  await page.goto(`/pirkiniai/${purchaseId}`);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /Įkelti nuotrauką Pasirinkti/ }).click()]);
  await chooser.setFiles({ name: "anonymous-receipt.jpeg", mimeType: "image/jpeg", buffer: await anonymousReceiptPhoto() });
  await expect(page.getByText(/Nuskaityta\. Patikrink pasiūlytus duomenis/)).toBeVisible({ timeout: 90000 });
  await page.getByRole("button", { name: "Įkelti čekį" }).click();
  await page.getByRole("link", { name: "Peržiūrėti nuskaitytus duomenis" }).click();
  await expect(page.getByRole("heading", { name: "Peržiūrėk duomenis" })).toBeVisible();
  await expect(page.getByText("Nuskaityta. Peržiūrėk pasiūlymus.")).toBeVisible();
  await expect(page.getByLabel("Prekės pavadinimas", { exact: true })).toHaveValue("Patvirtintas pirkinys");
  await expect(page.getByText(/Modelio kodą sutikrink su čekiu/)).toBeVisible();
  await expect(page.getByText("UAB Bandymų prekyba")).toBeVisible();
  const price = page.getByLabel("Prekės kaina (neprivaloma)");
  await expect(price).toHaveValue("");
  await price.locator("..").getByRole("button", { name: "Pritaikyti pasiūlymą" }).click();
  await expect(price).toHaveValue("19.99");
  await expect(page.getByText("20.00")).toBeVisible();
  await page.getByLabel("Prekės kainos valiuta").selectOption("EUR");
  await page.getByLabel("Prekės pavadinimas", { exact: true }).fill("Patvirtintas pirkinys, pataisytas");
  await page.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/pirkiniai/${purchaseId}\\?busena=atnaujinta`));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Patvirtintas pirkinys, pataisytas" })).toBeVisible();
  expect(await db(async (client) => (await client.query("SELECT price FROM purchase WHERE id=$1", [purchaseId])).rows[0].price)).toBe("19.99");
});

test("naujas čekis nuskaitomas prieš sukuriant pirkinį ir išsaugomas originalas", async ({ page }) => {
  test.setTimeout(120000);
  await signIn(page, `new-ocr-${randomUUID()}@example.test`);
  await page.goto("/prideti");
  await page.getByLabel("Įkelti nuotrauką", { exact: true }).setInputFiles({ name: "anonymous-receipt.jpeg", mimeType: "image/jpeg", buffer: await anonymousReceiptPhoto() });
  await expect(page.getByText(/Nuskaityta\. Patikrink pasiūlytus duomenis/)).toBeVisible({ timeout: 90000 });
  await expect(page.getByLabel("Pardavėjas", { exact: true })).toHaveValue("UAB Bandymų prekyba");
  await expect(page.getByLabel("Prekės pavadinimas", { exact: true })).toHaveValue(/Prietaisas.*bandomasis įrenginys/);
  await expect(page.getByText(/Modelio kodą sutikrink su čekiu/)).toBeVisible();
  await expect(page.getByLabel("Pirkimo data", { exact: true })).toHaveValue("2024-01-30");
  await expect(page.getByLabel("Kaina (neprivaloma)", { exact: true })).toHaveValue("19.99");
  await expect(page.getByText(/Čekio suma: 20.00/)).toBeVisible();
  await expect(page.getByLabel("Čekio numeris (neprivaloma)")).toHaveValue("1/1/12345");
  // Owner review corrects any OCR model-character error before committing.
  await page.getByLabel("Prekės pavadinimas", { exact: true }).fill("TEST60420 Prietaisas bandomasis įrenginys");
  await page.getByRole("button", { name: "Išsaugoti pirkinį ir čekį" }).click();
  await expect(page).toHaveURL(/\/pirkiniai\/[0-9a-f-]+\?busena=cekis-pridetas/);
  const purchaseId = new URL(page.url()).pathname.split("/").pop()!;
  await page.reload();
  await expect(page.getByRole("heading", { name: "TEST60420 Prietaisas bandomasis įrenginys" })).toBeVisible();
  const row = await db(async (client) => (await client.query("SELECT r.id,r.receipt_number,p.price FROM receipt r JOIN purchase p ON p.id=r.target_purchase_id WHERE p.id=$1 AND r.state='ready'", [purchaseId])).rows[0]);
  expect(row).toMatchObject({ receipt_number: "1/1/12345", price: "19.99" });
  expect(sha(await (await page.request.get(`/api/receipts/${row.id}/content`)).body())).toBe(sha(await anonymousReceiptPhoto()));
});

test("naujo čekio OCR neperrašo įvestų laukų; atšaukimas ir failo pakeitimas atmeta seną rezultatą", async ({ page }) => {
  test.setTimeout(120000);
  await signIn(page, `new-ocr-cancel-${randomUUID()}@example.test`);
  await page.goto("/prideti");
  await page.getByLabel("Įkelti nuotrauką", { exact: true }).setInputFiles({ name: "anonymous-receipt.jpeg", mimeType: "image/jpeg", buffer: await anonymousReceiptPhoto() });
  await page.getByLabel("Pardavėjas", { exact: true }).fill("Mano patikrintas pardavėjas");
  await page.getByLabel("Prekės pavadinimas", { exact: true }).fill("Mano patikrinta prekė");
  await page.getByLabel("Kaina (neprivaloma)", { exact: true }).fill("18.75");
  await page.getByLabel("Pirkimo data", { exact: true }).fill("2024-02-01");
  await expect(page.getByText(/Nuskaityta\. Patikrink pasiūlytus duomenis/)).toBeVisible({ timeout: 90000 });
  await expect(page.getByLabel("Pardavėjas", { exact: true })).toHaveValue("Mano patikrintas pardavėjas");
  await expect(page.getByLabel("Prekės pavadinimas", { exact: true })).toHaveValue("Mano patikrinta prekė");
  await expect(page.getByLabel("Kaina (neprivaloma)", { exact: true })).toHaveValue("18.75");
  await expect(page.getByLabel("Pirkimo data", { exact: true })).toHaveValue("2024-02-01");
  await page.getByRole("button", { name: "Bandyti nuskaityti dar kartą" }).click();
  await page.getByRole("button", { name: "Atšaukti nuskaitymą" }).click();
  await expect(page.getByText("Nuskaitymas atšauktas. Gali įvesti duomenis rankiniu būdu.")).toBeVisible();
  const pdf = await PDFDocument.create(); pdf.addPage([200, 200]);
  await page.getByLabel("Įkelti PDF", { exact: true }).setInputFiles({ name: "manual.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await expect(page.getByText("PDF automatinis nuskaitymas neprieinamas. Įvesk duomenis rankiniu būdu.")).toBeVisible();
  await expect(page.getByLabel("Pardavėjas", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Prekės pavadinimas", { exact: true })).toHaveValue("");
});

test("tikru OCR perskaitytos dvi datos pasiekia naujo pirkinio peržiūrą", async ({ page }) => {
  test.setTimeout(120000);
  await signIn(page, `footer-candidates-${randomUUID()}@example.test`);
  await page.goto("/prideti");
  const lines = [
    ["UAB Pavyzdžio prekyba", 170], ["Bandymų įrenginys 39,99 A", 350],
    ["Mokėti 39,99", 520], ["Kvito Nr. 5/6/12345", 710],
    ["CR-000012345 2024-02-01 12:40:06", 1270],
    ["Patikrinimas 2024-02-02 12:45:06", 1360],
  ] as const;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1650"><rect width="100%" height="100%" fill="#eee"/><rect x="75" y="55" width="850" height="1540" fill="#f7f7f2"/><g font-family="DejaVu Sans" font-size="32" fill="#252525">${lines.map(([line, y]) => `<text x="110" y="${y}">${line}</text>`).join("")}</g></svg>`;
  const photo = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
  await page.getByLabel("Įkelti nuotrauką", { exact: true }).setInputFiles({ name: "fictional-footer.jpeg", mimeType: "image/jpeg", buffer: photo });
  await expect(page.getByText(/Nuskaityta\. Patikrink pasiūlytus duomenis/)).toBeVisible({ timeout: 90000 });
  const date = page.getByLabel("Pirkimo data", { exact: true });
  await expect(date).toHaveValue("");
  const field = page.locator(".field").filter({ has: date });
  await expect(field.getByText("Galimi nuskaitymo variantai – patikrink čekį:")).toBeVisible();
  await expect(field.getByRole("button", { name: "2024-02-01" })).toBeVisible();
  await expect(field.getByRole("button", { name: "2024-02-02" })).toBeVisible();
  await field.getByRole("button", { name: "2024-02-01" }).click();
  await expect(date).toHaveValue("2024-02-01");
});
