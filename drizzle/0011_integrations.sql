CREATE TABLE "app_settings" (
	"name" text PRIMARY KEY NOT NULL,
	"value" text,
	"encrypted" text,
	"hint" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tested_at" timestamp with time zone,
	"test_ok" boolean,
	"test_message" text,
	CONSTRAINT "app_settings_name_check" CHECK ("app_settings"."name" in ('gemini_api_key', 'gemini_model', 'gemini_translate_model', 'nvd_api_key', 'vapid_public_key', 'vapid_private_key')),
	CONSTRAINT "app_settings_one_value" CHECK ("app_settings"."value" is null or "app_settings"."encrypted" is null)
);
--> statement-breakpoint
CREATE TABLE "settings_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"action" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_log_action_check" CHECK ("settings_log"."action" in ('set', 'delete', 'generate', 'import'))
);
--> statement-breakpoint
CREATE INDEX "settings_log_at_idx" ON "settings_log" USING btree ("at");