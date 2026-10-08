import { expect,test,type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

type Mail = { ID:string; Subject:string; To:{Address:string}[] };
const workerHeaders = { Authorization: `Bearer ${process.env.REMINDER_WORKER_SECRET}` };
const today = process.env.REMINDER_TEST_NOW!.slice(0,10);
function plusDays(date:string, days:number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate()+days);
  return value.toISOString().slice(0,10);
}
async function db<T>(task:(client:Client)=>Promise<T>) {
  const client = new Client({ connectionString:process.env.DATABASE_URL });
  await client.connect(); try { return await task(client); } finally { await client.end(); }
}
async function messagesFor(email:string):Promise<Mail[]> {
  const response = await fetch("http://localhost:1080/api/v1/messages");
  const body = await response.json() as { messages:Mail[] };
  return body.messages.filter((message)=>message.Subject === "Čekis: artėja išsaugotos garantijos pabaiga" && message.To.some((to)=>to.Address===email));
}
async function signIn(page:Page,email:string) {
  await page.goto("/prisijungti");
  await page.getByLabel("El. pašto adresas").fill(email);
  await page.getByRole("button",{name:"Siųsti prisijungimo nuorodą"}).click();
  await expect(page.getByRole("heading",{name:"Patikrink el. paštą"})).toBeVisible();
  let id="";
  for(let attempt=0;attempt<40;attempt++) {
    const result = await fetch("http://localhost:1080/api/v1/messages");
    const body = await result.json() as { messages:Mail[] };
    id=body.messages.find((mail)=>mail.Subject === "Prisijungimas prie Čekis" && mail.To.some((to)=>to.Address===email))?.ID ?? "";
    if(id) break;
    await new Promise((resolve)=>setTimeout(resolve,250));
  }
  expect(id).not.toBe("");
  const detail = await fetch(`http://localhost:1080/api/v1/message/${id}`);
  const link = ((await detail.json()) as {Text:string}).Text.match(/https?:\/\/[^\s]+/)?.[0];
  expect(link).toBeTruthy();
  await page.goto(link!);
  await expect(page).toHaveURL(/\/pradzia/);
}
async function makePurchase(page:Page, name:string) {
  const response = await page.request.post("/api/purchases",{ headers:{Origin:process.env.APP_URL!},data:{
    key:randomUUID(),fields:{productName:name,seller:"Bandomoji parduotuvė",purchaseDate:plusDays(today,-160),price:"",currency:"EUR",notes:""},
    warranty:{warrantyState:"known",warrantyEndDate:"",warrantyDurationMonths:"6",warrantySource:"duration",warrantyConfirmed:true},
  }});
  expect(response.status()).toBe(200);
  return (await response.json() as {id:string}).id;
}
async function runWorker(page:Page) {
  const response = await page.request.post("/api/reminders/worker",{ headers:workerHeaders });
  expect(response.status()).toBe(200);
  return await response.json() as { claimed:number;accepted:number;uncertain:number };
}
async function enable(page:Page) {
  await page.goto("/nustatymai");
  await expect(page.getByText("Priminimų siuntimas dar nesukonfigūruotas")).toHaveCount(0);
  await page.getByRole("checkbox",{name:"Įjungti garantijos priminimus el. paštu"}).check();
  await page.getByRole("button",{name:"Išsaugoti priminimus"}).click();
  await expect(page.getByText("Priminimų nustatymai išsaugoti.")).toBeVisible();
}

test("trukmės pakeitimas pakeičia priminimo darbą, o nežinoma būsena jį atšaukia",async({page})=>{
  await signIn(page,`duration-reminder-${randomUUID()}@example.test`);
  await enable(page);
  const id=await makePurchase(page,"Keičiama trukmė");
  const original=await db(async(client)=>(await client.query("SELECT identity,end_date::text,status FROM warranty_reminder WHERE purchase_id=$1",[id])).rows[0]);
  expect(original.status).toBe("pending");
  await page.goto(`/pirkiniai/${id}/redaguoti`);
  await page.getByLabel("Garantijos trukmė").selectOption("12");
  await page.getByRole("button",{name:"Išsaugoti pakeitimus"}).click();
  await expect(page.getByText("Pakeitimai išsaugoti")).toBeVisible();
  const changed=await db(async(client)=>(await client.query("SELECT identity,end_date::text,status FROM warranty_reminder WHERE purchase_id=$1 ORDER BY created_at",[id])).rows);
  expect(changed).toHaveLength(2);
  expect(changed.find((row)=>row.identity===original.identity)?.status).toBe("cancelled");
  expect(changed.find((row)=>row.identity!==original.identity)?.status).toBe("pending");
  await page.goto(`/pirkiniai/${id}/redaguoti`);
  await page.getByRole("button",{name:"Išsaugoti pakeitimus"}).click();
  await expect(page.getByText("Pakeitimai išsaugoti")).toBeVisible();
  expect(await db(async(client)=>(await client.query("SELECT count(*)::int AS n FROM warranty_reminder WHERE purchase_id=$1",[id])).rows[0].n)).toBe(2);
  await page.goto(`/pirkiniai/${id}/redaguoti`);
  await page.getByLabel("Garantijos būsena").selectOption("unknown");
  await page.getByRole("button",{name:"Išsaugoti pakeitimus"}).click();
  await expect(page.getByText("Pakeitimai išsaugoti")).toBeVisible();
  expect(await db(async(client)=>(await client.query("SELECT count(*)::int AS n FROM warranty_reminder WHERE purchase_id=$1 AND status='pending'",[id])).rows[0].n)).toBe(0);
});

async function holdAction(page:Page,path:string) {
  let release!:()=>void, completed!:()=>void, delivered!:()=>void;
  const gate=new Promise<void>((resolve)=>{release=resolve;});
  const serverCompleted=new Promise<void>((resolve)=>{completed=resolve;});
  const responseDelivered=new Promise<void>((resolve)=>{delivered=resolve;});
  const handler=async(route:import("@playwright/test").Route)=>{
    if (route.request().method()!=="POST" || !route.request().headers()["next-action"]) { await route.continue(); return; }
    const response=await route.fetch();
    completed();
    await gate;
    await route.fulfill({response});
    delivered();
  };
  await page.route(`**${path}`,handler);
  return {serverCompleted,release:async()=>{release();await responseDelivered;await page.unroute(`**${path}`,handler);}};
}

test("patvirtintas gavėjas, išsaugotas priminimas ir tikras vietinis SMTP laiškas",async({browser})=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const email=`reminder-${randomUUID()}@example.test`;
  await signIn(page,email);
  const id=await makePurchase(page,"Ilgas <garantijos> pavadinimas");
  const initial=await db(async(client)=>(await client.query("SELECT count(*)::int AS n FROM warranty_reminder WHERE purchase_id=$1",[id])).rows[0].n as number);
  expect(initial).toBe(0);
  const anonymous=await page.request.post("/api/reminders/worker");
  expect(anonymous.status()).toBe(401);
  const invalid=await page.request.post("/api/reminders/worker",{headers:{Authorization:"Bearer neteisinga"}});
  expect(invalid.status()).toBe(401);
  await enable(page);
  const first=await Promise.all([runWorker(page),runWorker(page)]);
  expect(first.reduce((sum,item)=>sum+item.accepted,0)).toBe(1);
  let mails=await messagesFor(email);
  expect(mails).toHaveLength(1);
  const detail=await fetch(`http://localhost:1080/api/v1/message/${mails[0].ID}`);
  const message=await detail.json() as {Text:string;HTML:string};
  expect(message.Text).toContain("Ilgas <garantijos> pavadinimas");
  const expiry=await db(async(client)=>(await client.query("SELECT warranty_end_date::text AS expiry FROM purchase WHERE id=$1",[id])).rows[0].expiry as string);
  expect(message.Text).toContain(`Garantijos pabaiga: ${expiry}`);
  expect(message.Text).toContain(`${process.env.APP_URL}/pirkiniai/${id}`);
  expect(message.Text).toContain("Priminimas pagal jūsų išsaugotą garantijos datą.");
  expect(message.HTML).toContain("&lt;garantijos&gt;");
  await runWorker(page);
  mails=await messagesFor(email);
  expect(mails).toHaveLength(1);
  const persisted=await db(async(client)=>(await client.query("SELECT status,attempts,accepted_at FROM warranty_reminder WHERE purchase_id=$1",[id])).rows[0]);
  expect(persisted).toMatchObject({status:"accepted",attempts:1});
  expect(persisted.accepted_at).toBeTruthy();
  await page.goto(`/pirkiniai/${id}`);
  await expect(page.getByText(/Siuntimo tarnyba priėmė priminimą/)).toBeVisible();
  await page.goto("/nustatymai");
  await page.getByRole("checkbox",{name:"Įjungti garantijos priminimus el. paštu"}).uncheck();
  await page.getByRole("button",{name:"Išsaugoti priminimus"}).click();
  await expect(page.getByText("Priminimų nustatymai išsaugoti.")).toBeVisible();
  await page.reload();
  await page.getByRole("checkbox",{name:"Įjungti garantijos priminimus el. paštu"}).check();
  await page.getByRole("button",{name:"Išsaugoti priminimus"}).click();
  await runWorker(page);
  expect(await messagesFor(email)).toHaveLength(1);
  await page.close();
});

test("pasibaigę nuomos laikai atskiria nebandytą ir galimai priimtą siuntimą",async({browser})=>{
  const page=await browser.newPage({viewport:{width:320,height:740}});
  const email=`lease-${randomUUID()}@example.test`;
  await signIn(page,email);
  await enable(page);
  const before=await makePurchase(page,"Prieš siuntimą");
  const after=await makePurchase(page,"Po siuntimo");
  await db(async(client)=>{
    await client.query(`UPDATE warranty_reminder SET status='processing',claim_token=$2,lease_until=$3,dispatch_authorized_at=NULL
      WHERE purchase_id=$1`,[before,randomUUID(),new Date(new Date(process.env.REMINDER_TEST_NOW!).getTime()-60_000)]);
    await client.query(`UPDATE warranty_reminder SET status='processing',claim_token=$2,lease_until=$3,dispatch_authorized_at=$3,attempts=1
      WHERE purchase_id=$1`,[after,randomUUID(),new Date(new Date(process.env.REMINDER_TEST_NOW!).getTime()-60_000)]);
  });
  const result=await runWorker(page);
  expect(result.accepted).toBe(1);
  const rows=await db(async(client)=>(await client.query("SELECT purchase_id,status,attempts FROM warranty_reminder WHERE purchase_id=ANY($1::uuid[])",[[before,after]])).rows);
  expect(rows.find((row)=>row.purchase_id===before)).toMatchObject({status:"accepted",attempts:1});
  expect(rows.find((row)=>row.purchase_id===after)).toMatchObject({status:"uncertain",attempts:1});
  expect(await messagesFor(email)).toHaveLength(1);
  await runWorker(page);
  expect(await messagesFor(email)).toHaveLength(1);
  await page.close();
});

test("pasenę nustatymai, pirkinio valdiklis ir kitos paskyros prieiga",async({browser})=>{
  const context=await browser.newContext({viewport:{width:320,height:740}});
  const first=await context.newPage();
  const email=`ilgokas-priminimu-gavejas-${randomUUID()}@example.test`;
  await signIn(first,email);
  const id=await makePurchase(first,"Labai ilgas prekės pavadinimas su lietuviškomis raidėmis ąčęėįšųūž ir keliais papildomais žodžiais");
  await first.goto("/nustatymai");
  const staleSettings=await context.newPage(); await staleSettings.goto("/nustatymai");
  await first.getByLabel("Priminti prieš").selectOption("90");
  await first.getByRole("button",{name:"Išsaugoti priminimus"}).click();
  await expect(first.getByText("Priminimų nustatymai išsaugoti.")).toBeVisible();
  await staleSettings.getByLabel("Priminti prieš").selectOption("7");
  await staleSettings.getByRole("button",{name:"Išsaugoti priminimus"}).click();
  await expect(staleSettings.getByText(/Nustatymai pasikeitė kitur/)).toBeVisible();
  await expect(staleSettings.getByLabel("Priminti prieš")).toHaveValue("7");
  await staleSettings.reload();
  await expect(staleSettings.getByLabel("Priminti prieš")).toHaveValue("90");
  await first.goto(`/pirkiniai/${id}`);
  await first.addStyleTag({content:"body { font-size: 22px !important; }"});
  expect(await first.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await first.setViewportSize({width:1024,height:800});
  expect(await first.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
  await first.setViewportSize({width:320,height:740});
  const stalePurchase=await context.newPage(); await stalePurchase.goto(`/pirkiniai/${id}`);
  await first.getByLabel("Šio pirkinio pasirinkimas").selectOption("off");
  await first.getByLabel("Šio pirkinio pasirinkimas").focus();
  await first.keyboard.press("Tab");
  await expect(first.getByRole("button",{name:"Išsaugoti priminimą"})).toBeFocused();
  await first.getByRole("button",{name:"Išsaugoti priminimą"}).click();
  await expect(first.getByText("Pirkinio priminimo pasirinkimas išsaugotas.")).toBeVisible();
  await stalePurchase.getByLabel("Šio pirkinio pasirinkimas").selectOption("custom");
  await stalePurchase.getByLabel("Priminti prieš").selectOption("7");
  await stalePurchase.getByRole("button",{name:"Išsaugoti priminimą"}).click();
  await expect(stalePurchase.getByText(/Pirkinys pasikeitė kitur/)).toBeVisible();
  await expect(stalePurchase.getByLabel("Priminti prieš")).toHaveValue("7");
  await first.reload();
  await expect(first.getByLabel("Šio pirkinio pasirinkimas")).toHaveValue("off");
  const foreign=await browser.newPage({viewport:{width:390,height:844}});
  await signIn(foreign,`foreign-reminder-${randomUUID()}@example.test`);
  await foreign.goto(`/pirkiniai/${id}`);
  await expect(foreign.getByRole("heading",{name:"Pirkinys nerastas"})).toBeVisible();
  await foreign.goto("/nustatymai");
  await expect(foreign.getByText(email)).toHaveCount(0);
  const unchanged=await db(async(client)=>(await client.query("SELECT reminder_mode,reminder_offset FROM purchase WHERE id=$1",[id])).rows[0]);
  expect(unchanged).toMatchObject({reminder_mode:"off",reminder_offset:null});
  await context.close(); await foreign.close();
});

test("atidėtas bendrų priminimų atsakas išlaiko tikslią reviziją ir užrakina valdiklius",async({browser})=>{
  const context=await browser.newContext();
  const first=await context.newPage(), second=await context.newPage();
  await signIn(first,`settings-race-${randomUUID()}@example.test`);
  await first.goto("/nustatymai");
  await first.getByRole("checkbox",{name:"Įjungti garantijos priminimus el. paštu"}).check();
  await first.getByLabel("Priminti prieš").selectOption("90");
  const held=await holdAction(first,"/nustatymai");
  await first.getByRole("button",{name:"Išsaugoti priminimus"}).click();
  await held.serverCompleted;
  await expect(first.getByRole("checkbox",{name:"Įjungti garantijos priminimus el. paštu"})).toBeDisabled();
  await expect(first.getByLabel("Priminti prieš")).toBeDisabled();
  await expect(first.getByRole("button",{name:"Saugoma…"})).toBeDisabled();
  await second.goto("/nustatymai");
  await second.getByRole("checkbox",{name:"Įjungti garantijos priminimus el. paštu"}).uncheck();
  await second.getByLabel("Priminti prieš").selectOption("7");
  await second.getByRole("button",{name:"Išsaugoti priminimus"}).click();
  await expect(second.getByText("Priminimų nustatymai išsaugoti.")).toBeVisible();
  await held.release();
  await expect(first.getByText("Priminimų nustatymai išsaugoti.")).toBeVisible();
  await expect(first.locator('input[name="revision"]')).toHaveValue("2");
  await expect(first.getByRole("checkbox",{name:"Įjungti garantijos priminimus el. paštu"})).toBeChecked();
  await expect(first.getByLabel("Priminti prieš")).toHaveValue("90");
  await first.getByLabel("Priminti prieš").selectOption("30");
  const conflict=await holdAction(first,"/nustatymai");
  await first.getByRole("button",{name:"Išsaugoti priminimus"}).click();
  await conflict.serverCompleted;
  await expect(first.getByLabel("Priminti prieš")).toBeDisabled();
  await conflict.release();
  await expect(first.getByText(/Nustatymai pasikeitė kitur/)).toBeVisible();
  await expect(first.getByLabel("Priminti prieš")).toHaveValue("30");
  await first.reload();
  await expect(first.getByRole("checkbox",{name:"Įjungti garantijos priminimus el. paštu"})).not.toBeChecked();
  await expect(first.getByLabel("Priminti prieš")).toHaveValue("7");
  await first.getByLabel("Priminti prieš").selectOption("90");
  await first.locator('input[name="revision"]').evaluate((input:HTMLInputElement)=>{input.value="0";});
  const invalid=await holdAction(first,"/nustatymai");
  await first.getByRole("button",{name:"Išsaugoti priminimus"}).click();
  await invalid.serverCompleted;
  await expect(first.getByLabel("Priminti prieš")).toBeDisabled();
  await invalid.release();
  await expect(first.getByText("Patikrink priminimų pasirinkimus.")).toBeVisible();
  await expect(first.getByLabel("Priminti prieš")).toHaveValue("90");
  await first.reload();
  await expect(first.getByLabel("Priminti prieš")).toHaveValue("7");
  await context.close();
});

test("atidėtas pirkinio atsakas ir klaida išsaugo įvestį be svetimos revizijos",async({browser})=>{
  const context=await browser.newContext();
  const first=await context.newPage(), second=await context.newPage();
  await signIn(first,`purchase-race-${randomUUID()}@example.test`);
  const id=await makePurchase(first,"Pirkinys su lenktynėmis");
  await first.goto(`/pirkiniai/${id}`);
  await first.getByLabel("Šio pirkinio pasirinkimas").selectOption("custom");
  await first.getByLabel("Priminti prieš").selectOption("7");
  const held=await holdAction(first,`/pirkiniai/${id}`);
  await first.getByRole("button",{name:"Išsaugoti priminimą"}).click();
  await held.serverCompleted;
  await expect(first.getByLabel("Šio pirkinio pasirinkimas")).toBeDisabled();
  await expect(first.getByLabel("Priminti prieš")).toBeDisabled();
  await second.goto(`/pirkiniai/${id}`);
  await second.getByLabel("Šio pirkinio pasirinkimas").selectOption("off");
  await second.getByRole("button",{name:"Išsaugoti priminimą"}).click();
  await expect(second.getByText("Pirkinio priminimo pasirinkimas išsaugotas.")).toBeVisible();
  await held.release();
  await expect(first.getByText("Pirkinio priminimo pasirinkimas išsaugotas.")).toBeVisible();
  await expect(first.locator('input[name="revision"]')).toHaveValue("2");
  await expect(first.getByLabel("Šio pirkinio pasirinkimas")).toHaveValue("custom");
  await expect(first.getByLabel("Priminti prieš")).toHaveValue("7");
  await first.getByLabel("Priminti prieš").selectOption("30");
  const conflict=await holdAction(first,`/pirkiniai/${id}`);
  await first.getByRole("button",{name:"Išsaugoti priminimą"}).click();
  await conflict.serverCompleted;
  await expect(first.getByLabel("Priminti prieš")).toBeDisabled();
  await conflict.release();
  await expect(first.getByText(/Pirkinys pasikeitė kitur/)).toBeVisible();
  await expect(first.getByLabel("Priminti prieš")).toHaveValue("30");
  await first.reload();
  await expect(first.getByLabel("Šio pirkinio pasirinkimas")).toHaveValue("off");
  await first.getByLabel("Šio pirkinio pasirinkimas").selectOption("custom");
  await first.getByLabel("Priminti prieš").selectOption("90");
  await first.locator('input[name="revision"]').evaluate((input:HTMLInputElement)=>{input.value="0";});
  const invalid=await holdAction(first,`/pirkiniai/${id}`);
  await first.getByRole("button",{name:"Išsaugoti priminimą"}).click();
  await invalid.serverCompleted;
  await expect(first.getByLabel("Šio pirkinio pasirinkimas")).toBeDisabled();
  await expect(first.getByLabel("Priminti prieš")).toBeDisabled();
  await invalid.release();
  await expect(first.getByText("Patikrink priminimo pasirinkimą.")).toBeVisible();
  await expect(first.getByLabel("Šio pirkinio pasirinkimas")).toHaveValue("custom");
  await expect(first.getByLabel("Priminti prieš")).toHaveValue("90");
  await first.reload();
  await expect(first.getByLabel("Šio pirkinio pasirinkimas")).toHaveValue("off");
  await context.close();
});
