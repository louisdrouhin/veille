/**
 * Fills an EMPTY database with demo data (dev only): a demo account, forums,
 * sources, read / unread topics and personal notes. No network access: topics
 * are inserted directly, the worker is not needed.
 *
 *   npm run db:seed
 *
 * Refuses to run if the database already contains forums or accounts.
 */
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/lib/db";
import { forums, products, replies, sources, stackItems, stackStatus, topics, user, vulnerabilities, type AffectedRange } from "@/lib/db/schema";
import { normalizeUrl } from "@/lib/feeds/normalize-url";
import { recomputeAlerts } from "@/lib/stack/alerts";
import { syncCatalog } from "@/lib/stack/catalog";
import type { FetchedVuln } from "@/lib/stack/sources/types";
import { storeVulns } from "@/lib/stack/sync";
import { createUser } from "@/lib/users";

const DEMO_EMAIL = "demo@veille.local";
const DEMO_PASSWORD = "demo-veille-2026";

const db = getDb();
const HOUR = 3600_000;
const now = Date.now();
const ago = (hours: number) => new Date(now - hours * HOUR);

const FORUMS = [
  { slug: "securite", name: "Sécurité", icon: "sec", description: "CVE, advisories, retours d'incidents." },
  { slug: "infra", name: "Infra & Ops", icon: "ops", description: "Linux, conteneurs, réseau, observabilité." },
  { slug: "dev-web", name: "Dev web", icon: "web", description: "Navigateurs, frameworks, standards." },
  { slug: "labo", name: "Labo", icon: "lab", description: "Projets perso, expérimentations." },
] as const;

const SOURCES: { forum: (typeof FORUMS)[number]["slug"]; name: string; url: string; enabled?: boolean; error?: string }[] = [
  { forum: "securite", name: "CERT-FR", url: "https://www.cert.ssi.gouv.fr/feed/" },
  { forum: "securite", name: "Krebs on Security", url: "https://krebsonsecurity.com/feed/" },
  { forum: "infra", name: "LWN.net", url: "https://lwn.net/headlines/rss" },
  {
    forum: "infra",
    name: "Blog Kubernetes",
    url: "https://kubernetes.io/feed.xml",
    error: "HTTP 503 Service Unavailable",
  },
  { forum: "dev-web", name: "web.dev", url: "https://web.dev/feed.xml" },
  { forum: "dev-web", name: "Mozilla Hacks", url: "https://hacks.mozilla.org/feed/" },
  { forum: "labo", name: "Simon Willison", url: "https://simonwillison.net/atom/everything/", enabled: false },
];

const TITLES: Record<string, string[]> = {
  "CERT-FR": [
    "Multiples vulnérabilités dans le noyau Linux",
    "Vulnérabilité critique dans OpenSSH (exécution de code à distance)",
    "Bulletin d'actualité : campagne d'hameçonnage ciblant les PME",
    "Multiples vulnérabilités dans Mozilla Firefox",
  ],
  "Krebs on Security": [
    "Inside a ransomware gang's affiliate program",
    "Patch Tuesday: 3 zero-days fixed this month",
    "SIM-swapping crew charged after crypto thefts",
  ],
  "LWN.net": [
    "A look at the 6.18 merge window",
    "Rethinking the page cache for large folios",
    "Debian discusses its next init system defaults",
    "The state of eBPF tooling in 2026",
  ],
  "Blog Kubernetes": ["Kubernetes v1.36: what's new in scheduling", "Sidecar containers graduate to stable"],
  "web.dev": [
    "Baseline 2026: features you can use everywhere",
    "Speculation rules in practice",
    "Building accessible disclosure widgets",
  ],
  "Mozilla Hacks": ["Faster WebAssembly startup with lazy compilation", "CSS anchor positioning lands in Firefox"],
  "Simon Willison": ["Notes on running a personal search engine", "SQLite tricks I keep forgetting"],
};

const NOTES = [
  "À tester sur le serveur de prod avant vendredi.",
  "Résumé : rien d'urgent pour nous, on n'utilise pas ce composant.",
  "Lien à partager avec l'équipe infra.",
];

async function main() {
  const [{ n: forumCount } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(forums);
  const [{ n: userCount } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(user);
  if (forumCount > 0 || userCount > 0) {
    console.error("La base n'est pas vide : seed annulé (supprime le dossier .pglite pour repartir de zéro).");
    process.exitCode = 1;
    return;
  }

  await createUser(db, { email: DEMO_EMAIL, password: DEMO_PASSWORD, name: "Démo" });

  const forumRows = await db
    .insert(forums)
    .values(FORUMS.map((f, position) => ({ ...f, position })))
    .returning({ id: forums.id, slug: forums.slug });
  const forumId = (slug: string) => {
    const f = forumRows.find((r) => r.slug === slug);
    if (!f) throw new Error(`Forum inconnu : ${slug}`);
    return f.id;
  };

  const sourceRows = await db
    .insert(sources)
    .values(
      SOURCES.map((s) => ({
        forumId: forumId(s.forum),
        name: s.name,
        url: s.url,
        enabled: s.enabled ?? true,
        lastFetchedAt: s.error ? ago(30) : ago(0.3),
        lastError: s.error ?? null,
        consecutiveFailures: s.error ? 3 : 0,
        pausedUntil: s.error ? new Date(now + HOUR) : null,
      })),
    )
    .returning({ id: sources.id, name: sources.name, forumId: sources.forumId, url: sources.url });

  let i = 0;
  let topicCount = 0;
  let noteCount = 0;
  for (const src of sourceRows) {
    const site = new URL(src.url).origin;
    for (const [k, title] of (TITLES[src.name] ?? []).entries()) {
      const publishedAt = ago(2 + i * 5);
      const url = `${site}/demo/${k + 1}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}?utm_source=rss`;
      // Roughly one topic in three stays unread; the most recent ones are more likely unread.
      const read = i % 3 !== 0 && i > 1;
      const notes: string[] = i % 4 === 1 ? [NOTES[i % NOTES.length] ?? ""] : i % 7 === 2 ? NOTES.slice(0, 2) : [];
      const [topic] = await db
        .insert(topics)
        .values({
          forumId: src.forumId,
          sourceId: src.id,
          title,
          url,
          normalizedUrl: normalizeUrl(url) ?? url,
          excerpt: `${title}. Extrait de démonstration : ce texte remplace le résumé que le worker extrait du flux RSS de ${src.name}.`,
          publishedAt,
          lastActivityAt: publishedAt,
          replyCount: notes.length,
          readAt: read ? new Date(publishedAt.getTime() + HOUR) : null,
        })
        .returning({ id: topics.id });
      if (!topic) throw new Error(`Topic non inséré : ${title}`);
      for (const [j, content] of notes.entries()) {
        await db.insert(replies).values({
          topicId: topic.id,
          type: "note",
          author: "Démo",
          content,
          createdAt: new Date(publishedAt.getTime() + (j + 1) * HOUR),
        });
      }
      topicCount++;
      noteCount += notes.length;
      i++;
    }
  }

  const stack = await seedStack();
  console.log(
    `Base de démo prête : ${stack} logiciels fictifs dans Ma stack, ${forumRows.length} forums, ${sourceRows.length} sources, ${topicCount} topics, ${noteCount} notes.`,
  );
  console.log(`Connexion : ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

/**
 * Ma stack (docs/design/3.0) with FICTIONAL data only: made-up versions and CVE-2099-… identifiers,
 * never a real inventory. Products are marked as checked: no network access.
 */
async function seedStack(): Promise<number> {
  await syncCatalog(db);
  const all = await db.select().from(products);
  const p = (key: string) => all.find((x) => x.key === key)!;
  const checked = ago(0.2);
  const latest: Record<string, [string, string[]]> = {
    vaultwarden: ["1.40.2", ["1.40.2", "1.40.1", "1.40.0"]],
    nextcloud: ["31.0.2", ["31.0.2", "31.0.1", "30.0.9"]],
  };
  for (const key of ["vaultwarden", "fortios", "proxmox-ve", "openssh", "nextcloud", "windows-server-2022"]) {
    const [v, recent] = latest[key] ?? [null, []];
    await db.update(products).set({ nvdSyncedAt: checked, githubSyncedAt: p(key).githubRepo ? checked : null, latestVersion: v, recentVersions: recent }).where(eq(products.id, p(key).id));
  }
  const vuln = (ref: string, cvss: number, range: AffectedRange, extra: Partial<FetchedVuln> = {}): FetchedVuln => ({
    ref,
    cveId: ref,
    descriptionEn: "Fictional vulnerability for the demo: a crafted request lets a remote attacker run code.",
    cvss,
    severity: null,
    exploited: false,
    publishedAt: ago(30),
    updatedAt: ago(5),
    sources: [{ kind: "nvd", ref, url: `https://nvd.nist.gov/vuln/detail/${ref}` }],
    ranges: [range],
    ...extra,
  });
  await storeVulns(db, p("fortios"), "nvd", [
    vuln("CVE-2099-10001", 9.8, { start: "7.2.0", startIncluding: true, end: "7.2.9", endIncluding: false, src: "nvd" }, { exploited: true, publishedAt: ago(20) }),
    vuln("CVE-2099-10002", 5.3, { start: "7.2.0", startIncluding: true, end: "7.2.11", endIncluding: false, src: "nvd" }),
  ]);
  await storeVulns(db, p("vaultwarden"), "github", [vuln("CVE-2099-10003", 7.5, { end: "1.40.0", endIncluding: false, src: "github" })]);
  await storeVulns(db, p("openssh"), "nvd", [vuln("CVE-2099-10004", 8.1, { start: "8.5p1", startIncluding: true, end: "9.7p1", endIncluding: true, src: "nvd" })]);
  await storeVulns(db, p("proxmox-ve"), "nvd", [vuln("CVE-2099-10005", 3.1, { end: "8.1.4", endIncluding: false, src: "nvd" })]);
  await db
    .update(vulnerabilities)
    .set({
      titleFr: "Exécution de code arbitraire à distance dans FortiOS (démo)",
      summaryFr: "Vulnérabilité fictive de démonstration : une requête forgée permet à un attaquant non authentifié d'exécuter du code à distance.",
      actionsFr: ["Se référer au bulletin de sécurité de l'éditeur pour l'obtention des correctifs."],
      textSource: "certfr",
    })
    .where(eq(vulnerabilities.ref, "CVE-2099-10001"));
  await db
    .update(vulnerabilities)
    .set({
      titleFr: "Contournement de l'authentification dans Vaultwarden (démo)",
      summaryFr: "Vulnérabilité fictive : un jeton de session reste valide après un changement de mot de passe.",
      actionsFr: ["Mettre à jour vers la 1.40.0 ou une version ultérieure."],
      textSource: "ai",
    })
    .where(eq(vulnerabilities.ref, "CVE-2099-10003"));
  const items = [
    { productId: p("fortios").id, version: "7.2.4", context: "work" as const },
    { productId: p("vaultwarden").id, version: "1.39.0", context: "homelab" as const },
    { productId: p("openssh").id, version: "9.6p1", context: "homelab" as const },
    { productId: p("proxmox-ve").id, version: "8.1.3", context: "homelab" as const },
    { productId: p("nextcloud").id, version: "30.0.9", context: "homelab" as const },
    { productId: p("windows-server-2022").id, version: "10.0.20348.9999", context: "work" as const },
    { customName: "Annuaire maison", version: "3.2", context: "work" as const },
  ];
  await db.insert(stackItems).values(items);
  await recomputeAlerts(db, { silent: true });
  await db.insert(stackStatus).values({ id: 1, lastCheckAt: checked, lastFullCheckAt: checked });
  return items.length;
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDb();
}
