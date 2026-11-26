CREATE TABLE "ask_answers" (
	"key" text PRIMARY KEY NOT NULL,
	"answer" text NOT NULL,
	"sources" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ask_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"question" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"feedback" text,
	CONSTRAINT "ask_history_feedback_check" CHECK ("ask_history"."feedback" in ('utile', 'pas-utile'))
);
--> statement-breakpoint
ALTER TABLE "ask_history" ADD CONSTRAINT "ask_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ask_history_user_idx" ON "ask_history" USING btree ("user_id","asked_at");