CREATE TABLE "user_photos" (
	"user_id" text PRIMARY KEY NOT NULL,
	"mime" text NOT NULL,
	"large" "bytea" NOT NULL,
	"small" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_photos_mime_check" CHECK ("user_photos"."mime" in ('image/jpeg', 'image/webp'))
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "first_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "last_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_photos" ADD CONSTRAINT "user_photos_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_first_name_check" CHECK (length("user"."first_name") <= 50);--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_last_name_check" CHECK (length("user"."last_name") <= 50);--> statement-breakpoint
-- Prénom / Nom from the identifier (docs/design/3.5 § 5): « louis.drouhin » → « Louis » / « Drouhin » (split on ., _ or a space,
-- first letter upper case). A name without separator becomes the first name. The user can correct both afterwards.
UPDATE "user" SET
	"first_name" = left(initcap(split_part(regexp_replace(trim("name"), '[._[:space:]]+', '.', 'g'), '.', 1)), 50),
	"last_name" = coalesce(left(initcap(nullif(substr(regexp_replace(trim("name"), '[._[:space:]]+', '.', 'g'), length(split_part(regexp_replace(trim("name"), '[._[:space:]]+', '.', 'g'), '.', 1)) + 2), '')), 50), '')
WHERE "first_name" = '' AND "last_name" = '';
