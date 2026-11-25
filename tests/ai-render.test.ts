/**
 * Results of « Résumer » / « Traduire » made before are part of the topic page's server render:
 * a summary made on the phone is shown on the computer, without any call to Gemini.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/actions/topics", () => ({ reloadArticle: vi.fn() }));
vi.mock("@/lib/actions/ai", () => ({ runAi: vi.fn() }));

const { generateAi, getStoredAiOutputs, AI_FORMAT } = await import("@/lib/ai/service");
const { aiConfig } = await import("@/lib/ai/config");
const { ReaderArticle } = await import("@/components/thread/reader-article");

const { aiOutputs, articleContents, forums, topics } = schema;
const NOW = new Date("2026-11-25T10:00:00Z");
const ARTICLE =
  "<p>The new version of the hypervisor is available for all users and it brings many fixes to the storage layer.</p>" +
  "<p>This release is the first to support the new backend, and it is faster than the previous one.</p>";
const TRANSLATED = "<p>La nouvelle version de l'hyperviseur est disponible.</p>";

let topicId: number;
let topic: { id: number; url: string; excerpt: string };

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
  const html = renderToString(await ReaderArticle({ topic }));
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
  topic = { id: topicId, url: "https://blog.example.org/9-2", excerpt: "" };
  await state.db.insert(articleContents).values({ topicId, html: ARTICLE, source: "feed", fetchedAt: NOW });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("AI results on the topic page", () => {
  it("nothing made yet: « Résumer » and « Traduire en français », no call to Gemini on display", async () => {
    const { html, network } = await renderOnComputer();
    expect(html).toContain(">Résumer<");
    expect(html).toContain(">Traduire en français<");
    expect(html).not.toContain("Masquer le résumé");
    expect(network).not.toHaveBeenCalled();
  });

  it("a summary made in one session (phone) is shown in another (computer), from the database only", async () => {
    const gemini = phoneGemini();
    const made = await generateAi(state.db, { topicId, kind: "summary", userId: "phone-session" }, { fetch: gemini as unknown as typeof fetch, now: NOW });
    expect(made).toMatchObject({ ok: true, cached: false });
    expect(gemini).toHaveBeenCalledTimes(1);

    const { html, network } = await renderOnComputer();
    expect(network).not.toHaveBeenCalled();
    expect(html).toContain('aria-label="Résumé"');
    expect(html).toContain("<li>Nouvelle version de l'hyperviseur.</li>");
    expect(html).toContain(">Masquer le résumé<");
    expect(html).not.toContain(">Résumer<");
    // The article itself is still shown.
    expect(html).toContain("The new version of the hypervisor");

    // A second click from the computer is served by the cache, again without Gemini.
    const again = await generateAi(state.db, { topicId, kind: "summary", userId: "computer-session" }, { fetch: network as unknown as typeof fetch, now: NOW });
    expect(again).toMatchObject({ ok: true, cached: true });
    expect(network).not.toHaveBeenCalled();
  });

  it("an existing translation does not replace the article: « Voir la traduction », with the translation in the page (offline too)", async () => {
    const gemini = phoneGemini();
    await generateAi(state.db, { topicId, kind: "translation", userId: "phone-session" }, { fetch: gemini as unknown as typeof fetch, now: NOW });
    const { html, network } = await renderOnComputer();
    expect(network).not.toHaveBeenCalled();
    expect(html).toContain(">Voir la traduction<");
    expect(html).not.toContain(">Traduire en français<");
    expect(html).not.toContain('aria-label="Traduction en français"');
    // The original is visible (not inside a hidden wrapper).
    expect(html).toMatch(/<div>\s*<div id="article" class="reader">/);
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
