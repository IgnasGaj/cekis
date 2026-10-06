import { bigint, boolean, check, date, foreignKey, index, integer, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
  uniqueIndex("purchase_owner_id_idx").on(table.ownerId, table.id),
  index("purchase_owner_date_idx").on(table.ownerId, table.purchaseDate.desc(), table.createdAt.desc(), table.id.desc()),
  check("purchase_product_name_check", sql`length(${table.productName}) between 1 and 200 and ${table.productName} = btrim(${table.productName})`),
  check("purchase_seller_check", sql`length(${table.seller}) between 1 and 200 and ${table.seller} = btrim(${table.seller})`),
  check("purchase_notes_check", sql`${table.notes} is null or length(${table.notes}) <= 2000`),
  check("purchase_price_check", sql`${table.price} is null or (${table.price} >= 0 and ${table.price} <= 9999999999.99)`),
  check("purchase_currency_check", sql`(${table.price} is null and ${table.currency} is null) or (${table.price} is not null and ${table.currency} is not null and ${table.currency} in ('EUR','USD','GBP','PLN'))`),
]);

export const receipt = pgTable("receipt", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  submissionKey: uuid("submission_key").notNull(),
  targetPurchaseId: uuid("target_purchase_id").notNull(),
  objectKey: text("object_key").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  sha256: text("sha256").notNull(),
  state: text("state").notNull().default("reserved"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  cleanupAttempts: integer("cleanup_attempts").notNull().default(0),
  cleanupError: text("cleanup_error"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("receipt_owner_submission_idx").on(table.ownerId, table.submissionKey),
  uniqueIndex("receipt_owner_id_idx").on(table.ownerId, table.id),
  uniqueIndex("receipt_object_key_idx").on(table.objectKey),
  index("receipt_cleanup_idx").on(table.state, table.expiresAt),
  foreignKey({ name: "receipt_target_purchase_owner_fk", columns: [table.ownerId, table.targetPurchaseId], foreignColumns: [purchase.ownerId, purchase.id] }),
  check("receipt_state_check", sql`${table.state} in ('reserved','ready','deleting','deleted')`),
  check("receipt_size_check", sql`${table.byteSize} between 1 and 10485760`),
  check("receipt_type_check", sql`${table.contentType} in ('image/jpeg','image/png','application/pdf')`),
  check("receipt_hash_check", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  check("receipt_filename_check", sql`length(${table.filename}) between 1 and 200`),
  check("receipt_attempts_check", sql`${table.cleanupAttempts} >= 0`),
]);

export const purchaseReceipt = pgTable("purchase_receipt", {
  ownerId: text("owner_id").notNull(),
  purchaseId: uuid("purchase_id").notNull(),
  receiptId: uuid("receipt_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.purchaseId, table.receiptId] }),
  index("purchase_receipt_owner_receipt_idx").on(table.ownerId, table.receiptId),
  foreignKey({ name: "purchase_receipt_purchase_owner_fk", columns: [table.ownerId, table.purchaseId], foreignColumns: [purchase.ownerId, purchase.id] }),
  foreignKey({ name: "purchase_receipt_receipt_owner_fk", columns: [table.ownerId, table.receiptId], foreignColumns: [receipt.ownerId, receipt.id] }),
]);

export const receiptCancellation = pgTable("receipt_cancellation", {
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  submissionKey: uuid("submission_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.ownerId, table.submissionKey] })]);

export const receiptUploadLimit = pgTable("receipt_upload_limit", {
  ownerId: text("owner_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
}, (table) => [check("receipt_upload_limit_attempts_check", sql`${table.attempts} >= 0`)]);
