"use server";

import { asc, count, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { FORUM_ICONS, forums, sources, topics, type ForumIconName } from "@/lib/db/schema";
import { fetchSource } from "@/lib/feeds/fetch-source";
import { plural } from "@/lib/format-date";
import { requireSession } from "@/lib/session";
import { toastUrl, type ToastData } from "@/lib/toast";
import { httpUrl, id, isUniqueViolation, slugify, str, ValidationError } from "@/lib/validation";

const ADMIN = "/admin";

class ActionError extends Error {
  constructor(
    public title: string,
    message?: string,
    public ctx?: string,
  ) {
    super(message ?? "");
  }
}

/**
 * Runs an admin mutation: checks the session, then redirects to /admin with a
 * toast. `redirect()` is called outside the try/catch on purpose (it throws).
 */
async function adminAction(anchor: string, run: () => Promise<Omit<ToastData, "kind">>): Promise<never> {
  await requireSession();
  let toast: ToastData;
  try {
    toast = { kind: "ok", ...(await run()) };
  } catch (err) {
    if (err instanceof ActionError) toast = { kind: "error", title: err.title, msg: err.message || undefined, ctx: err.ctx };
    else if (err instanceof ValidationError) toast = { kind: "error", title: "Formulaire invalide :", msg: err.message };
    else if (isUniqueViolation(err)) toast = { kind: "error", title: "Déjà existant :", msg: "ce slug ou cette URL est déjà utilisé." };
    else {
      console.error(err);
      toast = { kind: "error", title: "Erreur inattendue.", msg: "Voir les logs du serveur." };
    }
  }
  redirect(toastUrl(ADMIN, toast, anchor));
}

function revalidateAll() {
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Forums
// ---------------------------------------------------------------------------

function forumFields(formData: FormData) {
  const name = str(formData, "name", { max: 100 });
  const slug = slugify(str(formData, "slug", { max: 60, required: false }) || name);
  if (!slug) throw new ValidationError("impossible de générer un slug à partir de ce nom.");
  const iconRaw = str(formData, "icon", { required: false });
  const icon = (FORUM_ICONS as readonly string[]).includes(iconRaw) ? (iconRaw as ForumIconName) : "news";
  const description = str(formData, "description", { max: 300, required: false });
  return { name, slug, icon, description };
}

export async function createForum(formData: FormData) {
  return adminAction("#forums", async () => {
    const values = forumFields(formData);
    const db = getDb();
    const [{ last } = { last: 0 }] = await db.select({ last: max(forums.position) }).from(forums);
    await db.insert(forums).values({ ...values, position: (last ?? 0) + 10 });
    return { title: "Forum créé :", msg: values.name };
  });
}

export async function updateForum(formData: FormData) {
  return adminAction("#forums", async () => {
    const forumId = id(formData.get("id"));
    const values = forumFields(formData);
    await getDb().update(forums).set(values).where(eq(forums.id, forumId));
    return { title: "Forum mis à jour :", msg: values.name };
  });
}

export async function deleteForum(formData: FormData) {
  return adminAction("#forums", async () => {
    const forumId = id(formData.get("id"));
    const db = getDb();
    const [{ n: sourceCount } = { n: 0 }] = await db.select({ n: count() }).from(sources).where(eq(sources.forumId, forumId));
    if (sourceCount > 0) {
      throw new ActionError("Impossible :", `ce forum contient ${plural(sourceCount, "source")}. Déplace-les ou supprime-les d'abord.`);
    }
    const [{ n: topicCount } = { n: 0 }] = await db.select({ n: count() }).from(topics).where(eq(topics.forumId, forumId));
    if (topicCount > 0) {
      throw new ActionError("Impossible :", `ce forum contient encore ${plural(topicCount, "topic")} (et tes notes).`);
    }
    const [deleted] = await db.delete(forums).where(eq(forums.id, forumId)).returning({ name: forums.name });
    if (!deleted) throw new ActionError("Forum introuvable.");
    return { title: "Forum supprimé :", msg: deleted.name };
  });
}

/** Persists a full ordering (drag and drop). Positions are rewritten as 10, 20, 30… */
export async function reorderForums(ids: number[]): Promise<void> {
  await requireSession();
  const clean = ids.map((v) => id(v));
  const db = getDb();
  await db.transaction(async (tx) => {
    for (const [i, forumId] of clean.entries()) {
      await tx.update(forums).set({ position: (i + 1) * 10 }).where(eq(forums.id, forumId));
    }
  });
  revalidateAll();
}

/** « Monter » / « Descendre » — accessible alternative to drag and drop. */
export async function moveForum(forumId: number, direction: "up" | "down"): Promise<void> {
  await requireSession();
  const db = getDb();
  const ordered = await db.select({ id: forums.id }).from(forums).orderBy(asc(forums.position), asc(forums.name));
  const ids = ordered.map((f) => f.id);
  const from = ids.indexOf(id(forumId));
  const to = direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= ids.length) return;
  [ids[from], ids[to]] = [ids[to]!, ids[from]!];
  await reorderForums(ids);
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
    await getDb().insert(sources).values({ ...values, type: "rss", enabled: true });
    return { title: "Source ajoutée :", msg: values.name, ctx: "Récupérée au prochain passage du worker." };
  });
}

export async function updateSource(formData: FormData) {
  return adminAction("#sources", async () => {
    const sourceId = id(formData.get("id"));
    const values = sourceFields(formData);
    const db = getDb();
    const [current] = await db.select({ url: sources.url }).from(sources).where(eq(sources.id, sourceId));
    if (!current) throw new ActionError("Source introuvable.");
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
    return { title: "Source mise à jour :", msg: values.name };
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
    if (!row) throw new ActionError("Source introuvable.");
    return { title: enabled ? "Source activée :" : "Source désactivée :", msg: row.name };
  });
}

/** Topics are kept (source_id becomes null, displayed as « Source supprimée »). */
export async function deleteSource(formData: FormData) {
  return adminAction("#sources", async () => {
    const sourceId = id(formData.get("id"));
    const [row] = await getDb().delete(sources).where(eq(sources.id, sourceId)).returning({ name: sources.name });
    if (!row) throw new ActionError("Source introuvable.");
    return { title: "Source supprimée :", msg: row.name, ctx: "Ses topics et tes notes sont conservés." };
  });
}

/** « Récupérer maintenant » — ignores the enabled flag and any pause. */
export async function fetchSourceNow(formData: FormData) {
  return adminAction("#sources", async () => {
    const sourceId = id(formData.get("id"));
    const db = getDb();
    const [source] = await db.select().from(sources).where(eq(sources.id, sourceId));
    if (!source) throw new ActionError("Source introuvable.");
    const res = await fetchSource(db, source);
    switch (res.status) {
      case "ok":
        return {
          title: "Source récupérée :",
          msg: res.inserted === 0 ? "aucun nouveau topic" : plural(res.inserted, "nouveau topic", "nouveaux topics"),
          ctx: res.firstImport ? `${source.name} · import initial, marqués comme lus` : source.name,
        };
      case "not-modified":
        return { title: "Source récupérée :", msg: "aucun changement (304)", ctx: source.name };
      case "error":
        throw new ActionError("Échec :", res.error + (res.paused ? " · source en pause 1 h" : ""), source.name);
    }
  });
}
