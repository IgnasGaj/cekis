CREATE TABLE "receipt_cancellation" (
	"owner_id" text NOT NULL,
	"submission_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_cancellation_owner_id_submission_key_pk" PRIMARY KEY("owner_id","submission_key")
);
--> statement-breakpoint
ALTER TABLE "receipt_cancellation" ADD CONSTRAINT "receipt_cancellation_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;