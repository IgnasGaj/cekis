import { bigint, boolean, check, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
}, (table) => [index("session_user_id_idx").on(table.userId), index("session_expires_at_idx").on(table.expiresAt)]);

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("account_user_id_idx").on(table.userId), uniqueIndex("account_provider_idx").on(table.providerId, table.accountId)]);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("verification_identifier_idx").on(table.identifier), index("verification_expires_at_idx").on(table.expiresAt)]);

export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const emailSendLimit = pgTable("email_send_limit", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
});

export const purchase = pgTable("purchase", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  submissionKey: uuid("submission_key").notNull(),
  productName: text("product_name").notNull(),
  seller: text("seller").notNull(),
  purchaseDate: date("purchase_date").notNull(),
  price: numeric("price", { precision: 12, scale: 2 }),
  currency: text("currency"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("purchase_owner_submission_idx").on(table.ownerId, table.submissionKey),
  index("purchase_owner_date_idx").on(table.ownerId, table.purchaseDate.desc(), table.createdAt.desc(), table.id.desc()),
  check("purchase_product_name_check", sql`length(${table.productName}) between 1 and 200 and ${table.productName} = btrim(${table.productName})`),
  check("purchase_seller_check", sql`length(${table.seller}) between 1 and 200 and ${table.seller} = btrim(${table.seller})`),
  check("purchase_notes_check", sql`${table.notes} is null or length(${table.notes}) <= 2000`),
  check("purchase_price_check", sql`${table.price} is null or (${table.price} >= 0 and ${table.price} <= 9999999999.99)`),
  check("purchase_currency_check", sql`(${table.price} is null and ${table.currency} is null) or (${table.price} is not null and ${table.currency} in ('EUR','USD','GBP','PLN'))`),
]);
