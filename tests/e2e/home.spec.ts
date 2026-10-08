import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { todayInVilnius } from "../../src/lib/purchase-validation";

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
async function withDb<T>(task: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try { return await task(client); } finally { await client.end(); }
}
function dateOffset(today: string, days: number) {
  const [year, month, day] = today.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

test("privati pradžia: ribos, sutampantys langai, tvarka, nuorodos ir ekranai", async ({ browser }) => {
  test.setTimeout(90000);
  const suffix = `${Date.now()}-${randomUUID()}`;
  const emailA = `home-a-${suffix}@example.test`;
  const emailB = `home-b-${suffix}@example.test`;
  const contextA = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  await a.goto("/pradzia");
  await expect(a).toHaveURL(/\/prisijungti/);
  await signIn(a, emailA);
  await expect(a.getByRole("heading", { name: "Dar neturite pirkinių" })).toBeVisible();
  await expect(a.getByRole("link", { name: "Pridėti čekį" }).first()).toHaveAttribute("href", "/prideti");
  await signIn(b, emailB);
  const today = todayInVilnius();
  const fixtures = [
    ["Vakar", -1, 1], ["Šiandien", 0, 2], ["Rytoj A", 1, 3], ["Rytoj B", 1, 3],
    ["Po 2", 2, 4], ["Po 3", 3, 5], ["Po 30", 30, 6], ["Po 31", 31, 7],
    ["Po 90", 90, 8], ["Po 91", 91, 9],
  ] as const;
  const inserted = await withDb(async (client) => {
    const userA = (await client.query('SELECT id FROM "user" WHERE email=$1', [emailA])).rows[0].id as string;
    const userB = (await client.query('SELECT id FROM "user" WHERE email=$1', [emailB])).rows[0].id as string;
    const ids: Record<string, string> = {};
    for (const [name, days, age] of fixtures) {
      const row = await client.query(`INSERT INTO purchase(owner_id,submission_key,product_name,seller,purchase_date,warranty_state,warranty_end_date,warranty_source,created_at)
        VALUES($1,gen_random_uuid(),$2,$3,$4,'known',$5,'date',timestamptz '2026-01-01 00:00:00+00' - $6::integer * interval '1 day') RETURNING id`,
      [userA,name,name === "Po 2" ? "Labai ilgas pardavėjo pavadinimas ".repeat(5).trim() : "Pardavėjas",name === "Po 91" ? today : dateOffset(today,-300),dateOffset(today,days),age]);
      ids[name] = row.rows[0].id;
    }
    for (const [name, state] of [["Nežinoma", "unknown"], ["Nėra", "none"]] as const) {
      const row = await client.query(`INSERT INTO purchase(owner_id,submission_key,product_name,seller,purchase_date,warranty_state,created_at)
        VALUES($1,gen_random_uuid(),$2,'Pardavėjas',$3,$4,now()) RETURNING id`, [userA,name,dateOffset(today,-300),state]);
      ids[name] = row.rows[0].id;
    }
    await client.query(`INSERT INTO purchase(owner_id,submission_key,product_name,seller,purchase_date,warranty_state,warranty_end_date,warranty_source)
      VALUES($1,gen_random_uuid(),'Svetima','Pardavėjas',$2,'known',$3,'date')`, [userB,dateOffset(today,-300),today]);
    const receiptId = (await client.query(`INSERT INTO receipt(owner_id,submission_key,target_purchase_id,object_key,filename,content_type,byte_size,sha256,state,expires_at)
      VALUES($1,gen_random_uuid(),$2,$3,'bandymas.png','image/png',1,$4,'ready',now() + interval '1 day') RETURNING id`,
      [userA,ids["Šiandien"],`home-test/${randomUUID()}`,"0".repeat(64)])).rows[0].id;
    for (const purchaseId of [ids["Šiandien"], ids["Rytoj A"]]) await client.query(
      "INSERT INTO purchase_receipt(owner_id,purchase_id,receipt_id) VALUES($1,$2,$3)", [userA,purchaseId,receiptId]);
    return ids;
  });
  await a.goto("/pradzia");
  await expect(a.getByRole("link", { name: /Per artimiausias 30 dienų:/ })).toContainText("6");
  await expect(a.getByRole("link", { name: /Per artimiausias 90 dienų:/ })).toContainText("8");
  await expect(a.getByText("Į 90 dienų skaičių įtrauktos ir artimiausios 30 dienų.")).toBeVisible();
  const upcoming = a.locator('[aria-labelledby="upcoming-title"] .purchase-card');
  await expect(upcoming).toHaveCount(5);
  const tie = ["Rytoj A", "Rytoj B"].sort((left, right) => inserted[right] > inserted[left] ? 1 : -1);
  await expect(upcoming.locator("strong")).toHaveText(["Šiandien", ...tie, "Po 2", "Po 3"]);
  await expect(upcoming.first()).toContainText("Baigiasi šiandien");
  const recent = a.locator('[aria-labelledby="recent-title"] .purchase-card');
  await expect(recent).toHaveCount(5);
  await expect(recent.locator("strong").first()).toHaveText(/Nežinoma|Nėra/);
  expect(await recent.locator("strong").allTextContents()).not.toContain("Po 91");
  await a.getByRole("link", { name: /Per artimiausias 30 dienų:/ }).click();
  await expect(a).toHaveURL(/warranty=soon&sort=expiry/);
  await expect(a.locator(".purchase-card")).toHaveCount(6);
  await expect(a.locator(".purchase-card").first()).toContainText("Šiandien");
  await a.locator(".purchase-card").first().click();
  await expect(a.getByRole("heading", { name: "Šiandien" })).toBeVisible();
  await a.goto("/pradzia");
  await a.getByRole("link", { name: /Per artimiausias 90 dienų:/ }).click();
  await expect(a).toHaveURL(/warranty=upcoming90&sort=expiry/);
  await expect(a.locator(".purchase-card")).toHaveCount(8);
  await a.goto("/pirkiniai?warranty=unsupported");
  await expect(a.getByLabel("Garantijos filtras")).toHaveValue("all");
  await a.goto("/pradzia");
  await a.getByRole("link", { name: "Visi pirkiniai" }).click();
  await expect(a.locator(".purchase-card")).toHaveCount(12);
  await a.goto("/pradzia");
  await a.getByRole("link", { name: "Pridėti čekį" }).click();
  await expect(a.getByRole("heading", { name: "Pridėti čekį" })).toBeVisible();
  await b.goto("/pradzia");
  await expect(b.getByRole("link", { name: /Per artimiausias 30 dienų:/ })).toContainText("1");
  await expect(b.getByRole("link", { name: /Per artimiausias 90 dienų:/ })).toContainText("1");
  await expect(b.locator('[aria-labelledby="upcoming-title"] .purchase-card')).toHaveCount(1);
  await b.getByRole("link", { name: /Per artimiausias 90 dienų:/ }).click();
  await expect(b.locator(".purchase-card")).toHaveCount(1);
  await b.goto(`/pirkiniai/${inserted["Šiandien"]}`);
  await expect(b.getByRole("heading", { name: "Pirkinys nerastas" })).toBeVisible();
  for (const width of [320, 390, 1024]) {
    await a.setViewportSize({ width, height: 800 });
    await a.goto("/pradzia");
    expect(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await a.evaluate(() => { document.body.style.zoom = "1.5"; return document.documentElement.scrollWidth <= innerWidth; })).toBe(true);
    await a.evaluate(() => { document.body.style.zoom = ""; });
  }
  await a.keyboard.press("Tab");
  const focused = a.locator(":focus");
  expect(await focused.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
  await contextA.close(); await contextB.close();
});

test("pradžios duomenys atsinaujina sukūrus, pakeitus ir ištrynus pirkinį", async ({ page }) => {
  test.setTimeout(60000);
  const email = `home-mutations-${Date.now()}-${randomUUID()}@example.test`;
  await signIn(page, email);
  await page.getByRole("link", { name: "Pridėti čekį" }).first().click();
  await page.getByRole("link", { name: "Įvesti rankiniu būdu" }).click();
  await page.getByLabel("Prekės pavadinimas").fill("Keičiamas pirkinys");
  await page.getByLabel("Pardavėjas").fill("Pardavėjas");
  await page.getByLabel("Pirkimo data").fill(dateOffset(todayInVilnius(), -1));
  await page.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Keičiamas pirkinys" })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await page.getByRole("link", { name: "Pradžia" }).click();
  await expect(page.getByText("Per artimiausias 90 dienų garantijos nesibaigia.")).toBeVisible();
  await expect(page.locator('[aria-labelledby="recent-title"] .purchase-card')).toContainText("Keičiamas pirkinys");
  await page.goto(`/pirkiniai/${id}/redaguoti`);
  await page.getByLabel("Pirkimo data").fill(dateOffset(todayInVilnius(), -160));
  await page.getByLabel("Garantijos trukmė").selectOption("6");
  await page.getByRole("button", { name: "Išsaugoti pakeitimus" }).click();
  await expect(page.getByRole("heading", { name: "Keičiamas pirkinys" })).toBeVisible();
  await page.getByRole("link", { name: "Pradžia" }).click();
  await expect(page.getByRole("link", { name: /Per artimiausias 30 dienų:/ })).toContainText("1");
  await expect(page.locator('[aria-labelledby="upcoming-title"] .purchase-card')).toContainText("Keičiamas pirkinys");
  await page.goto(`/pirkiniai/${id}`);
  await page.getByRole("button", { name: "Ištrinti pirkinį" }).click();
  await page.getByRole("button", { name: "Ištrinti", exact: true }).click();
  await page.getByRole("link", { name: "Pradžia" }).click();
  await expect(page.getByRole("heading", { name: "Dar neturite pirkinių" })).toBeVisible();
});

test("nežinomos, nesamos ir pasibaigusios garantijos nerodomos kaip artėjančios", async ({ page }) => {
  const email = `home-no-upcoming-${Date.now()}-${randomUUID()}@example.test`;
  await signIn(page, email);
  const today = todayInVilnius();
  await withDb(async (client) => {
    const owner = (await client.query('SELECT id FROM "user" WHERE email=$1', [email])).rows[0].id;
    for (const [name, state, end] of [["Nežinoma", "unknown", null], ["Nėra", "none", null], ["Pasibaigusi", "known", dateOffset(today,-1)]] as const) {
      await client.query(`INSERT INTO purchase(owner_id,submission_key,product_name,seller,purchase_date,warranty_state,warranty_end_date,warranty_source)
        VALUES($1,gen_random_uuid(),$2,'Pardavėjas',$3,$4,$5,$6)`, [owner,name,dateOffset(today,-300),state,end,end ? "date" : null]);
    }
  });
  await page.goto("/pradzia");
  await expect(page.getByRole("link", { name: /Per artimiausias 30 dienų:/ })).toContainText("0");
  await expect(page.getByRole("link", { name: /Per artimiausias 90 dienų:/ })).toContainText("0");
  await expect(page.getByText("Per artimiausias 90 dienų garantijos nesibaigia.")).toBeVisible();
  await expect(page.locator('[aria-labelledby="recent-title"] .purchase-card')).toHaveCount(3);
});

test("nepavykus nuskaityti rodoma klaida ir bandymo iš naujo veiksmas", async ({ page }) => {
  const email = `home-failure-${Date.now()}-${randomUUID()}@example.test`;
  await signIn(page, email);
  await page.setExtraHTTPHeaders({ "x-cekis-test-home-failure": "1" });
  await page.goto("/pradzia");
  await expect(page.getByRole("heading", { name: "Nepavyko įkelti pradžios" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.setExtraHTTPHeaders({});
  await page.getByRole("button", { name: "Bandyti dar kartą" }).click();
  await expect(page.getByRole("heading", { name: "Dar neturite pirkinių" })).toBeVisible();
});
