import { expect, test } from "@playwright/test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import sharp from "sharp";

async function signIn(page: import("@playwright/test").Page) {
  const email = `simplified-${randomUUID()}@example.test`;
  const ip = randomBytes(2);
  await page.setExtraHTTPHeaders({ "X-Forwarded-For": `198.51.${ip[0]}.${ip[1]}` });
  await page.goto("/prisijungti");
  await page.getByLabel("El. pašto adresas").fill(email);
  await page.getByRole("button", { name: "Siųsti prisijungimo nuorodą" }).click();
  await expect(page.getByRole("heading", { name: "Patikrink el. paštą" })).toBeVisible();
  let id = "";
  for (let i = 0; i < 40; i++) {
    const response = await fetch("http://localhost:1080/api/v1/messages");
    const { messages } = await response.json() as { messages: { ID: string; To: { Address: string }[] }[] };
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

test("compact receipt entry saves an incomplete original, then completes the same product", async ({ page }) => {
  test.setTimeout(120000);
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/prideti");
  await expect(page.locator("button.choice-card", { hasText: "Fotografuoti čekį" })).toBeVisible();
  await expect(page.locator("button.choice-card", { hasText: "Įkelti failą" })).toBeVisible();
  await expect(page.getByLabel("Garantijos būsena")).toHaveCount(0);
  const original = await sharp({ create: { width: 12, height: 12, channels: 3, background: "white" } }).png().toBuffer();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator("button.choice-card", { hasText: "Įkelti failą" }).click()]);
  await chooser.setFiles({ name: "blank.png", mimeType: "image/png", buffer: original });
  await expect(page.getByLabel("Išskleisti čekio peržiūrą")).toBeVisible();
  await page.screenshot({ path: "test-results/receipt-entry-390.png", fullPage: true });
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Išskleisti čekio peržiūrą").click();
  await expect(page.getByAltText(/čekio peržiūra/i)).toBeVisible();
  await page.getByText("Daugiau informacijos").click();
  await page.getByLabel("Kaina (neprivaloma)").fill("12.345");
  await page.getByText("Daugiau informacijos").click();
  await page.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(page.locator(".receipt-more")).toHaveAttribute("open", "");
  await expect(page.getByText("Įvesk tinkamą kainą")).toBeVisible();
  await page.getByLabel("Kaina (neprivaloma)").fill("12,5");
  await page.getByLabel("Valiuta").selectOption("EUR");
  await page.getByLabel("Čekio numeris (neprivaloma)").fill("BLANK-1");
  await page.getByText("Daugiau informacijos").click();
  await page.getByRole("button", { name: "Išsaugoti", exact: true }).click();
  await expect(page).toHaveURL(/\/pirkiniai\/[0-9a-f-]+\?busena=cekis-pridetas/);
  const purchaseId = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByRole("heading", { name: "Čekis be pavadinimo" })).toBeVisible();
  await expect(page.getByText("Garantijos pabaiga nežinoma")).toBeVisible();
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  try {
    const purchase = (await client.query("SELECT product_name,seller,purchase_date,price,warranty_duration_months,warranty_end_date,warranty_origin FROM purchase WHERE id=$1", [purchaseId])).rows[0];
    expect(purchase).toMatchObject({ product_name: "", seller: "", purchase_date: null, price: "12.50", warranty_duration_months: 24, warranty_end_date: null, warranty_origin: "automatic" });
    const receipt = (await client.query("SELECT r.id,r.receipt_number FROM receipt r JOIN purchase_receipt pr ON pr.receipt_id=r.id WHERE pr.purchase_id=$1", [purchaseId])).rows[0];
    expect(receipt.receipt_number).toBe("BLANK-1");
    const response = await page.request.get(`/api/receipts/${receipt.id}/content`);
    expect(response.status()).toBe(200);
    expect(createHash("sha256").update(await response.body()).digest("hex")).toBe(createHash("sha256").update(original).digest("hex"));
  } finally { await client.end(); }
  await page.goto(`/pirkiniai/${purchaseId}/redaguoti`);
  await page.getByLabel("Prekės pavadinimas").fill("Patikslinta prekė");
  await page.getByLabel("Pardavėjas").fill("Parduotuvė");
  await page.getByLabel("Pirkimo data").fill("2024-02-29");
  await page.getByRole("button", { name: "Išsaugoti pakeitimus" }).click();
  await expect(page).toHaveURL(/\/pirkiniai\/[0-9a-f-]+\?busena=atnaujinta/);
  await expect(page.getByText(/Garantija iki/)).toContainText("2026");
  const after = new Client({ connectionString: process.env.DATABASE_URL }); await after.connect();
  try {
    const row = (await after.query("SELECT warranty_end_date::text,warranty_origin FROM purchase WHERE id=$1", [purchaseId])).rows[0];
    expect(row).toMatchObject({ warranty_end_date: "2026-02-28", warranty_origin: "automatic" });
  } finally { await after.end(); }
  await page.getByRole("button", { name: "Keisti garantiją" }).click();
  await page.getByLabel("Garantijos būsena").selectOption("none");
  await page.getByRole("button", { name: "Išsaugoti garantiją" }).click();
  await expect(page.getByText("Pažymėta: garantijos nėra")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
