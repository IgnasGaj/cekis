import { expect, test, type Page } from "@playwright/test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import sharp from "sharp";

type Mail = { ID: string; To: { Address: string }[] };
async function signIn(page: Page, email: string) {
  const ip = randomBytes(2);
  await page.setExtraHTTPHeaders({ "X-Forwarded-For": `198.51.${ip[0]}.${ip[1]}` });
  await page.goto("/prisijungti");
  await page.getByLabel("El. pašto adresas").fill(email);
  await page.getByRole("button", { name: "Siųsti prisijungimo nuorodą" }).click();
  await expect(page.getByRole("heading", { name: "Patikrink el. paštą" })).toBeVisible();
  let id = "";
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await fetch("http://localhost:1080/api/v1/messages");
    const { messages } = await response.json() as { messages: Mail[] };
    id = messages.find((message) => message.To.some((recipient) => recipient.Address === email))?.ID ?? "";
    if (id) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!id) throw new Error("Vietinis laiškas negautas");
  const detail = await fetch(`http://localhost:1080/api/v1/message/${id}`);
  const link = (await detail.json() as { Text: string }).Text.match(/https?:\/\/[^\s]+/)?.[0];
  if (!link) throw new Error("Laiške nėra nuorodos");
  await page.goto(link);
  await expect(page).toHaveURL(/\/pradzia/);
}

async function withDb<T>(work: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try { return await work(client); } finally { await client.end(); }
}

async function traverse(page: Page, href: string, expectedCount: number) {
  await page.goto(href);
  const ids: string[] = [];
  for (let pageNumber = 1; pageNumber <= 10; pageNumber++) {
    const cards = page.locator(".purchase-card");
    await expect(cards).toHaveCount(Math.min(50, expectedCount - ids.length));
    if (ids.length + 50 < expectedCount) await expect(page.getByRole("link", { name: "Kitas puslapis" })).toBeVisible();
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(50);
    ids.push(...(await cards.evaluateAll((items) => items.map((item) => new URL((item as HTMLAnchorElement).href).pathname.split("/").pop()!))));
    const next = page.getByRole("link", { name: "Kitas puslapis" });
    if (ids.length === expectedCount) {
      await expect(next).toHaveCount(0);
      return ids;
    }
    await next.click();
    await expect(page).toHaveURL(new RegExp(`page=${pageNumber + 1}`));
  }
  throw new Error("Puslapių seka nesibaigė");
}

test("apie 200 pirkinių lieka pasiekiami per paiešką, rikiavimą, čekį ir paskyrų atskirtį", async ({ browser }) => {
  test.setTimeout(180000);
  const suffix = randomUUID();
  const emailA = `retrieval-a-${suffix}@example.test`;
  const emailB = `retrieval-b-${suffix}@example.test`;
  const owner = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const other = await browser.newContext();
  const page = await owner.newPage();
  const foreign = await other.newPage();
  await signIn(page, emailA);
  await signIn(foreign, emailB);
  const seeded = await withDb(async (client) => {
    const users = await client.query('SELECT id,email FROM "user" WHERE email = ANY($1)', [[emailA, emailB]]);
    const owners = new Map(users.rows.map((row) => [row.email as string, row.id as string]));
    const a = owners.get(emailA)!;
    const b = owners.get(emailB)!;
    const rows = await client.query<{ id: string }>(`INSERT INTO purchase
      (owner_id,submission_key,product_name,seller,purchase_date,warranty_state,warranty_end_date,warranty_source)
      SELECT $1,gen_random_uuid(),'Rinkinys ' || (n % 7),'Pardavėjas ' || (n % 5),
        date '2024-01-01' + (n % 20),
        CASE WHEN n % 4 = 0 THEN 'known' WHEN n % 4 = 1 THEN 'none' ELSE 'unknown' END,
        CASE WHEN n % 4 = 0 THEN CASE WHEN n % 8 = 0 THEN current_date + 10 ELSE date '2025-01-01' END END,
        CASE WHEN n % 4 = 0 THEN 'date' END
      FROM generate_series(1,204) AS n RETURNING id`, [a]);
    const special = await client.query<{ id: string }>(`INSERT INTO purchase
      (owner_id,submission_key,product_name,seller,purchase_date,warranty_state,warranty_end_date,warranty_source)
      VALUES ($1,gen_random_uuid(),$2,$3,'2024-01-01','known',current_date + 10,'date') RETURNING id`,
      [a, `Surandamas ${"A".repeat(170)}`, `Pardavėjas ${"B".repeat(150)}`]);
    const foreignRows = await client.query<{ id: string }>(`INSERT INTO purchase
      (owner_id,submission_key,product_name,seller,purchase_date)
      SELECT $1,gen_random_uuid(),'Rinkinys ' || n,'Kitas pardavėjas',date '2024-01-01'
      FROM generate_series(1,7) AS n RETURNING id`, [b]);
    return { a: rows.rows.map((row) => row.id), special: special.rows[0].id, b: foreignRows.rows.map((row) => row.id) };
  });
  const expected = new Set([...seeded.a, seeded.special]);
  const started = Date.now();
  for (const sort of ["newest", "oldest", "expiry"]) {
    const ids = await traverse(page, `/pirkiniai?sort=${sort}`, 205);
    expect(ids).toHaveLength(205);
    expect(new Set(ids)).toEqual(expected);
  }
  const searched = await traverse(page, "/pirkiniai?q=RINKINYS&sort=expiry", 204);
  expect(searched).toHaveLength(204);
  expect(new Set(searched)).toEqual(new Set(seeded.a));
  console.log(`Disposable PostgreSQL/Chromium: 205 rows, 3 sort traversals and search traversal in ${Date.now() - started} ms`);

  await page.goto("/pirkiniai?q=%20%20surandamas%20%20&sort=oldest&warranty=valid&page=999");
  await expect(page).toHaveURL(/\/pirkiniai\?q=surandamas&sort=oldest&warranty=valid$/);
  await expect(page.locator(".purchase-card")).toHaveCount(1);
  for (const width of [320, 390, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole("link", { name: "Išvalyti paiešką" })).toBeVisible();
    await expect(page.getByLabel("Rikiuoti pirkinius")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const clear = page.getByRole("link", { name: "Išvalyti paiešką" });
    await page.getByLabel("Ieškoti pagal prekę arba pardavėją").focus();
    await page.keyboard.press("Tab");
    await expect(clear).toBeFocused();
    expect(await clear.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
    const nav = await page.locator(".bottom-nav").boundingBox();
    const search = await page.getByLabel("Ieškoti pagal prekę arba pardavėją").boundingBox();
    expect(nav!.y).toBeGreaterThan(search!.y + search!.height);
  }
  await page.getByRole("link", { name: "Išvalyti paiešką" }).click();
  await expect(page).toHaveURL(/\/pirkiniai\?sort=oldest&warranty=valid$/);
  await page.goto("/pirkiniai?q=NIEKO&sort=expiry&warranty=none");
  await expect(page.getByRole("heading", { name: "Pagal paiešką pirkinių nerasta" })).toBeVisible();
  await page.getByRole("link", { name: "Išvalyti paiešką" }).last().click();
  await expect(page).toHaveURL(/\/pirkiniai\?sort=expiry&warranty=none$/);
  await page.goto("/pirkiniai?warranty=soon&q=NIEKO");
  await expect(page.getByRole("heading", { name: "Pagal paiešką pirkinių nerasta" })).toBeVisible();
  await page.goto("/pirkiniai?sort=negalioja&warranty=negalioja&page=-2");
  await expect(page.getByLabel("Rikiuoti pirkinius")).toHaveValue("newest");
  await expect(page.getByLabel("Garantijos filtras")).toHaveValue("all");
  await expect(page.locator(".purchase-card")).toHaveCount(50);

  await page.goto("/pirkiniai?q=SURANDAMAS&sort=oldest");
  await page.locator(".purchase-card").click();
  await expect(page.getByRole("heading", { name: /Surandamas/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "← Mano pirkiniai" })).toHaveAttribute("href", "/pirkiniai?q=SURANDAMAS&sort=oldest");
  const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: "teal" } }).png().toBuffer();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /Įkelti nuotrauką Pasirinkti/ }).click()]);
  await chooser.setFiles({ name: "bandymo-cekis.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Atšaukti nuskaitymą" }).click();
  await page.getByRole("button", { name: "Įkelti čekį" }).click();
  await expect(page.getByRole("link", { name: "Peržiūrėti čekį" })).toBeVisible();
  const receiptId = await withDb(async (client) => (await client.query<{ id: string }>(
    "SELECT id FROM receipt WHERE target_purchase_id=$1 AND state='ready'", [seeded.special])).rows[0].id);
  const bytes = await page.request.get(`/api/receipts/${receiptId}/content?download=1`);
  expect(bytes.status()).toBe(200);
  expect(createHash("sha256").update(await bytes.body()).digest("hex")).toBe(createHash("sha256").update(png).digest("hex"));
  const [preview] = await Promise.all([page.waitForEvent("popup"), page.getByRole("link", { name: "Peržiūrėti čekį" }).click()]);
  await expect(preview).toHaveURL(new RegExp(`/api/receipts/${receiptId}/content`));
  await preview.close();
  const attach = await page.request.post(`/api/receipts/${receiptId}/links`, {
    headers: { Origin: process.env.APP_URL! }, data: { purchaseId: seeded.a[0] },
  });
  expect(attach.status()).toBe(200);
  await page.goto(`/pirkiniai/${seeded.a[0]}`);
  await expect(page.getByText("bandymo-cekis.png").first()).toBeVisible();
  await page.goto(`/pirkiniai/${seeded.special}?q=SURANDAMAS&sort=oldest`);
  await page.getByRole("link", { name: "← Mano pirkiniai" }).click();
  await expect(page).toHaveURL(/\/pirkiniai\?q=SURANDAMAS&sort=oldest$/);
  await expect(page.locator(".purchase-card")).toHaveCount(1);

  await foreign.goto("/pirkiniai?q=surandamas");
  await expect(foreign.getByRole("heading", { name: "Pagal paiešką pirkinių nerasta" })).toBeVisible();
  expect((await foreign.request.get(`/api/receipts/${receiptId}/content`)).status()).toBe(404);
  await foreign.goto("/pradzia");
  await expect(foreign.getByRole("link", { name: /Per artimiausias 30 dienų: 0/ })).toBeVisible();
  await foreign.goto("/pirkiniai?warranty=soon&sort=expiry");
  await expect(foreign.getByRole("heading", { name: "Pagal garantijos filtrą pirkinių nerasta" })).toBeVisible();
  await expect(foreign.getByText("Filtras „Per artimiausias 30 dienų“ neatitiko nė vieno pirkinio.")).toBeVisible();
  await foreign.getByRole("link", { name: "Išvalyti filtrus" }).click();
  await expect(foreign).toHaveURL(/\/pirkiniai\?sort=expiry$/);
  const foreignIds = await traverse(foreign, "/pirkiniai", 7);
  expect(new Set(foreignIds)).toEqual(new Set(seeded.b));
  const anonymous = await browser.newContext();
  expect((await anonymous.request.get(`/api/receipts/${receiptId}/content`)).status()).toBe(401);
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto("/pirkiniai?q=surandamas");
  await expect(anonymousPage).toHaveURL(/\/prisijungti/);
  await anonymous.close();
  await owner.close(); await other.close();
});

test("sąrašo nuskaitymo klaida rodoma aiškiai, pakartojimas grąžina duomenis", async ({ page }) => {
  await signIn(page, `retrieval-error-${randomUUID()}@example.test`);
  await page.setExtraHTTPHeaders({ "x-cekis-test-list-failure": "1" });
  await page.goto("/pirkiniai");
  await expect(page.getByRole("heading", { name: "Nepavyko įkelti pirkinių" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dar neturite pirkinių" })).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  await page.setExtraHTTPHeaders({});
  await page.getByRole("button", { name: "Bandyti dar kartą" }).click();
  await expect(page.getByRole("heading", { name: "Dar neturite pirkinių" })).toBeVisible();
});
