CREATE TABLE "purchase_receipt" (
	"owner_id" text NOT NULL,
	"purchase_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_receipt_purchase_id_receipt_id_pk" PRIMARY KEY("purchase_id","receipt_id")
);
--> statement-breakpoint
CREATE TABLE "receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"submission_key" uuid NOT NULL,
	"target_purchase_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"lease_until" timestamp with time zone,
	"cleanup_attempts" integer DEFAULT 0 NOT NULL,
	"cleanup_error" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_state_check" CHECK ("receipt"."state" in ('reserved','ready','deleting','deleted')),
	CONSTRAINT "receipt_size_check" CHECK ("receipt"."byte_size" between 1 and 10485760),
	CONSTRAINT "receipt_type_check" CHECK ("receipt"."content_type" in ('image/jpeg','image/png','application/pdf')),
	CONSTRAINT "receipt_hash_check" CHECK ("receipt"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "receipt_filename_check" CHECK (length("receipt"."filename") between 1 and 200),
	CONSTRAINT "receipt_attempts_check" CHECK ("receipt"."cleanup_attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_owner_id_idx" ON "purchase" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_owner_id_idx" ON "receipt" USING btree ("owner_id","id");--> statement-breakpoint
ALTER TABLE "purchase_receipt" ADD CONSTRAINT "purchase_receipt_purchase_owner_fk" FOREIGN KEY ("owner_id","purchase_id") REFERENCES "public"."purchase"("owner_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt" ADD CONSTRAINT "purchase_receipt_receipt_owner_fk" FOREIGN KEY ("owner_id","receipt_id") REFERENCES "public"."receipt"("owner_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_target_purchase_owner_fk" FOREIGN KEY ("owner_id","target_purchase_id") REFERENCES "public"."purchase"("owner_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_receipt_owner_receipt_idx" ON "purchase_receipt" USING btree ("owner_id","receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_owner_submission_idx" ON "receipt" USING btree ("owner_id","submission_key");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_object_key_idx" ON "receipt" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "receipt_cleanup_idx" ON "receipt" USING btree ("state","expires_at");--> statement-breakpoint
