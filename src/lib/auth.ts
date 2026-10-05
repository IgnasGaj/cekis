import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { magicLink } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { db } from "./db";
import * as schema from "./schema";
import { getEnv } from "./env";
import { sendSignInEmail } from "./mailer";
import { consumeEmailSendLimit } from "./send-limit";

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
    sendMagicLink: async ({ email, url }) => {
      let allowed: boolean;
      try {
        allowed = await consumeEmailSendLimit(email);
      } catch {
        throw new APIError("SERVICE_UNAVAILABLE", { message: "Dabar nepavyko išsiųsti nuorodos. Pabandyk vėliau." });
      }
      if (!allowed) throw new APIError("TOO_MANY_REQUESTS", { message: "Per daug bandymų. Pabandyk vėliau." });
      // Transport failures still count: releasing quota would permit repeated SMTP attempts.
      await sendSignInEmail(email, url);
    },
  })],
});
