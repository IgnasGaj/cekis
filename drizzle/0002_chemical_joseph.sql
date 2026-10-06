CREATE TABLE "purchase" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"submission_key" uuid NOT NULL,
	"product_name" text NOT NULL,
	"seller" text NOT NULL,
	"purchase_date" date NOT NULL,
	"price" numeric(12, 2),
	"currency" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "purchase_product_name_check" CHECK (length("purchase"."product_name") between 1 and 200 and "purchase"."product_name" = btrim("purchase"."product_name")),
	CONSTRAINT "purchase_seller_check" CHECK (length("purchase"."seller") between 1 and 200 and "purchase"."seller" = btrim("purchase"."seller")),
	CONSTRAINT "purchase_notes_check" CHECK ("purchase"."notes" is null or length("purchase"."notes") <= 2000),
	CONSTRAINT "purchase_price_check" CHECK ("purchase"."price" is null or ("purchase"."price" >= 0 and "purchase"."price" <= 9999999999.99)),
	CONSTRAINT "purchase_currency_check" CHECK (("purchase"."price" is null and "purchase"."currency" is null) or ("purchase"."price" is not null and "purchase"."currency" in ('EUR','USD','GBP','PLN')))
);
--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_owner_submission_idx" ON "purchase" USING btree ("owner_id","submission_key");--> statement-breakpoint
CREATE INDEX "purchase_owner_date_idx" ON "purchase" USING btree ("owner_id","purchase_date" DESC NULLS LAST,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST);