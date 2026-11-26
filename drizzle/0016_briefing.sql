CREATE TABLE "briefing_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"send_at" time DEFAULT '07:00' NOT NULL,
	"days" text DEFAULT 'weekdays' NOT NULL,
	"timezone" text DEFAULT 'Europe/Paris' NOT NULL,
	"section_stack" boolean DEFAULT true NOT NULL,
	"section_featured" boolean DEFAULT true NOT NULL,
	"section_services" boolean DEFAULT true NOT NULL,
	"section_brief" boolean DEFAULT true NOT NULL,
	"length" text DEFAULT 'detailed' NOT NULL,
	"preview" text DEFAULT 'full' NOT NULL,
	"services_forum_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"services_prefilled" boolean DEFAULT false NOT NULL,
	"intro_seen_at" timestamp with time zone,
	"home_hidden_on" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "briefing_settings_singleton" CHECK ("briefing_settings"."id" = 1),
	CONSTRAINT "briefing_settings_days_check" CHECK ("briefing_settings"."days" in ('weekdays', 'daily')),
	CONSTRAINT "briefing_settings_length_check" CHECK ("briefing_settings"."length" in ('detailed', 'short')),
	CONSTRAINT "briefing_settings_preview_check" CHECK ("briefing_settings"."preview" in ('full', 'discreet'))
);
--> statement-breakpoint
CREATE TABLE "briefings" (
	"id" serial PRIMARY KEY NOT NULL,
	"day" text NOT NULL,
	"kind" text DEFAULT 'scheduled' NOT NULL,
	"since" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"step" text DEFAULT 'stack' NOT NULL,
	"ai" text DEFAULT 'pending' NOT NULL,
	"length" text DEFAULT 'detailed' NOT NULL,
	"article_count" integer DEFAULT 0 NOT NULL,
	"content" jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"pushed_at" timestamp with time zone,
	CONSTRAINT "briefings_day_unique" UNIQUE("day"),
	CONSTRAINT "briefings_day_check" CHECK ("briefings"."day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "briefings_kind_check" CHECK ("briefings"."kind" in ('scheduled', 'test', 'preview')),
	CONSTRAINT "briefings_step_check" CHECK ("briefings"."step" in ('stack', 'services', 'select', 'ai', 'done')),
	CONSTRAINT "briefings_ai_check" CHECK ("briefings"."ai" in ('pending', 'ok', 'error', 'off'))
);
--> statement-breakpoint
CREATE INDEX "briefings_created_idx" ON "briefings" USING btree ("created_at");