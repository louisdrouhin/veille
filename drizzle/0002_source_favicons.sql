CREATE TABLE "source_favicons" (
	"source_id" integer PRIMARY KEY NOT NULL,
	"content_type" text,
	"data" "bytea",
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_favicons" ADD CONSTRAINT "source_favicons_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;