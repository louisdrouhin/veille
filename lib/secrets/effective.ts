/**
 * The configuration in use, interface first, then .env (lib/secrets/store.ts): for the app and the
 * worker. No "server-only" import: the worker bundles it.
 */
import { aiConfig, type AiConfig } from "@/lib/ai/config";
import type { Db } from "@/lib/db";
import { vapidConfig } from "@/lib/push/config";
import type { Vapid } from "@/lib/push/webpush";
import { effectiveEnv } from "./store";

export async function currentAiConfig(db: Db): Promise<AiConfig | null> {
  return aiConfig(await effectiveEnv(db));
}

export async function currentVapid(db: Db): Promise<Vapid | null> {
  return vapidConfig(await effectiveEnv(db));
}

export { effectiveEnv };
