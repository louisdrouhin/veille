CREATE TABLE "ai_outputs" (
	"topic_id" integer NOT NULL,
	"kind" text NOT NULL,
	"model" text NOT NULL,
	"html" text NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"article_fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_outputs_topic_id_kind_model_pk" PRIMARY KEY("topic_id","kind","model"),
	CONSTRAINT "ai_outputs_kind_check" CHECK ("ai_outputs"."kind" in ('summary', 'translation'))
);
--> statement-breakpoint
ALTER TABLE "ai_outputs" ADD CONSTRAINT "ai_outputs_topic_id_article_contents_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."article_contents"("topic_id") ON DELETE cascade ON UPDATE no action;