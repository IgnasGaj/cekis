import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.url().startsWith("postgres"),
  APP_URL: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  }, "Naudok HTTPS arba vietinį adresą"),
  BETTER_AUTH_SECRET: z.string().min(32).refine((value) => !value.startsWith("replace-with-")),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_FROM: z.string().min(3),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  AUTH_SEND_LIMIT: z.coerce.number().int().min(1).max(100).default(5),
  AUTH_SEND_WINDOW_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(3).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  RECEIPT_UPLOADS_PER_HOUR: z.coerce.number().int().min(1).max(100).default(20),
});

export function getEnv() {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const names = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Čekis konfigūracija neteisinga: ${names}. Patikrink .env.example.`);
  }
  if (Boolean(result.data.SMTP_USER) !== Boolean(result.data.SMTP_PASSWORD)) {
    throw new Error("Čekis konfigūracija neteisinga: SMTP_USER ir SMTP_PASSWORD turi būti pateikti kartu.");
  }
  return result.data;
}

export function getStorageEnv() {
  const env = getEnv();
  if (!env.S3_ENDPOINT || !env.S3_REGION || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new Error("Čekio saugykla nesukonfigūruota.");
  }
  const url = new URL(env.S3_ENDPOINT);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) {
    throw new Error("Čekio saugyklai reikia HTTPS arba vietinio adreso.");
  }
  return { endpoint: env.S3_ENDPOINT, region: env.S3_REGION, bucket: env.S3_BUCKET, accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY };
}
