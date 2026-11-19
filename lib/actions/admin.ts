"use server";

import { count, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { flashUrl } from "@/components/flash";
import { getDb } from "@/lib/db";
import { forums, sources, topics } from "@/lib/db/schema";
import { fetchSource } from "@/lib/feeds/fetch-source";
import { plural } from "@/lib/format";
import { requireSession } from "@/lib/session";
import { httpUrl, id, int, isUniqueViolation, slugify, str, ValidationError } from "@/lib/validation";

const ADMIN = "/admin";

/**
 * Runs an admin mutation: checks the session, then redirects to /admin with
 * a success or error message. `redirect()` is called outside the try/catch on
 * purpose (it throws a control-flow error).
 */
async function adminAction(anchor: string, run: () => Promise<string>): Promise<never> {
  await requireSession();
  let target: string;
  try {
    target = flashUrl(ADMIN, "ok", await run(), anchor);
  } catch (err) {
    let message = "Erreur inattendue.";
    if (err instanceof ValidationError) message = err.message;
    else if (isUniqueViolation(err)) message = "Cette valeur existe déjà (slug ou URL en double).";
    else console.error(err);
    target = flashUrl(ADMIN, "error", message, anchor);
  }
  redirect(target);
}

// ---------------------------------------------------------------------------
// Forums
// ---------------------------------------------------------------------------

function forumFields(formData: FormData) {
  const name = str(formData, "name", { max: 100 });
  const slug = slugify(str(formData, "slug", { max: 60, required: false }) || name);
  if (!slug) throw new ValidationError("Impossible de générer un slug à partir de ce nom.");
  return { name, slug, position: int(formData, "position", 0) };
}

export async function createForum(formData: FormData) {
  return adminAction("#forums", async () => {
    const values = forumFields(formData);
    await getDb().insert(forums).values(values);
    return `Forum « ${values.name} » créé.`;
  });
}

export async function updateForum(formData: FormData) {
  return adminAction("#forums", async () => {
    const forumId = id(formData.get("id"));
    const values = forumFields(formData);
    await getDb().update(forums).set(values).where(eq(forums.id, forumId));
    return `Forum « ${values.name} » mis à jour.`;
  });
}

export async function deleteForum(formData: FormData) {
  return adminAction("#forums", async () => {
    const forumId = id(formData.get("id"));
    const db = getDb();
    const [{ n: sourceCount } = { n: 0 }] = await db.select({ n: count() }).from(sources).where(eq(sources.forumId, forumId));
    if (sourceCount > 0) {
      throw new ValidationError(
        `Ce forum contient encore ${plural(sourceCount, "source")} : supprime-les ou déplace-les d'abord.`,
      );
    }
    const [{ n: topicCount } = { n: 0 }] = await db.select({ n: count() }).from(topics).where(eq(topics.forumId, forumId));
    if (topicCount > 0) {
      throw new ValidationError(
        `Ce forum contient encore ${plural(topicCount, "topic")} (avec tes éventuelles notes) : suppression refusée.`,
      );
    }
    const [deleted] = await db.delete(forums).where(eq(forums.id, forumId)).returning({ name: forums.name });
    return deleted ? `Forum « ${deleted.name} » supprimé.` : "Forum introuvable.";
  });
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

function sourceFields(formData: FormData) {
  return {
    name: str(formData, "name", { max: 100 }),
    url: httpUrl(str(formData, "url", { max: 2000 })),
    forumId: id(formData.get("forumId")),
  };
}

export async function createSource(formData: FormData) {
  return adminAction("#sources", async () => {
    const values = sourceFields(formData);
    await getDb()
      .insert(sources)
      .values({ ...values, type: "rss", enabled: formData.get("enabled") !== null });
    return `Source « ${values.name} » ajoutée. Elle sera récupérée au prochain passage du worker.`;
  });
}

export async function updateSource(formData: FormData) {
  return adminAction("#sources", async () => {
    const sourceId = id(formData.get("id"));
    const values = sourceFields(formData);
    const db = getDb();
    const [current] = await db.select({ url: sources.url }).from(sources).where(eq(sources.id, sourceId));
    if (!current) throw new ValidationError("Source introuvable.");
    const urlChanged = current.url !== values.url;
    await db
      .update(sources)
      .set({
        ...values,
        // New feed URL: forget cache headers and errors, and treat the next fetch as a first import.
        ...(urlChanged
          ? { etag: null, lastModified: null, lastFetchedAt: null, lastError: null, consecutiveFailures: 0, pausedUntil: null }
          : {}),
      })
      .where(eq(sources.id, sourceId));
    return `Source « ${values.name} » mise à jour.`;
  });
}

export async function setSourceEnabled(formData: FormData) {
  return adminAction("#sources", async () => {
    const sourceId = id(formData.get("id"));
    const enabled = formData.get("enabled") === "true";
    const [row] = await getDb()
      .update(sources)
      .set({ enabled, ...(enabled ? { pausedUntil: null, consecutiveFailures: 0 } : {}) })
      .where(eq(sources.id, sourceId))
      .returning({ name: sources.name });
    if (!row) throw new ValidationError("Source introuvable.");
    return `Source « ${row.name} » ${enabled ? "activée" : "désactivée"}.`;
  });
}

/** Topics are kept (source_id becomes null, displayed as « Source supprimée »). */
export async function deleteSource(formData: FormData) {
  return adminAction("#sources", async () => {
    const sourceId = id(formData.get("id"));
    const [row] = await getDb().delete(sources).where(eq(sources.id, sourceId)).returning({ name: sources.name });
    if (!row) throw new ValidationError("Source introuvable.");
    return `Source « ${row.name} » supprimée. Ses topics et tes notes sont conservés.`;
  });
}

/** « Récupérer maintenant » — ignores the enabled flag and any pause. */
export async function fetchSourceNow(formData: FormData) {
  return adminAction("#sources", async () => {
    const sourceId = id(formData.get("id"));
    const db = getDb();
    const [source] = await db.select().from(sources).where(eq(sources.id, sourceId));
    if (!source) throw new ValidationError("Source introuvable.");
    const res = await fetchSource(db, source);
    switch (res.status) {
      case "ok":
        return `« ${source.name} » : ${plural(res.inserted, "nouveau topic", "nouveaux topics")}${
          res.firstImport ? " (import initial, marqués comme lus)" : ""
        }.`;
      case "not-modified":
        return `« ${source.name} » : aucun changement (304).`;
      case "error":
        throw new ValidationError(
          `« ${source.name} » : ${res.error}${res.paused ? " — source mise en pause 1 h." : ""}`,
        );
    }
  });
}
