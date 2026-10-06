CREATE TABLE "receipt_upload_limit" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "receipt_upload_limit_attempts_check" CHECK ("receipt_upload_limit"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "receipt_upload_limit" ADD CONSTRAINT "receipt_upload_limit_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;