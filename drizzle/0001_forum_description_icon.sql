ALTER TABLE "forums" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "forums" ADD COLUMN "icon" text DEFAULT 'news' NOT NULL;