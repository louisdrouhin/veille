CREATE TABLE "list_items" (
	"list_id" integer NOT NULL,
	"topic_id" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_items_list_id_topic_id_pk" PRIMARY KEY("list_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lists_name_check" CHECK (length(trim("lists"."name")) between 1 and 60),
	CONSTRAINT "lists_color_check" CHECK ("lists"."color" in ('slate', 'blue', 'teal', 'green', 'mustard', 'orange', 'rose', 'violet'))
);
--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "list_items_topic_idx" ON "list_items" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "list_items_list_added_idx" ON "list_items" USING btree ("list_id","added_at" DESC NULLS LAST);