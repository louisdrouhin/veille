CREATE TABLE "merge_blocks" (
	"topic_id" integer NOT NULL,
	"normalized_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merge_blocks_topic_id_normalized_url_pk" PRIMARY KEY("topic_id","normalized_url")
);
--> statement-breakpoint
CREATE TABLE "reply_embeddings" (
	"reply_id" integer PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"dim" integer NOT NULL,
	"vector" "bytea" NOT NULL,
	CONSTRAINT "reply_embeddings_dim_check" CHECK ("reply_embeddings"."dim" > 0 and octet_length("reply_embeddings"."vector") = "reply_embeddings"."dim" * 4)
);
--> statement-breakpoint
ALTER TABLE "app_settings" DROP CONSTRAINT "app_settings_name_check";--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "source_id" integer;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "normalized_url" text;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "lang" text;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "merge_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "merge_blocks" ADD CONSTRAINT "merge_blocks_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_embeddings" ADD CONSTRAINT "reply_embeddings_reply_id_replies_id_fk" FOREIGN KEY ("reply_id") REFERENCES "public"."replies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_normalized_url_unique" UNIQUE("normalized_url");--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_name_check" CHECK ("app_settings"."name" in ('gemini_api_key', 'gemini_model', 'gemini_translate_model', 'nvd_api_key', 'vapid_public_key', 'vapid_private_key', 'merge_threshold'));--> statement-breakpoint
-- Topics already there: never merged afterwards (only new arrivals are compared).
UPDATE "topics" SET "merge_checked_at" = "created_at";
