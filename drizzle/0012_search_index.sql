-- Accent and case folding of the exact search (lib/search/fold.ts): one character in, one character out.
create or replace function folders_fold(t text) returns text
  language sql immutable parallel safe strict
  as $$ select translate(lower(t), 'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝŸýÿŒœÆæ’‘ʼ', 'aaaaaaaaaaaacceeeeeeeeiiiiiiiinnoooooooooouuuuuuuuyyyyooaa''''''') $$;--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"day" text NOT NULL,
	"kind" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_day_kind_pk" PRIMARY KEY("day","kind"),
	CONSTRAINT "ai_usage_kind_check" CHECK ("ai_usage"."kind" in ('embed', 'ask'))
);
--> statement-breakpoint
CREATE TABLE "article_embeddings" (
	"topic_id" integer PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"dim" integer NOT NULL,
	"vector" "bytea" NOT NULL,
	"article_of" timestamp with time zone,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_embeddings_dim_check" CHECK ("article_embeddings"."dim" > 0 and octet_length("article_embeddings"."vector") = "article_embeddings"."dim" * 4)
);
--> statement-breakpoint
ALTER TABLE "article_contents" ADD COLUMN "text" text;--> statement-breakpoint
ALTER TABLE "article_contents" ADD COLUMN "text_of" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "article_contents" ADD COLUMN "search_tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('french', folders_fold(coalesce(text, ''))), 'C') || setweight(to_tsvector('english', folders_fold(coalesce(text, ''))), 'C')) STORED;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "search_tsv" "tsvector" GENERATED ALWAYS AS (case when type = 'note' then setweight(to_tsvector('french', folders_fold(content)), 'C') || setweight(to_tsvector('english', folders_fold(content)), 'C') end) STORED;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "search_tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('french', folders_fold(title)), 'A') || setweight(to_tsvector('english', folders_fold(title)), 'A') || setweight(to_tsvector('french', folders_fold(excerpt)), 'B') || setweight(to_tsvector('english', folders_fold(excerpt)), 'B')) STORED;--> statement-breakpoint
ALTER TABLE "article_embeddings" ADD CONSTRAINT "article_embeddings_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_contents_search_idx" ON "article_contents" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "replies_search_idx" ON "replies" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "topics_search_idx" ON "topics" USING gin ("search_tsv");