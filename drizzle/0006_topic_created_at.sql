-- New topics get now(); existing ones did not record their arrival: use their publication date.
ALTER TABLE "topics" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "topics" SET "created_at" = "published_at";
