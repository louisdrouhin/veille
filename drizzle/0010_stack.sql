CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"stack_item_id" integer NOT NULL,
	"vulnerability_id" integer NOT NULL,
	"state" text DEFAULT 'new' NOT NULL,
	"done_reason" text,
	"ignored_reason" text,
	"ignored_note" text,
	"done_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"notified_exploited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alerts_state_check" CHECK ("alerts"."state" in ('new', 'seen', 'done', 'ignored')),
	CONSTRAINT "alerts_done_reason_check" CHECK ("alerts"."done_reason" in ('updated', 'manual', 'removed')),
	CONSTRAINT "alerts_ignored_reason_check" CHECK ("alerts"."ignored_reason" in ('not_exposed', 'not_concerned', 'backport', 'other'))
);
--> statement-breakpoint
CREATE TABLE "certfr_advisories" (
	"ref" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"solution" text DEFAULT '' NOT NULL,
	"cves" text[] DEFAULT '{}'::text[] NOT NULL,
	"exploited" boolean DEFAULT false NOT NULL,
	"url" text NOT NULL,
	"feed_title" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"threshold" text DEFAULT 'high' NOT NULL,
	"exploited_always" boolean DEFAULT true NOT NULL,
	"quiet_enabled" boolean DEFAULT true NOT NULL,
	"quiet_from" time DEFAULT '22:00' NOT NULL,
	"quiet_to" time DEFAULT '07:30' NOT NULL,
	"discreet_homelab" boolean DEFAULT false NOT NULL,
	"discreet_work" boolean DEFAULT true NOT NULL,
	CONSTRAINT "notification_settings_singleton" CHECK ("notification_settings"."id" = 1),
	CONSTRAINT "notification_settings_threshold_check" CHECK ("notification_settings"."threshold" in ('critical', 'high', 'medium', 'all'))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"vendor" text NOT NULL,
	"cpe_prefix" text,
	"github_repo" text,
	"version_scheme" text DEFAULT 'vendor' NOT NULL,
	"version_hint" text,
	"nvd_synced_at" timestamp with time zone,
	"github_synced_at" timestamp with time zone,
	"latest_version" text,
	"recent_versions" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_key_unique" UNIQUE("key"),
	CONSTRAINT "products_cpe_prefix_unique" UNIQUE("cpe_prefix"),
	CONSTRAINT "products_scheme_check" CHECK ("products"."version_scheme" in ('semver', 'debian', 'vendor')),
	CONSTRAINT "products_source_check" CHECK ("products"."cpe_prefix" is not null or "products"."github_repo" is not null)
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"keys" jsonb NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ok_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "stack_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer,
	"custom_name" text,
	"version" text NOT NULL,
	"context" text NOT NULL,
	"distro_package" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "stack_items_context_check" CHECK ("stack_items"."context" in ('homelab', 'work')),
	CONSTRAINT "stack_items_name_check" CHECK ("stack_items"."product_id" is not null or length(trim("stack_items"."custom_name")) between 1 and 80),
	CONSTRAINT "stack_items_version_check" CHECK (length(trim("stack_items"."version")) between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "stack_status" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_check_at" timestamp with time zone,
	"last_full_check_at" timestamp with time zone,
	"failed_sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"running_until" timestamp with time zone,
	"requested_at" timestamp with time zone,
	CONSTRAINT "stack_status_singleton" CHECK ("stack_status"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "vulnerabilities" (
	"id" serial PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"cve_id" text,
	"title_fr" text,
	"summary_fr" text,
	"text_source" text,
	"actions_fr" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description_en" text DEFAULT '' NOT NULL,
	"cvss" numeric(3, 1),
	"severity" text NOT NULL,
	"exploited" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"topic_id" integer,
	"certfr_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vulnerabilities_ref_unique" UNIQUE("ref"),
	CONSTRAINT "vulnerabilities_severity_check" CHECK ("vulnerabilities"."severity" in ('critical', 'high', 'medium', 'low')),
	CONSTRAINT "vulnerabilities_text_source_check" CHECK ("vulnerabilities"."text_source" in ('certfr', 'ai'))
);
--> statement-breakpoint
CREATE TABLE "vulnerability_products" (
	"vulnerability_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"ranges" jsonb NOT NULL,
	"fixed_versions" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "vulnerability_products_vulnerability_id_product_id_pk" PRIMARY KEY("vulnerability_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_stack_item_id_stack_items_id_fk" FOREIGN KEY ("stack_item_id") REFERENCES "public"."stack_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_vulnerability_id_vulnerabilities_id_fk" FOREIGN KEY ("vulnerability_id") REFERENCES "public"."vulnerabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stack_items" ADD CONSTRAINT "stack_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vulnerabilities" ADD CONSTRAINT "vulnerabilities_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vulnerability_products" ADD CONSTRAINT "vulnerability_products_vulnerability_id_vulnerabilities_id_fk" FOREIGN KEY ("vulnerability_id") REFERENCES "public"."vulnerabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vulnerability_products" ADD CONSTRAINT "vulnerability_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_item_vuln_idx" ON "alerts" USING btree ("stack_item_id","vulnerability_id");--> statement-breakpoint
CREATE INDEX "alerts_state_idx" ON "alerts" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "stack_items_product_context_idx" ON "stack_items" USING btree ("product_id","context") WHERE removed_at is null and product_id is not null;--> statement-breakpoint
CREATE INDEX "vulnerabilities_cve_idx" ON "vulnerabilities" USING btree ("cve_id");--> statement-breakpoint
CREATE INDEX "vulnerability_products_product_idx" ON "vulnerability_products" USING btree ("product_id");