"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { requireSession } from "@/lib/session";
import { isThemePreference, THEME_COOKIE, themeCookieOptions, type ThemePreference } from "@/lib/theme";

/**
 * Mon compte › Apparence. Saved on the account (same choice on every device; « system » follows
 * each one) and mirrored in the folders-theme cookie read by the root layout. The client has
 * already switched <html data-theme>; revalidating the root layout drops the router cache, so
 * pages rendered with the old theme are not shown again.
 */
export async function setTheme(value: ThemePreference): Promise<{ ok: boolean }> {
  const session = await requireSession();
  if (!isThemePreference(value)) return { ok: false };
  await getDb().update(user).set({ theme: value, updatedAt: new Date() }).where(eq(user.id, session.user.id));
  const secure = process.env.BETTER_AUTH_URL?.startsWith("https://") ?? false;
  (await cookies()).set(THEME_COOKIE, value, themeCookieOptions(secure));
  revalidatePath("/", "layout");
  return { ok: true };
}
