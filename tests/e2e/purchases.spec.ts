import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

type Mail = { ID: string; To: { Address: string }[] };
async function signIn(page: Page, email: string) {
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
  await page.getByLabel("Rikiuoti pagal pirkimo datą").selectOption("oldest");
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
  await expect(second).toHaveURL(new RegExp(`/pirkiniai/${id}`));
  await expect(second.getByRole("heading", { name: "Pakeistas" })).toBeVisible();
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
