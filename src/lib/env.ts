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
