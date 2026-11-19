CREATE TABLE "article_contents" (
	"topic_id" integer PRIMARY KEY NOT NULL,
	"html" text,
	"source" text NOT NULL,
	"error" text,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "article_contents_source_check" CHECK (source in ('feed', 'readability'))
);
--> statement-breakpoint
ALTER TABLE "article_contents" ADD CONSTRAINT "article_contents_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_contents_fetched_idx" ON "article_contents" USING btree ("fetched_at");