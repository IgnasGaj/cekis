import { expect, test, type Page, type Locator } from "@playwright/test";
import { Client } from "pg";
import { randomBytes } from "node:crypto";

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

async function withAppDb<T>(task: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try { return await task(client); } finally { await client.end(); }
}
async function tabTo(page: Page, control: Locator) {
  for (let step = 0; step < 60; step++) {
    if (await control.evaluate((element) => element === document.activeElement)) {
      expect(await control.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error("Klaviatūra nepasiekė valdiklio");
}

test("rankinis ciklas, paieška, paskyrų izoliacija ir ištrynimas", async ({ browser }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailA = `purchase-a-${suffix}@example.test`;
  const emailB = `purchase-b-${suffix}@example.test`;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto("/pirkiniai");
  await expect(page).toHaveURL(/\/prisijungti/);
  await signIn(page, emailA);
  await page.getByRole("link", { name: "Pirkiniai", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dar neturi pirkinių" })).toBeVisible();
  await page.getByRole("link", { name: "Pridėti pirkinį" }).first().click();
  await page.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(page.getByText("Įvesk prekės pavadinimą")).toBeVisible();
  await expect(page.locator("#productName")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Pardavėjas")).toBeFocused();
  await page.getByLabel("Prekės pavadinimas").fill(" Žalias čėkis ");
  await page.getByLabel("Pardavėjas").fill(" Parduotuvė ");
  await page.getByLabel("Pirkimo data").fill("2024-02-29");
  await page.getByLabel("Kaina (neprivaloma)").fill("12,50");
  await page.getByLabel("Valiuta").selectOption("PLN");
  await page.getByLabel("Pastabos (neprivaloma)").fill("Paprasta <b>pastaba</b>");
  const key = await page.locator('input[name="submissionKey"]').inputValue();
  await page.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(page).toHaveURL(/\/pirkiniai\/[0-9a-f-]+/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByRole("heading", { name: "Žalias čėkis" })).toBeVisible();
  await expect(page.getByText("12,50 PLN")).toBeVisible();
  await expect(page.getByText("Garantija nenurodyta")).toBeVisible();
  await expect(page.getByText("Čekis nepridėtas")).toBeVisible();
  await expect(page.locator("b")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Paprasta <b>pastaba</b>")).toBeVisible();
  const ownerA = await withAppDb(async (client) => {
    const result = await client.query('SELECT p.owner_id, p.product_name, p.seller, p.purchase_date::text, p.price::text, p.currency, p.notes FROM purchase p WHERE p.id = $1', [id]);
    expect(result.rows[0]).toMatchObject({ product_name: "Žalias čėkis", seller: "Parduotuvė", purchase_date: "2024-02-29", price: "12.50", currency: "PLN", notes: "Paprasta <b>pastaba</b>" });
    return result.rows[0].owner_id as string;
  });
  await page.getByRole("link", { name: "Redaguoti" }).click();
  await page.getByLabel("Kaina (neprivaloma)").fill("");
  await page.getByLabel("Pastabos (neprivaloma)").fill("");
  await page.getByRole("button", { name: "Išsaugoti pakeitimus" }).click();
  await expect(page.getByText("Pakeitimai išsaugoti")).toBeVisible();
  await page.reload();
  await expect(page.getByText("12,50 PLN")).toHaveCount(0);
  await withAppDb(async (client) => {
    const result = await client.query("SELECT price, currency, notes FROM purchase WHERE id = $1", [id]);
    expect(result.rows[0]).toMatchObject({ price: null, currency: null, notes: null });
  });
  await page.getByRole("link", { name: "Nustatymai" }).click();
  await page.getByRole("button", { name: "Atsijungti" }).click();
  await expect(page).toHaveURL(/\/prisijungti/);
  await page.goto(`/pirkiniai/${id}`);
  await expect(page).toHaveURL(/\/prisijungti/);
  await signIn(page, emailB);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goBack();
    await expect(page.getByText("Žalias čėkis")).toHaveCount(0);
  }
  await page.goto(`/pirkiniai/${id}`);
  await expect(page.getByRole("heading", { name: "Pirkinys nerastas" })).toBeVisible();
  await page.goto(`/pirkiniai/${id}/redaguoti`);
  await expect(page.getByRole("heading", { name: "Pirkinys nerastas" })).toBeVisible();
  await page.goto("/pirkiniai?q=%C4%8D%C4%97kis");
  await expect(page.getByRole("heading", { name: "Pirkinių nerasta" })).toBeVisible();
  await page.goto("/pirkiniai/naujas");
  await page.getByLabel("Prekės pavadinimas").fill("Kita prekė");
  await page.getByLabel("Pardavėjas").fill("Kitas pardavėjas");
  await page.getByLabel("Pirkimo data").fill("2024-03-01");
  await page.locator("form.purchase-form").evaluate((form, forgedOwner) => {
    const input = document.createElement("input"); input.name = "ownerId"; input.value = forgedOwner as string; form.append(input);
  }, ownerA);
  await page.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Kita prekė" })).toBeVisible();
  const idB = new URL(page.url()).pathname.split("/").pop()!;
  await withAppDb(async (client) => {
    const result = await client.query("SELECT owner_id FROM purchase WHERE submission_key = $1", [key]);
    expect(result.rows[0].owner_id).toBe(ownerA);
    const b = await client.query("SELECT owner_id FROM purchase WHERE id = $1", [idB]);
    expect(b.rows[0].owner_id).not.toBe(ownerA);
  });
  await page.getByRole("link", { name: "Nustatymai" }).click();
  await page.getByRole("button", { name: "Atsijungti" }).click();
  await signIn(page, emailA);
  await page.goto(`/pirkiniai/${id}`);
  await expect(page.getByRole("heading", { name: "Žalias čėkis" })).toBeVisible();
  await page.getByRole("button", { name: "Ištrinti pirkinį" }).click();
  await expect(page.getByRole("heading", { name: "Ištrinti „Žalias čėkis“?" })).toBeVisible();
  await page.getByRole("button", { name: "Atšaukti" }).click();
  await expect(page.getByRole("heading", { name: "Žalias čėkis" })).toBeVisible();
  await page.getByRole("button", { name: "Ištrinti pirkinį" }).click();
  await page.getByRole("button", { name: "Ištrinti", exact: true }).click();
  await expect(page).toHaveURL(/\/pirkiniai\?busena=istrinta/);
  await page.goto(`/pirkiniai/${id}`);
  await expect(page.getByRole("heading", { name: "Pirkinys nerastas" })).toBeVisible();
  await withAppDb(async (client) => {
    const result = await client.query("SELECT product_name, seller, price, currency, notes, deleted_at FROM purchase WHERE id = $1", [id]);
    expect(result.rows[0]).toMatchObject({ product_name: "Ištrinta", seller: "Ištrinta", price: null, currency: null, notes: null });
    expect(result.rows[0].deleted_at).not.toBeNull();
  });
  await context.close();
});

test("paieška traktuoja šablono ženklus pažodžiui, rikiuoja pagal datą ir veikia siaurame ekrane", async ({ page }) => {
  const email = `search-${Date.now()}@example.test`;
  await page.setViewportSize({ width: 320, height: 720 });
  await signIn(page, email);
  for (const [name, seller, date] of [["Prekė_1", "Ąžuolas", "2024-01-01"], ["Kava", "Čia", "2024-02-01"], ["Kita", "Parduotuvė", "2024-03-01"]]) {
    await page.goto("/pirkiniai/naujas");
    await page.getByLabel("Prekės pavadinimas").fill(name);
    await page.getByLabel("Pardavėjas").fill(seller);
    await page.getByLabel("Pirkimo data").fill(date);
    await page.getByRole("button", { name: "Išsaugoti", exact: true }).click();
    await expect(page).toHaveURL(/\/pirkiniai\/[0-9a-f-]+/);
  }
  await page.goto("/pirkiniai?q=_%25&sort=oldest");
  await expect(page.getByRole("heading", { name: "Pirkinių nerasta" })).toBeVisible();
  await page.getByLabel("Ieškoti pagal prekę arba pardavėją").fill("Čia");
  await page.getByRole("button", { name: "Rodyti" }).click();
  await expect(page.getByText("Kava")).toBeVisible();
  await page.getByLabel("Ieškoti pagal prekę arba pardavėją").fill("");
  await page.getByLabel("Rikiuoti pirkinius").selectOption("oldest");
  await page.getByRole("button", { name: "Rodyti" }).click();
  const cards = page.locator(".purchase-card strong");
  await expect(cards).toHaveText(["Prekė_1", "Kava", "Kita"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => { document.body.style.zoom = "1.5"; return document.documentElement.scrollWidth <= innerWidth; })).toBe(true);
  await page.evaluate(() => { document.body.style.zoom = ""; });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1024, height: 768 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("vienas kūrimo raktas nesukuria dublikatų ir neatkuria ištrinto įrašo", async ({ browser }) => {
  const email = `retry-${Date.now()}@example.test`;
  const context = await browser.newContext();
  const first = await context.newPage();
  await signIn(first, email);
  const second = await context.newPage();
  for (const page of [first, second]) {
    await page.goto("/pirkiniai/naujas");
    await page.getByLabel("Prekės pavadinimas").fill("Pakartotas");
    await page.getByLabel("Pardavėjas").fill("Pardavėjas");
    await page.getByLabel("Pirkimo data").fill("2024-01-01");
  }
  const key = await first.locator('input[name="submissionKey"]').inputValue();
  await second.locator('input[name="submissionKey"]').evaluate((input, value) => { (input as HTMLInputElement).value = value; }, key);
  await Promise.all([first.getByRole("button", { name: "Išsaugoti", exact: true }).click(), second.getByRole("button", { name: "Išsaugoti", exact: true }).click()]);
  await expect(first).toHaveURL(/\/pirkiniai\/[0-9a-f-]+/);
  await expect(second).toHaveURL(/\/pirkiniai\/[0-9a-f-]+/);
  expect(new URL(first.url()).pathname).toBe(new URL(second.url()).pathname);
  const id = new URL(first.url()).pathname.split("/").pop()!;
  await withAppDb(async (client) => {
    const result = await client.query("SELECT count(*)::integer AS total FROM purchase WHERE submission_key = $1", [key]);
    expect(result.rows[0].total).toBe(1);
  });
  await first.getByRole("link", { name: "Redaguoti" }).click();
  await first.getByLabel("Prekės pavadinimas").fill("Pakeistas");
  await first.getByRole("button", { name: "Išsaugoti pakeitimus" }).click();
  await expect(first.getByRole("heading", { name: "Pakeistas" })).toBeVisible();
  await second.goto("/pirkiniai/naujas");
  await second.getByLabel("Prekės pavadinimas").fill("Senas turinys");
  await second.getByLabel("Pardavėjas").fill("Pardavėjas");
  await second.getByLabel("Pirkimo data").fill("2024-01-01");
  await second.locator('input[name="submissionKey"]').evaluate((input, value) => { (input as HTMLInputElement).value = value; }, key);
  await second.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(second).toHaveURL(/\/pirkiniai\/naujas/);
  await expect(second.getByText(/Pirkinys jau išsaugotas su kitais duomenimis/)).toBeVisible();
  await expect(second.getByLabel("Prekės pavadinimas")).toHaveValue("Senas turinys");
  await expect(second.getByRole("link", { name: "Peržiūrėti išsaugotą pirkinį" })).toHaveAttribute("href", `/pirkiniai/${id}`);
  await expect(second.getByRole("link", { name: "Redaguoti išsaugotą pirkinį" })).toHaveAttribute("href", `/pirkiniai/${id}/redaguoti`);
  await first.getByRole("button", { name: "Ištrinti pirkinį" }).click();
  await first.getByRole("button", { name: "Ištrinti", exact: true }).click();
  await expect(first).toHaveURL(/\/pirkiniai\?busena=istrinta/);
  await second.goto("/pirkiniai/naujas");
  await second.getByLabel("Prekės pavadinimas").fill("Dar kartą");
  await second.getByLabel("Pardavėjas").fill("Pardavėjas");
  await second.getByLabel("Pirkimo data").fill("2024-01-01");
  await second.locator('input[name="submissionKey"]').evaluate((input, value) => { (input as HTMLInputElement).value = value; }, key);
  await second.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(second.getByText("Šis įrašas jau ištrintas. Pridėk pirkinį iš naujo.")).toBeVisible();
  await withAppDb(async (client) => {
    const result = await client.query("SELECT count(*)::integer AS total FROM purchase WHERE submission_key = $1", [key]);
    expect(result.rows[0].total).toBe(1);
  });
  await context.close();
});

test("prarasto atsakymo pakartojimas lygina visus pirkinio ir garantijos duomenis", async ({ browser }) => {
  const email = `retry-warranty-${Date.now()}@example.test`;
  const context = await browser.newContext();
  const savedPage = await context.newPage();
  await signIn(savedPage, email);
  await savedPage.goto("/pirkiniai/naujas");
  const fill = async (page: Page, source: "date" | "duration" = "date") => {
    await page.getByLabel("Prekės pavadinimas").fill("Garantijos bandymas");
    await page.getByLabel("Pardavėjas").fill("Pardavėjas");
    await page.getByLabel("Pirkimo data").fill("2024-01-01");
    await page.getByLabel("Garantijos būsena").selectOption("known");
    if (source === "duration") {
      await page.getByLabel("Kaip nurodysi pabaigą?").selectOption("duration");
      await page.getByLabel("Trukmė mėnesiais (1–600)").fill("48");
    } else await page.getByLabel("Garantijos pabaigos data").fill("2028-01-01");
    await page.getByLabel(/Patvirtinu garantijos pabaigos datą/).check();
  };
  await fill(savedPage);
  const key = await savedPage.locator('input[name="submissionKey"]').inputValue();
  const retained = await context.newPage();
  await retained.goto("/pirkiniai/naujas");
  await fill(retained);
  await retained.locator('input[name="submissionKey"]').evaluate((input, value) => { (input as HTMLInputElement).value = value; }, key);
  let responseLost = false;
  await savedPage.route("**/pirkiniai/naujas", async (route) => {
    if (route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
    const committed = await route.fetch();
    expect(committed.status()).toBe(200);
    responseLost = true;
    await route.fulfill({ status: 503, contentType: "text/plain", body: "Atsakymas nutrūko." });
  });
  await savedPage.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect.poll(() => responseLost).toBe(true);
  const id = await withAppDb(async (client) => {
    const rows = await client.query("SELECT id FROM purchase WHERE submission_key=$1", [key]);
    expect(rows.rows).toHaveLength(1);
    return rows.rows[0].id as string;
  });
  await retained.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(retained).toHaveURL(new RegExp(`/pirkiniai/${id}`));

  const retry = async (change: (page: Page) => Promise<void>) => {
    await retained.goto("/pirkiniai/naujas");
    await fill(retained);
    await change(retained);
    await retained.locator('input[name="submissionKey"]').evaluate((input, value) => { (input as HTMLInputElement).value = value; }, key);
    await retained.getByRole("button", { name: "Išsaugoti", exact: true }).click();
    await expect(retained).toHaveURL(/\/pirkiniai\/naujas/);
    await expect(retained.getByText(/Pirkinys jau išsaugotas su kitais duomenimis/)).toBeVisible();
    await expect(retained.getByRole("link", { name: "Peržiūrėti išsaugotą pirkinį" })).toHaveAttribute("href", `/pirkiniai/${id}`);
  };
  await retry(async (page) => {
    await page.getByLabel("Garantijos pabaigos data").fill("2029-01-01");
    await page.getByLabel(/Patvirtinu garantijos pabaigos datą/).check();
  });
  await expect(retained.getByLabel("Garantijos pabaigos data")).toHaveValue("2029-01-01");
  await expect(retained.getByLabel(/Patvirtinu garantijos pabaigos datą/)).toBeChecked();
  await retry(async (page) => { await page.getByLabel("Garantijos būsena").selectOption("none"); });
  await expect(retained.getByLabel("Garantijos būsena")).toHaveValue("none");
  await retry(async (page) => {
    await page.getByLabel("Kaip nurodysi pabaigą?").selectOption("duration");
    await page.getByLabel("Trukmė mėnesiais (1–600)").fill("48");
    await page.getByLabel(/Patvirtinu garantijos pabaigos datą/).check();
  });
  await expect(retained.getByLabel("Trukmė mėnesiais (1–600)")).toHaveValue("48");
  await retry(async (page) => { await page.getByLabel("Prekės pavadinimas").fill("Pakeistas pavadinimas"); });
  await expect(retained.getByLabel("Prekės pavadinimas")).toHaveValue("Pakeistas pavadinimas");
  await withAppDb(async (client) => {
    const rows = await client.query("SELECT product_name,warranty_state,warranty_end_date::text,warranty_duration_months,warranty_source FROM purchase WHERE submission_key=$1", [key]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ product_name: "Garantijos bandymas", warranty_state: "known", warranty_end_date: "2028-01-01", warranty_duration_months: null, warranty_source: "date" });
  });

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await signIn(other, `retry-other-${Date.now()}@example.test`);
  await other.goto("/pirkiniai/naujas");
  await fill(other);
  await other.locator('input[name="submissionKey"]').evaluate((input, value) => { (input as HTMLInputElement).value = value; }, key);
  await other.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(other).toHaveURL(/\/pirkiniai\/[0-9a-f-]+/);
  expect(new URL(other.url()).pathname).not.toBe(`/pirkiniai/${id}`);
  await withAppDb(async (client) => {
    const rows = await client.query("SELECT owner_id FROM purchase WHERE submission_key=$1", [key]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].owner_id).not.toBe(rows.rows[1].owner_id);
  });
  await otherContext.close(); await context.close();
});

test("50 įrašų puslapiai nepaslepia likusių pirkinių", async ({ page }) => {
  const email = `pages-${Date.now()}@example.test`;
  await signIn(page, email);
  await withAppDb(async (client) => {
    const user = await client.query('SELECT id FROM "user" WHERE email = $1', [email]);
    await client.query(`INSERT INTO purchase (owner_id, submission_key, product_name, seller, purchase_date)
      SELECT $1, gen_random_uuid(), 'Puslapio prekė ' || n, 'Pardavėjas', '2024-01-01'
      FROM generate_series(1, 51) AS n`, [user.rows[0].id]);
  });
  await page.goto("/pirkiniai?sort=oldest");
  await expect(page.locator(".purchase-card")).toHaveCount(50);
  await page.getByRole("link", { name: "Kitas puslapis" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator(".purchase-card")).toHaveCount(1);
  await page.getByRole("link", { name: "Ankstesnis puslapis" }).click();
  await expect(page.locator(".purchase-card")).toHaveCount(50);
  await page.getByRole("link", { name: "Kitas puslapis" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator(".purchase-card")).toHaveCount(1);
  await page.locator(".purchase-card").click();
  await page.getByRole("button", { name: "Ištrinti pirkinį" }).click();
  await page.getByRole("button", { name: "Ištrinti", exact: true }).click();
  await expect(page).toHaveURL(/\/pirkiniai\?sort=oldest&busena=istrinta$/);
  await expect(page.locator(".purchase-card")).toHaveCount(50);
  await expect(page.getByRole("heading", { name: "Dar neturi pirkinių" })).toHaveCount(0);
  await page.goto("/pirkiniai?page=999&sort=oldest");
  await expect(page).toHaveURL(/\/pirkiniai\?sort=oldest$/);
  await expect(page.locator(".purchase-card")).toHaveCount(50);
  await page.goto("/pirkiniai?page=999&q=nerasta&sort=oldest");
  await expect(page).toHaveURL(/\/pirkiniai\?q=nerasta&sort=oldest$/);
  await expect(page.getByRole("heading", { name: "Pirkinių nerasta" })).toBeVisible();
  await page.goto("/pirkiniai?sort=oldest");
  await expect(page.locator(".purchase-card")).toHaveCount(50);
});

test("filtruoto paskutinio puslapio ištrynimas ir tikras tuščias sąrašas", async ({ browser }) => {
  const suffix = Date.now();
  const owner = await browser.newContext();
  const other = await browser.newContext();
  const a = await owner.newPage();
  const b = await other.newPage();
  const emailA = `filtered-a-${suffix}@example.test`;
  const emailB = `filtered-b-${suffix}@example.test`;
  await signIn(a, emailA);
  await signIn(b, emailB);
  await a.goto("/pirkiniai?page=999");
  await expect(a).toHaveURL(/\/pirkiniai$/);
  await expect(a.getByRole("heading", { name: "Dar neturi pirkinių" })).toBeVisible();
  await withAppDb(async (client) => {
    const users = await client.query('SELECT id, email FROM "user" WHERE email = ANY($1)', [[emailA, emailB]]);
    const ids = new Map(users.rows.map((row) => [row.email, row.id]));
    await client.query(`INSERT INTO purchase (owner_id, submission_key, product_name, seller, purchase_date)
      SELECT $1, gen_random_uuid(), 'Filtruota prekė ' || n, 'Pardavėjas', '2024-01-01'
      FROM generate_series(1, 51) AS n`, [ids.get(emailA)]);
    await client.query(`INSERT INTO purchase (owner_id, submission_key, product_name, seller, purchase_date)
      SELECT $1, gen_random_uuid(), 'Kito savininko prekė ' || n, 'Pardavėjas', '2024-01-01'
      FROM generate_series(1, 51) AS n`, [ids.get(emailB)]);
  });
  await a.goto("/pirkiniai?q=Filtruota&sort=oldest&page=2");
  await expect(a.locator(".purchase-card")).toHaveCount(1);
  await a.locator(".purchase-card").click();
  await a.getByRole("button", { name: "Ištrinti pirkinį" }).click();
  await a.getByRole("button", { name: "Ištrinti", exact: true }).click();
  await expect(a).toHaveURL(/\/pirkiniai\?q=Filtruota&sort=oldest&busena=istrinta$/);
  await expect(a.locator(".purchase-card")).toHaveCount(50);
  await a.goto("/pirkiniai?q=Filtruota&sort=oldest&page=999");
  await expect(a).toHaveURL(/\/pirkiniai\?q=Filtruota&sort=oldest$/);
  await a.goto("/pirkiniai?q=neatitinka&page=999");
  await expect(a).toHaveURL(/\/pirkiniai\?q=neatitinka$/);
  await expect(a.getByRole("heading", { name: "Pirkinių nerasta" })).toBeVisible();
  await a.goto("/pirkiniai?q=Kito&page=999");
  await expect(a).toHaveURL(/\/pirkiniai\?q=Kito$/);
  await expect(a.getByRole("heading", { name: "Pirkinių nerasta" })).toBeVisible();
  await b.goto("/pirkiniai?page=999");
  await expect(b).toHaveURL(/\/pirkiniai\?page=2$/);
  await expect(b.locator(".purchase-card")).toHaveCount(1);
  await owner.close(); await other.close();
});

test("duomenų bazė reikalauja valiutos prie kainos su ribota role", async ({ page }) => {
  const email = `currency-check-${Date.now()}@example.test`;
  await signIn(page, email);
  await withAppDb(async (client) => {
    const user = await client.query('SELECT id FROM "user" WHERE email = $1', [email]);
    const ownerId = user.rows[0].id;
    async function insert(price: string | null, currency: string | null) {
      return client.query(`INSERT INTO purchase (owner_id, submission_key, product_name, seller, purchase_date, price, currency)
        VALUES ($1, gen_random_uuid(), 'Bandomoji prekė', 'Pardavėjas', '2024-01-01', $2, $3)
        RETURNING price::text, currency`, [ownerId, price, currency]);
    }
    await expect(insert("12.50", null)).rejects.toMatchObject({ code: "23514" });
    await expect(insert("12.50", "JPY")).rejects.toMatchObject({ code: "23514" });
    await expect(insert(null, "EUR")).rejects.toMatchObject({ code: "23514" });
    expect((await insert("12.50", "EUR")).rows[0]).toMatchObject({ price: "12.50", currency: "EUR" });
    expect((await insert(null, null)).rows[0]).toMatchObject({ price: null, currency: null });
  });
});

test("garantijos būsena, patvirtinimas, konfliktas ir filtravimas prieš puslapiavimą", async ({ browser }) => {
  const suffix = Date.now();
  const owner = await browser.newContext({ viewport: { width: 320, height: 720 } });
  const other = await browser.newContext();
  const page = await owner.newPage(); const foreign = await other.newPage();
  const email = `warranty-${suffix}@example.test`;
  await signIn(page, email);
  await page.goto("/pirkiniai/naujas");
  await page.getByLabel("Prekės pavadinimas").fill("Ilga garantijos prekė");
  await page.getByLabel("Pardavėjas").fill("Pardavėjas");
  await page.getByLabel("Pirkimo data").fill("2024-01-31");
  await page.getByLabel("Garantijos būsena").selectOption("known");
  await page.getByLabel("Kaip nurodysi pabaigą?").selectOption("duration");
  await page.getByLabel("Trukmė mėnesiais (1–600)").fill("48");
  await expect(page.getByText("Siūloma pabaigos data:")).toContainText("2028");
  await page.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(page.getByText("Patvirtink pasirinktą garantijos pabaigos datą.")).toBeVisible();
  await page.getByLabel(/Patvirtinu garantijos pabaigos datą/).check();
  await page.getByLabel("Trukmė mėnesiais (1–600)").fill("49");
  await expect(page.getByLabel(/Patvirtinu garantijos pabaigos datą/)).not.toBeChecked();
  await page.getByLabel("Trukmė mėnesiais (1–600)").fill("48");
  await page.getByLabel(/Patvirtinu garantijos pabaigos datą/).check();
  await page.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(page).toHaveURL(/\/pirkiniai\/[0-9a-f-]+/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByText("Pabaigos data:")).toContainText("2028");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1024, height: 768 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const row = await withAppDb(async (client) => (await client.query("SELECT warranty_state,warranty_end_date::text,warranty_duration_months,warranty_source,revision FROM purchase WHERE id=$1", [id])).rows[0]);
  expect(row).toMatchObject({ warranty_state: "known", warranty_end_date: "2028-01-31", warranty_duration_months: 48, warranty_source: "duration", revision: 1 });
  await page.goto(`/pirkiniai/${id}/redaguoti`);
  await expect(page.getByLabel(/Patvirtinu garantijos pabaigos datą/)).toBeChecked();
  const stale = await owner.newPage(); await stale.goto(`/pirkiniai/${id}/redaguoti`);
  await page.getByLabel("Garantijos būsena").selectOption("none");
  await page.getByRole("button", { name: "Išsaugoti pakeitimus" }).click();
  await expect(page.getByText("Pažymėta: garantijos nėra")).toBeVisible();
  await page.getByRole("link", { name: "Nustatymai" }).click();
  await page.getByRole("button", { name: "Atsijungti" }).click();
  await signIn(page, email);
  await page.goto(`/pirkiniai/${id}`);
  await expect(page.getByText("Pažymėta: garantijos nėra")).toBeVisible();
  await stale.getByLabel("Prekės pavadinimas").fill("Pasenęs pakeitimas");
  await stale.getByRole("button", { name: "Išsaugoti pakeitimus" }).click();
  await expect(stale.getByText(/Pirkinys pasikeitė kitur/)).toBeVisible();
  await expect(stale.getByLabel("Prekės pavadinimas")).toHaveValue("Pasenęs pakeitimas");
  await withAppDb(async (client) => {
    const current = await client.query("SELECT warranty_state,warranty_end_date,warranty_duration_months,warranty_source FROM purchase WHERE id=$1", [id]);
    expect(current.rows[0]).toMatchObject({ warranty_state: "none", warranty_end_date: null, warranty_duration_months: null, warranty_source: null });
    await expect(client.query("UPDATE purchase SET warranty_state='known' WHERE id=$1", [id])).rejects.toMatchObject({ code: "23514" });
    await expect(client.query("UPDATE purchase SET warranty_state='known',warranty_end_date='infinity',warranty_source='date' WHERE id=$1", [id])).rejects.toMatchObject({ code: "23514" });
    const user = await client.query('SELECT id FROM "user" WHERE email=$1', [email]);
    await client.query(`INSERT INTO purchase (owner_id,submission_key,product_name,seller,purchase_date)
      SELECT $1,gen_random_uuid(),'Kita prekė ' || n,'Pardavėjas','2024-01-01' FROM generate_series(1,51) n`, [user.rows[0].id]);
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vilnius", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    for (const [name, days] of [["Greitai", 30], ["Vėliau", 31], ["Pasibaigusi", -1]] as const) {
      await client.query(`INSERT INTO purchase (owner_id,submission_key,product_name,seller,purchase_date,warranty_state,warranty_end_date,warranty_source)
        VALUES ($1,gen_random_uuid(),$2,'Pardavėjas','2024-01-01','known',$3::date + $4::integer,'date')`, [user.rows[0].id,name,today,days]);
    }
  });
  await page.goto("/pirkiniai?sort=expiry");
  await expect(page.locator(".purchase-card strong").first()).toHaveText("Greitai");
  await expect(page.locator(".purchase-card strong").nth(1)).toHaveText("Vėliau");
  await expect(page.locator(".purchase-card strong").nth(2)).toHaveText("Pasibaigusi");
  await page.goto("/pirkiniai?warranty=valid");
  await expect(page.locator(".purchase-card")).toHaveCount(2);
  await page.goto("/pirkiniai?warranty=soon");
  await expect(page.locator(".purchase-card")).toHaveCount(1);
  await expect(page.locator(".purchase-card")).toContainText("Greitai baigsis");
  await page.goto("/pirkiniai?warranty=expired");
  await expect(page.locator(".purchase-card")).toHaveCount(1);
  await expect(page.locator(".purchase-card")).toContainText("Pasibaigė");
  await page.goto("/pirkiniai?warranty=none");
  await expect(page.locator(".purchase-card")).toHaveCount(1);
  await expect(page.locator(".purchase-card")).toContainText("Ilga garantijos prekė");
  await page.getByLabel("Garantijos filtras").selectOption("unknown");
  await page.getByRole("button", { name: "Rodyti" }).click();
  await expect(page.locator(".purchase-card")).toHaveCount(50);
  await page.getByRole("link", { name: "Kitas puslapis" }).click();
  await expect(page.locator(".purchase-card")).toHaveCount(1);
  await signIn(foreign, `warranty-other-${suffix}@example.test`);
  await foreign.goto(`/pirkiniai/${id}`);
  await expect(foreign.getByRole("heading", { name: "Pirkinys nerastas" })).toBeVisible();
  await foreign.goto("/pirkiniai?warranty=none");
  await expect(foreign.locator(".purchase-card")).toHaveCount(0);
  await owner.close(); await other.close();
});

test("garantiją ir jos filtrą galima valdyti klaviatūra", async ({ page }) => {
  await signIn(page, `warranty-keyboard-${Date.now()}@example.test`);
  await page.goto("/pirkiniai/naujas");
  await page.getByLabel("Prekės pavadinimas").fill("Klaviatūros garantija");
  await page.getByLabel("Pardavėjas").fill("Pardavėjas");
  await page.getByLabel("Pirkimo data").fill("2024-01-31");
  const state = page.getByLabel("Garantijos būsena");
  await tabTo(page, state);
  await page.keyboard.press("n");
  await expect(state).toHaveValue("known");
  const mode = page.getByLabel("Kaip nurodysi pabaigą?");
  await tabTo(page, mode);
  await page.keyboard.press("n");
  await expect(mode).toHaveValue("duration");
  const months = page.getByLabel("Trukmė mėnesiais (1–600)");
  await tabTo(page, months);
  await page.keyboard.type("48");
  const confirm = page.getByLabel(/Patvirtinu garantijos pabaigos datą/);
  await tabTo(page, confirm);
  await page.keyboard.press("Space");
  await expect(confirm).toBeChecked();
  await tabTo(page, page.getByRole("button", { name: "Išsaugoti", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Klaviatūros garantija" })).toBeVisible();
  await page.goto("/pirkiniai");
  const filter = page.getByLabel("Garantijos filtras");
  await expect(filter).toBeVisible();
  await tabTo(page, filter);
  await page.keyboard.press("p");
  await expect(filter).toHaveValue("expired");
  await tabTo(page, page.getByRole("button", { name: "Rodyti" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Pirkinių nerasta" })).toBeVisible();
  await tabTo(page, page.getByRole("link", { name: "Išvalyti filtrus" }));
  await page.keyboard.press("Enter");
  await expect(page.locator(".purchase-card")).toHaveCount(1);
});

test("kita paskyra negali vykdyti žinomo įrašo keitimo ar trynimo veiksmo", async ({ browser }) => {
  const suffix = Date.now();
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pageA = await a.newPage();
  const pageB = await b.newPage();
  await signIn(pageA, `action-a-${suffix}@example.test`);
  await signIn(pageB, `action-b-${suffix}@example.test`);
  await pageA.goto("/pirkiniai/naujas");
  await pageA.getByLabel("Prekės pavadinimas").fill("Savininko prekė");
  await pageA.getByLabel("Pardavėjas").fill("Pardavėjas");
  await pageA.getByLabel("Pirkimo data").fill("2024-01-01");
  await pageA.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(pageA.getByRole("heading", { name: "Savininko prekė" })).toBeVisible();
  const id = new URL(pageA.url()).pathname.split("/").pop()!;
  await pageA.getByRole("link", { name: "Redaguoti" }).click();
  await pageA.getByLabel("Prekės pavadinimas").fill("Pirmas pakeitimas");
  type Captured = { url: string; headers: Record<string, string>; body: Buffer };
  let editRequest: Captured | undefined;
  pageA.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"] && request.url().includes("redaguoti")) {
      editRequest = { url: request.url(), headers: request.headers(), body: request.postDataBuffer()! };
    }
  });
  await pageA.getByRole("button", { name: "Išsaugoti pakeitimus" }).click();
  await expect(pageA.getByRole("heading", { name: "Pirmas pakeitimas" })).toBeVisible();
  expect(editRequest).toBeDefined();
  await pageA.getByRole("link", { name: "Redaguoti" }).click();
  await pageA.getByLabel("Prekės pavadinimas").fill("Galutinis pavadinimas");
  await pageA.getByRole("button", { name: "Išsaugoti pakeitimus" }).click();
  await expect(pageA.getByRole("heading", { name: "Galutinis pavadinimas" })).toBeVisible();
  const replay = async (captured: Captured) => {
    const headers = { ...captured.headers };
    delete headers.cookie; delete headers.host; delete headers["content-length"];
    return b.request.post(captured.url, { headers, data: captured.body });
  };
  await replay(editRequest!);
  await withAppDb(async (client) => {
    const result = await client.query("SELECT product_name FROM purchase WHERE id = $1", [id]);
    expect(result.rows[0].product_name).toBe("Galutinis pavadinimas");
  });
  let deleteRequest: Captured | undefined;
  await pageA.route("**/pirkiniai/**", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      deleteRequest = { url: request.url(), headers: request.headers(), body: request.postDataBuffer()! };
      await route.abort();
    } else await route.continue();
  });
  await pageA.getByRole("button", { name: "Ištrinti pirkinį" }).click();
  await pageA.getByRole("button", { name: "Ištrinti", exact: true }).click();
  await expect.poll(() => Boolean(deleteRequest)).toBe(true);
  await replay(deleteRequest!);
  await withAppDb(async (client) => {
    const result = await client.query("SELECT product_name, deleted_at FROM purchase WHERE id = $1", [id]);
    expect(result.rows[0]).toMatchObject({ product_name: "Galutinis pavadinimas", deleted_at: null });
  });
  await a.close(); await b.close();
});

test("atšaukta sesija negali atverti pirkinio", async ({ page }) => {
  const email = `revoked-purchase-${Date.now()}@example.test`;
  await signIn(page, email);
  await page.goto("/pirkiniai/naujas");
  await page.getByLabel("Prekės pavadinimas").fill("Prieigos įrašas");
  await page.getByLabel("Pardavėjas").fill("Pardavėjas");
  await page.getByLabel("Pirkimo data").fill("2024-01-01");
  await page.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Prieigos įrašas" })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await withAppDb(async (client) => {
    await client.query(`UPDATE session SET expires_at = now() - interval '1 second'
      WHERE user_id = (SELECT id FROM "user" WHERE email = $1)`, [email]);
  });
  await page.goto(`/pirkiniai/${id}`);
  await expect(page).toHaveURL(/\/prisijungti/);
  await page.goto(`/pirkiniai/${id}/redaguoti`);
  await expect(page).toHaveURL(/\/prisijungti/);
  await page.goto("/pirkiniai");
  await expect(page).toHaveURL(/\/prisijungti/);
});
