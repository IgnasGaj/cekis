DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "purchase" WHERE "price" IS NOT NULL AND "currency" IS NULL) THEN
    RAISE EXCEPTION 'Purchase rows with a price but no currency require explicit correction before migration';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "purchase" DROP CONSTRAINT "purchase_currency_check";--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_currency_check" CHECK (("purchase"."price" is null and "purchase"."currency" is null) or ("purchase"."price" is not null and "purchase"."currency" is not null and "purchase"."currency" in ('EUR','USD','GBP','PLN')));
