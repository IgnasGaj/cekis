import "server-only";
import nodemailer from "nodemailer";
import { getEnv } from "./env";

export async function sendSignInEmail(email: string, url: string) {
  const env = getEnv();
  const parsed = new URL(url);
  if (parsed.origin !== new URL(env.APP_URL).origin) throw new Error("Invalid sign-in origin");
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    requireTLS: env.SMTP_PORT !== 465 && new URL(env.APP_URL).protocol === "https:",
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000, dnsTimeout: 15_000,
  });
  await transport.sendMail({
    from: env.SMTP_FROM,
    to: email,
    subject: "Prisijungimas prie Čekis",
    text: `Labas!\n\nPrisijunk prie Čekis paspaudęs šią nuorodą:\n${url}\n\nNuoroda galioja 5 minutes ir gali būti panaudota tik vieną kartą. Jei jos neprašei, laišką ignoruok.`,
  });
}
