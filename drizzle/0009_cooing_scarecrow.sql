CREATE TABLE "reminder_preference" (
	"user_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"default_offset" integer DEFAULT 30 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "reminder_preference_offset_check" CHECK ("reminder_preference"."default_offset" in (7,30,90)),
	CONSTRAINT "reminder_preference_revision_check" CHECK ("reminder_preference"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "warranty_reminder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"purchase_id" uuid NOT NULL,
	"identity" text NOT NULL,
	"end_date" date NOT NULL,
	"offset_days" integer NOT NULL,
	"recipient_version" integer NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claim_token" uuid,
	"lease_until" timestamp with time zone,
	"dispatch_authorized_at" timestamp with time zone,
	"provider_message_id" text,
	"accepted_at" timestamp with time zone,
	"error_class" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warranty_reminder_offset_check" CHECK ("warranty_reminder"."offset_days" in (7,30,90)),
	CONSTRAINT "warranty_reminder_date_check" CHECK ("warranty_reminder"."end_date" between date '0001-01-01' and date '9999-12-31' and "warranty_reminder"."due_date" between date '0001-01-01' and date '9999-12-31' and "warranty_reminder"."due_date" = "warranty_reminder"."end_date" - "warranty_reminder"."offset_days"),
	CONSTRAINT "warranty_reminder_status_check" CHECK ("warranty_reminder"."status" in ('pending','processing','accepted','failed','uncertain','cancelled')),
	CONSTRAINT "warranty_reminder_attempts_check" CHECK ("warranty_reminder"."attempts" between 0 and 5 and "warranty_reminder"."recipient_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "reminder_mode" text DEFAULT 'inherit' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "reminder_offset" integer;--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "reminder_pref_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "reminder_recipient_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_preference" ADD CONSTRAINT "reminder_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_reminder" ADD CONSTRAINT "warranty_reminder_purchase_owner_fk" FOREIGN KEY ("owner_id","purchase_id") REFERENCES "public"."purchase"("owner_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "warranty_reminder_identity_idx" ON "warranty_reminder" USING btree ("identity");--> statement-breakpoint
CREATE INDEX "warranty_reminder_eligible_idx" ON "warranty_reminder" USING btree ("status","due_date","next_attempt_at");--> statement-breakpoint
CREATE INDEX "warranty_reminder_owner_idx" ON "warranty_reminder" USING btree ("owner_id","purchase_id","created_at");--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_reminder_check" CHECK (("purchase"."reminder_mode" in ('inherit','off') and "purchase"."reminder_offset" is null) or ("purchase"."reminder_mode" = 'custom' and "purchase"."reminder_offset" in (7,30,90)));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION bump_reminder_recipient_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email OR NEW.email_verified IS DISTINCT FROM OLD.email_verified THEN
    NEW.reminder_recipient_version := OLD.reminder_recipient_version + 1;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER user_reminder_recipient_version BEFORE UPDATE ON "user"
FOR EACH ROW EXECUTE FUNCTION bump_reminder_recipient_version();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION invalidate_reminder_recipient() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reminder_recipient_version <> OLD.reminder_recipient_version THEN
    INSERT INTO reminder_preference(user_id,enabled,default_offset,revision) VALUES (NEW.id,false,30,1)
    ON CONFLICT (user_id) DO UPDATE SET revision=reminder_preference.revision+1;
    UPDATE warranty_reminder SET status='cancelled',claim_token=NULL,lease_until=NULL
      WHERE owner_id=NEW.id AND status IN ('pending','processing') AND dispatch_authorized_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER user_reminder_recipient_invalidate AFTER UPDATE ON "user"
FOR EACH ROW EXECUTE FUNCTION invalidate_reminder_recipient();
