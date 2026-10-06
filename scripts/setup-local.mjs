import { randomBytes } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";

try { await access(".env.local"); throw new Error(".env.local jau yra; jo nekeisk automatiškai."); }
catch (error) { if (error.code !== "ENOENT") throw error; }
try { await access(".env.test.local"); throw new Error(".env.test.local jau yra; jo nekeisk automatiškai."); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const password = randomBytes(18).toString("hex");
const secret = randomBytes(32).toString("hex");
const storageUser = `cekis${randomBytes(6).toString("hex")}`;
const storageSecret = randomBytes(24).toString("hex");
const template = await readFile(".env.example", "utf8");
const local = template.replaceAll("CHANGE_ME_S3_USER", storageUser).replaceAll("CHANGE_ME_S3_SECRET", storageSecret).replaceAll("CHANGE_ME", password).replace("replace-with-a-random-secret-of-at-least-32-characters", secret);
const test = local.replaceAll("5433/cekis", "5434/cekis_test").replace("S3_BUCKET=cekis-local", "S3_BUCKET=cekis-test").replace(secret, randomBytes(32).toString("hex"));
await writeFile(".env.local", local, { mode: 0o600 });
await writeFile(".env.test.local", test, { mode: 0o600 });
process.stdout.write("Sukurti .env.local ir .env.test.local su vietiniais atsitiktiniais slaptažodžiais.\n");
