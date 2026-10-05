import "server-only";
import { createHmac } from "node:crypto";
import { pool } from "./db";
import { getEnv } from "./env";

export async function consumeEmailSendLimit(email: string): Promise<boolean> {
  const env = getEnv();
  const key = createHmac("sha256", env.BETTER_AUTH_SECRET).update(email.trim().toLowerCase()).digest("hex");
  const result = await pool.query(
    `INSERT INTO email_send_limit (key, count, window_started_at)
     VALUES ($1, 1, now())
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN email_send_limit.window_started_at <= now() - ($2::integer * interval '1 second')
                    THEN 1 ELSE email_send_limit.count + 1 END,
       window_started_at = CASE WHEN email_send_limit.window_started_at <= now() - ($2::integer * interval '1 second')
                                THEN now() ELSE email_send_limit.window_started_at END
     WHERE email_send_limit.window_started_at <= now() - ($2::integer * interval '1 second')
        OR email_send_limit.count < $3
     RETURNING key`,
    [key, env.AUTH_SEND_WINDOW_SECONDS, env.AUTH_SEND_LIMIT],
  );
  return result.rowCount === 1;
}
