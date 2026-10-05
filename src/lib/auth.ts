import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { magicLink } from "better-auth/plugins";
import { db } from "./db";
import * as schema from "./schema";
import { getEnv } from "./env";
import { sendSignInEmail } from "./mailer";

const env = getEnv();

export const auth = betterAuth({
  appName: "Čekis",
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [new URL(env.APP_URL).origin],
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: false },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
  rateLimit: { enabled: true, storage: "database", window: 60, max: 30 },
  advanced: { cookiePrefix: "cekis", useSecureCookies: new URL(env.APP_URL).protocol === "https:" },
  plugins: [magicLink({
    expiresIn: 300,
    storeToken: "hashed",
    rateLimit: { window: 60, max: 30 },
    sendMagicLink: async ({ email, url }) => sendSignInEmail(email, url),
  })],
});
