import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { createHmac } from "node:crypto";

type Mail = { ID: string; To: { Address: string }[] };
const endpoint = "/api/auth/sign-in/magic-link";
const headers = { Origin: process.env.APP_URL ?? "http://127.0.0.1:3100" };
const callbacks = { callbackURL: "/pradzia", errorCallbackURL: "/prisijungti/nuoroda-nebegalioja" };
const rateHeaders = () => ({ ...headers, "X-Forwarded-For": `198.51.${1 + Math.floor(Math.random() * 254)}.${1 + Math.floor(Math.random() * 254)}` });

async function messagesFor(email: string): Promise<Mail[]> {
  const response = await fetch("http://localhost:1080/api/v1/messages");
  const { messages } = await response.json() as { messages: Mail[] };
  return messages.filter((entry) => entry.To.some((to) => to.Address === email));
}

async function quotaCountFor(email: string): Promise<number> {
  const key = createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(email.toLowerCase()).digest("hex");
  const client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<{ count: number }>("SELECT count FROM email_send_limit WHERE key = $1", [key]);
    return result.rows[0]?.count ?? 0;
  } finally { await client.end(); }
}

async function newestLinkFor(email: string) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const message = (await messagesFor(email))[0];
    if (message) {
      const detail = await fetch(`http://localhost:1080/api/v1/message/${message.ID}`);
      const text = (await detail.json() as { Text: string }).Text;
      const match = text.match(/https?:\/\/[^\s]+/);
      if (!match) throw new Error("Laiške nėra prisijungimo nuorodos");
      return match[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Vietiniame SMTP negautas prisijungimo laiškas");
}

async function requestLink(page: Page, email: string) {
  await page.goto("/prisijungti");
  await page.getByLabel("El. pašto adresas").fill(email);
  await page.getByRole("button", { name: "Siųsti prisijungimo nuorodą" }).click();
  await expect(page.getByRole("heading", { name: "Patikrink el. paštą" })).toBeVisible();
  return newestLinkFor(email);
}

test("tikras el. pašto nuorodos gyvavimo ciklas ir paskyrų izoliacija", async ({ browser }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailA = `a-${suffix}@example.test`;
  const emailB = `b-${suffix}@example.test`;
  const a = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageA = await a.newPage();
  await pageA.goto("/pradzia");
  await expect(pageA).toHaveURL(/\/prisijungti/);
  const linkA = await requestLink(pageA, emailA);
  await pageA.goto(linkA);
  await expect(pageA).toHaveURL(/\/pradzia/);
  await expect(pageA.getByRole("heading", { name: "Pradžia" })).toBeVisible();
  await pageA.reload();
  await expect(pageA.getByRole("heading", { name: "Dar neturite pirkinių" })).toBeVisible();
  await expect(pageA.getByRole("link", { name: "Pridėti čekį" }).first()).toHaveAttribute("href", "/prideti");
  await pageA.getByRole("link", { name: "Nustatymai" }).click();
  await expect(pageA.getByText(emailA)).toBeVisible();
  await expect(pageA.getByText(emailB)).toHaveCount(0);
  await expect(pageA.getByRole("link", { name: "Pirkiniai" })).toHaveAttribute("href", "/pirkiniai");

  const b = await browser.newContext({ viewport: { width: 320, height: 720 } });
  const pageB = await b.newPage();
  const linkB = await requestLink(pageB, emailB);
  await pageB.goto(linkB);
  await pageB.getByRole("link", { name: "Nustatymai" }).click();
  await expect(pageB.getByText(emailB)).toBeVisible();
  await expect(pageB.getByText(emailA)).toHaveCount(0);
  expect(await pageB.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const replay = await browser.newContext();
  const replayPage = await replay.newPage();
  await replayPage.goto(linkA);
  await expect(replayPage.getByRole("heading", { name: "Nuoroda nebegalioja" })).toBeVisible();
  await replay.close();

  const sibling = await a.newPage();
  await sibling.goto("/nustatymai");
  await expect(sibling.getByText(emailA)).toBeVisible();
  await pageA.getByRole("button", { name: "Atsijungti" }).click();
  await expect(pageA).toHaveURL(/\/prisijungti/);
  await sibling.goto("/nustatymai");
  await expect(sibling).toHaveURL(/\/prisijungti/);
  expect((await a.cookies()).some((cookie) => cookie.name.endsWith("session_token"))).toBe(false);
  await pageA.goto("/nustatymai");
  await expect(pageA).toHaveURL(/\/prisijungti/);
  const linkAgain = await requestLink(pageA, emailA);
  await pageA.goto(linkAgain);
  await pageA.getByRole("link", { name: "Nustatymai" }).click();
  await expect(pageA.getByText(emailA)).toBeVisible();
  const client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await client.connect();
  try {
    const rows = await client.query(`SELECT count(*)::integer AS total FROM "user" WHERE email = $1`, [emailA]);
    expect(rows.rows[0].total).toBe(1);
  } finally { await client.end(); }
  await a.close(); await b.close();
});

test("pasibaigusi nuoroda ir sesija nesuteikia prieigos", async ({ browser }) => {
  const email = `expiry-${Date.now()}@example.test`;
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/api/auth/magic-link/verify?token=not-a-real-token&callbackURL=%2Fpradzia&errorCallbackURL=%2Fprisijungti%2Fnuoroda-nebegalioja");
  await expect(page.getByRole("heading", { name: "Nuoroda nebegalioja" })).toBeVisible();
  const link = await requestLink(page, email);
  const client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await client.connect();
  try {
    await client.query(`UPDATE verification SET expires_at = now() - interval '1 second'
      WHERE id = (SELECT id FROM verification WHERE value::jsonb->>'email' = $1 ORDER BY created_at DESC LIMIT 1)`, [email]);
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Nuoroda nebegalioja" })).toBeVisible();
    const fresh = await requestLink(page, email);
    await page.goto(fresh);
    await expect(page).toHaveURL(/\/pradzia/);
    await client.query(`UPDATE session SET expires_at = now() - interval '1 second'
      WHERE user_id = (SELECT id FROM "user" WHERE email = $1)`, [email]);
    await page.goto("/nustatymai");
    await expect(page).toHaveURL(/\/prisijungti/);
    await expect(page.getByText(email)).toHaveCount(0);
  } finally { await client.end(); await context.close(); }
});

test("viena nuoroda negali sukurti dviejų sesijų lygiagrečiai", async ({ browser }) => {
  const email = `race-${Date.now()}@example.test`;
  const setup = await browser.newPage();
  const link = await requestLink(setup, email);
  await setup.close();
  const first = await browser.newContext();
  const second = await browser.newContext();
  const pages = [await first.newPage(), await second.newPage()];
  await Promise.all(pages.map((page) => page.goto(link)));
  const successes = pages.filter((page) => new URL(page.url()).pathname === "/pradzia").length;
  expect(successes).toBe(1);
  const client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await client.connect();
  try {
    const accounts = await client.query(`SELECT count(*)::integer AS total FROM "user" WHERE email = $1`, [email]);
    const sessions = await client.query(`SELECT count(*)::integer AS total FROM session
      WHERE user_id = (SELECT id FROM "user" WHERE email = $1)`, [email]);
    expect(accounts.rows[0].total).toBe(1);
    expect(sessions.rows[0].total).toBe(1);
  } finally { await client.end(); await first.close(); await second.close(); }
});

test("atmeta išorinį nukreipimą ir riboja pakartotinį siuntimą", async ({ request }) => {
  const email = `limit-${Date.now()}@example.test`;
  const scopedHeaders = rateHeaders();
  const external = await request.post(endpoint, { headers: scopedHeaders, data: { email, callbackURL: "//evil.example" } });
  expect(external.status()).toBe(400);
  const externalError = await request.post(endpoint, { headers: scopedHeaders, data: { email, ...callbacks, errorCallbackURL: "https://evil.example" } });
  expect(externalError.status()).toBe(400);
  for (const callbackURL of ["https://evil.example", "%2F%2Fevil.example", "not/a/path"]) {
    expect((await request.post(endpoint, { headers: scopedHeaders, data: { email, ...callbacks, callbackURL } })).status()).toBe(400);
  }
  expect((await request.post(endpoint, { headers: scopedHeaders, data: { email, ...callbacks, newUserCallbackURL: "//evil.example" } })).status()).toBe(400);
  expect(await quotaCountFor(email)).toBe(0);
  for (let index = 0; index < 5; index++) {
    const result = await request.post(endpoint, { headers: scopedHeaders, data: { email, ...callbacks } });
    expect(result.ok()).toBe(true);
  }
  const limited = await request.post(endpoint, { headers: scopedHeaders, data: { email, ...callbacks } });
  expect(limited.status()).toBe(429);
});

test("lygiagrečių siuntimų limitas išlieka tikslus", async ({ request }) => {
  const email = `parallel-limit-${Date.now()}@example.test`;
  const scopedHeaders = rateHeaders();
  const results = await Promise.all(Array.from({ length: 8 }, () => request.post("/api/auth/sign-in/magic-link", {
    headers: scopedHeaders,
    data: { email, ...callbacks },
  })));
  expect(results.filter((result) => result.status() === 200)).toHaveLength(5);
  expect(results.filter((result) => result.status() === 429)).toHaveLength(3);
  expect(await quotaCountFor(email)).toBe(5);
});

test("nepatikimos ir neteisingos užklausos nemažina el. pašto limito", async ({ request }) => {
  const email = `rejected-${Date.now()}@example.test`;
  const scopedHeaders = rateHeaders();
  const badHeaders = { ...scopedHeaders, Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate" };
  for (let index = 0; index < 6; index++) {
    expect((await request.post(endpoint, { headers: badHeaders, data: { email, ...callbacks } })).status()).toBe(403);
  }
  expect((await request.post(endpoint, { headers: scopedHeaders, data: { email, ...callbacks, metadata: "invalid" } })).status()).toBe(400);
  expect(await quotaCountFor(email)).toBe(0);
  expect(await messagesFor(email)).toHaveLength(0);
  for (let index = 0; index < 5; index++) {
    expect((await request.post(endpoint, { headers: scopedHeaders, data: { email, ...callbacks } })).status()).toBe(200);
  }
  expect(await quotaCountFor(email)).toBe(5);
  expect(await messagesFor(email)).toHaveLength(5);
});

test("trūkstami nukreipimai atmetami, tikra nuoroda veikia", async ({ browser, request }) => {
  const email = `callback-${Date.now()}@example.test`;
  const scopedHeaders = rateHeaders();
  expect((await request.post(endpoint, { headers: scopedHeaders, data: { email, errorCallbackURL: callbacks.errorCallbackURL } })).status()).toBe(400);
  expect((await request.post(endpoint, { headers: scopedHeaders, data: { email, callbackURL: callbacks.callbackURL } })).status()).toBe(400);
  expect(await quotaCountFor(email)).toBe(0);
  expect(await messagesFor(email)).toHaveLength(0);
  expect((await request.post(endpoint, { headers: scopedHeaders, data: { email, ...callbacks } })).status()).toBe(200);
  const link = await newestLinkFor(email);
  const url = new URL(link);
  expect(url.searchParams.get("callbackURL")).toBe(callbacks.callbackURL);
  expect(url.searchParams.get("errorCallbackURL")).toBe(callbacks.errorCallbackURL);
  const page = await browser.newPage();
  await page.goto(link);
  await expect(page).toHaveURL(/\/pradzia/);
  await page.close();
});

test("bibliotekos užklausų limitas neišnaudoja el. pašto kvotos", async ({ request }) => {
  const email = `library-limit-${Date.now()}@example.test`;
  const scopedHeaders = rateHeaders();
  let limited = false;
  for (let index = 0; index < 40; index++) {
    const response = await request.post(endpoint, { headers: scopedHeaders, data: { email, ...callbacks, metadata: "invalid" } });
    if (response.status() === 429) { limited = true; break; }
    expect(response.status()).toBe(400);
  }
  expect(limited).toBe(true);
  expect((await request.post(endpoint, { headers: scopedHeaders, data: { email, ...callbacks } })).status()).toBe(429);
  expect(await quotaCountFor(email)).toBe(0);
  expect(await messagesFor(email)).toHaveLength(0);
});
