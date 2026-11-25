/**
 * The topic's article and its action bar (docs/design/v3.1), rendered on the server. Results of
 * « Résumer » / « Traduire » made before are part of it: a summary made on the phone is shown on
 * the computer, without any call to Gemini.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createElement } from "react";
import { parseHTML } from "linkedom";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/actions/topics", () => ({ reloadArticle: vi.fn() }));
vi.mock("@/lib/actions/ai", () => ({ runAi: vi.fn() }));
vi.mock("@/lib/actions/lists", () => ({ toggleTopicInList: vi.fn(), createList: vi.fn() }));
vi.mock("next/link", () => ({ default: (props: { href: string }) => createElement("a", props) }));

const { generateAi, getStoredAiOutputs, AI_FORMAT } = await import("@/lib/ai/service");
const { aiConfig } = await import("@/lib/ai/config");
const { TopicArticle, ArticleFetchedAt } = await import("@/components/thread/topic-article");

const { aiOutputs, articleContents, forums, topics } = schema;
const NOW = new Date("2026-11-25T10:00:00Z");
const ARTICLE =
  "<p>The new version of the hypervisor is available for all users and it brings many fixes to the storage layer.</p>" +
  "<p>This release is the first to support the new backend, and it is faster than the previous one.</p>";
const TRANSLATED = "<p>La nouvelle version de l'hyperviseur est disponible.</p>";

let topicId: number;
let topic: { id: number; url: string; excerpt: string; title: string };
const saved = { lists: [], selected: [] };

/** Gemini as seen from the phone: answers once per kind. */
function phoneGemini() {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body)) as { generationConfig: { responseMimeType?: string }; contents: { parts: { text: string }[] }[] };
    const text = body.generationConfig.responseMimeType
      ? JSON.stringify(
          Object.fromEntries(
            Object.keys(JSON.parse(/>>>\n([\s\S]*)\n<<</.exec(body.contents[0]!.parts[0]!.text)![1]!) as object).map((k) => [k, "La nouvelle version de l'hyperviseur est disponible."]),
          ),
        )
      : "- Nouvelle version de l'hyperviseur.\n- Plus rapide.\n- Nouveau stockage.";
    return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }), { status: 200 });
  });
}

/** The topic page as opened on another device: server render, with any network access recorded. */
async function renderOnComputer() {
  const network = vi.fn(async () => new Response("no network in this test", { status: 599 }));
  vi.stubGlobal("fetch", network);
  const html = renderToString(await TopicArticle({ topic, saved }));
  return { html, network };
}

beforeEach(async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  state.db = pg as unknown as Db;
  const [forum] = await state.db.insert(forums).values({ name: "Labo", slug: "labo" }).returning();
  const [t] = await state.db
    .insert(topics)
    .values({ forumId: forum!.id, title: "Hypervisor 9.2", url: "https://blog.example.org/9-2", normalizedUrl: "https://blog.example.org/9-2", publishedAt: NOW, lastActivityAt: NOW })
    .returning();
  topicId = t!.id;
  topic = { id: topicId, url: "https://blog.example.org/9-2", excerpt: "", title: "Hypervisor 9.2" };
  await state.db.insert(articleContents).values({ topicId, html: ARTICLE, source: "feed", fetchedAt: NOW });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** The rendered HTML as a DOM, to read the bar as a user would. */
function dom(html: string) {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const bar = document.querySelector(`[role="group"][aria-label="Actions sur l'article"]`);
  const tools = document.querySelector('[role="group"][aria-label="Outils IA"]');
  const button = (text: RegExp) =>
    [...(tools?.querySelectorAll("button") ?? [])].find((b) => text.test(b.textContent ?? "")) as HTMLButtonElement | undefined;
  return { document, bar, tools, button };
}

describe("action bar and AI results on the topic page", () => {
  it("nothing made yet: ★ then the AI pill (Résumer, Traduire) on one bar; no call to Gemini on display", async () => {
    const { html, network } = await renderOnComputer();
    const { bar, tools, button } = dom(html);
    expect(network).not.toHaveBeenCalled();
    expect(bar).not.toBeNull();
    expect(bar!.firstElementChild!.getAttribute("aria-label")).toBe("Enregistrer dans une liste");
    expect(tools!.parentElement).toBe(bar);
    // Short labels on mobile, full ones from md.
    expect(button(/Résumer/)!.textContent).toBe("RésumerRésumer");
    expect(button(/Traduire/)!.textContent).toBe("TraduireTraduire en français");
    for (const b of [button(/Résumer/)!, button(/Traduire/)!]) expect(b.getAttribute("aria-pressed")).toBe("false");
    expect(html).not.toContain("Résumé automatique");
  });

  it("a summary made in one session (phone) is shown in another (computer), button active « Masquer », from the database only", async () => {
    const gemini = phoneGemini();
    const made = await generateAi(state.db, { topicId, kind: "summary", userId: "phone-session" }, { fetch: gemini as unknown as typeof fetch, now: NOW });
    expect(made).toMatchObject({ ok: true, cached: false });
    expect(gemini).toHaveBeenCalledTimes(1);

    const { html, network } = await renderOnComputer();
    expect(network).not.toHaveBeenCalled();
    const { document, button } = dom(html);
    const active = button(/Masquer/)!;
    expect(active.getAttribute("aria-pressed")).toBe("true");
    expect(active.getAttribute("aria-label")).toBe("Masquer le résumé");
    expect(active.textContent).toBe("MasquerMasquer le résumé");
    const panel = document.querySelector("section[aria-labelledby]")!;
    expect(document.getElementById(panel.getAttribute("aria-labelledby")!)!.textContent).toBe("Résumé");
    expect(panel.textContent).toContain("Généré par IA");
    expect(panel.innerHTML).toContain("<li>Nouvelle version de l'hyperviseur.</li>");
    expect(panel.textContent).toContain("Résumé automatique de l'article ci-dessous, peut contenir des erreurs.");
    expect(panel.querySelector('button[aria-label="Masquer le résumé"]')).not.toBeNull();
    // The panel comes before the article, which is still shown.
    expect(html.indexOf("Résumé automatique")).toBeLessThan(html.indexOf("The new version of the hypervisor"));

    // A second click from the computer is served by the cache, again without Gemini.
    const again = await generateAi(state.db, { topicId, kind: "summary", userId: "computer-session" }, { fetch: network as unknown as typeof fetch, now: NOW });
    expect(again).toMatchObject({ ok: true, cached: true });
    expect(network).not.toHaveBeenCalled();
  });

  it("an existing translation does not replace the article: the button stays « Traduire » (shown at once on click), the translation is in the page", async () => {
    const gemini = phoneGemini();
    await generateAi(state.db, { topicId, kind: "translation", userId: "phone-session" }, { fetch: gemini as unknown as typeof fetch, now: NOW });
    const { html, network } = await renderOnComputer();
    expect(network).not.toHaveBeenCalled();
    const { document, button } = dom(html);
    expect(button(/Traduire/)!.getAttribute("aria-pressed")).toBe("false");
    expect(html).not.toContain("Voir la traduction");
    expect(html).not.toContain("Traduit de l'anglais");
    // The original is visible, in English.
    const original = document.getElementById("article")!.parentElement!;
    expect(original.hasAttribute("hidden")).toBe(false);
    expect(original.getAttribute("lang")).toBe("en");
    // The stored translation travels with the page as a prop of the client view (RSC payload, so also
    // in the offline copy): « Traduire » shows it at once.
    const tree = (await TopicArticle({ topic, saved })) as React.ReactElement<{ children: React.ReactElement<{ ai: { initialTranslation: { html: string } } }>[] }>;
    const view = tree.props.children.find((c) => c?.props && "ai" in c.props)!;
    expect(view.props.ai.initialTranslation.html).toContain("La nouvelle version de l'hyperviseur est disponible.");
  });

  it("French article: no Traduire, Résumer alone; no key: ★ alone", async () => {
    await state.db
      .update(articleContents)
      .set({
        html:
          "<p>La nouvelle version de l'hyperviseur est disponible pour tous les utilisateurs et elle apporte de nombreux correctifs.</p>" +
          "<p>Cette version est la première qui prend en charge le nouveau stockage, et elle est plus rapide que la précédente.</p>",
      });
    const fr = dom((await renderOnComputer()).html);
    expect(fr.button(/Résumer/)).toBeDefined();
    expect(fr.button(/Traduire/)).toBeUndefined();
    expect(fr.tools!.querySelectorAll("span[aria-hidden]").length).toBe(0); // no separator

    vi.stubEnv("GEMINI_API_KEY", "");
    const noKey = dom((await renderOnComputer()).html);
    expect(noKey.tools).toBeNull();
    expect(noKey.bar!.children).toHaveLength(1); // ★ alone
  });

  it("no « Mode lecture » left; the #1 header says « récupéré le … »; the source link ends the article", async () => {
    const { html } = await renderOnComputer();
    expect(html).not.toMatch(/mode lecture/i);
    const header = renderToString((await ArticleFetchedAt({ topic }))!);
    expect(header).toContain('dateTime="2026-11-25T10:00:00.000Z"');
    expect(header).toMatch(/récupéré le .*25 nov\. 2026 à 11:00/);
    expect(html).toMatch(/blog\.example\.org<\/span> <span aria-hidden="true">↗<\/span>/);
    expect(html).toContain("Recharger l&#x27;article");
  });

  it("only results of the current article version, models and format are loaded", async () => {
    const config = aiConfig()!;
    const row = { topicId, html: TRANSLATED, articleFetchedAt: NOW };
    await state.db.insert(aiOutputs).values([
      { ...row, kind: "summary", model: config.model, format: AI_FORMAT.summary - 1 }, // older format
      { ...row, kind: "translation", model: "another-model", format: AI_FORMAT.translation }, // other model
    ]);
    expect(await getStoredAiOutputs(state.db, topicId, NOW, config)).toEqual({});
    await state.db.insert(aiOutputs).values({ ...row, kind: "translation", model: config.translateModel, format: AI_FORMAT.translation });
    expect(Object.keys(await getStoredAiOutputs(state.db, topicId, NOW, config))).toEqual(["translation"]);
    // The article was reloaded since: stale.
    expect(await getStoredAiOutputs(state.db, topicId, new Date(NOW.getTime() + 1000), config)).toEqual({});
  });
});
