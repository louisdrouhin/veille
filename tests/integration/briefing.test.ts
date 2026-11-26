/**
 * Briefing du matin (3.4) through the production driver (postgres-js) on a real PostgreSQL 17: settings (integer
 * array of the Mes services forums), selection queries with dates, the briefing saved then frozen, stale
 * preparation, purge. PGlite accepts values postgres-js rejects (dates or arrays in raw sql`` fragments).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { startPostgres, type TestDatabase } from "./helpers/postgres";

vi.mock("server-only", () => ({}));
const { makeBriefing, runDueBriefing, briefingBusy, purgeBriefings } = await import("@/lib/briefing/generate");
const { getBriefingSettings, updateBriefingSettings, serviceForums } = await import("@/lib/briefing/settings");

const gemini = (async (_u: string, init: RequestInit) => {
  const user = (JSON.parse(String(init.body)) as { contents: { parts: { text: string }[] }[] }).contents[0]!.parts[0]!.text;
  const data = JSON.parse(/^<<<EXTRAITS [\w-]+>>>\n([\s\S]*)\n<<<FIN EXTRAITS [\w-]+>>>$/.exec(user)![1]!) as Record<string, unknown>;
  const out = Object.fromEntries(Object.keys(data).map((k) => [k, "Une phrase factuelle."]));
  return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(out) }] } }] });
}) as unknown as typeof fetch;
const AI = { apiKey: "k", model: "m", translateModel: "t" };

describe("Briefing du matin (real PostgreSQL, postgres-js)", () => {
  let pg: TestDatabase;
  let db: Db;

  beforeAll(async () => {
    pg = await startPostgres();
    db = drizzle(pg.sql, { schema }) as unknown as Db;
    const fs = await db
      .insert(schema.forums)
      .values([
        { name: "Actus", slug: "actus" },
        { name: "Mes Services", slug: "services" },
      ])
      .returning();
    const [s] = await db.insert(schema.sources).values({ forumId: fs[0]!.id, name: "Source A", url: "https://a.example/feed" }).returning();
    const at = new Date("2026-11-25T20:00:00Z");
    const ts = await db
      .insert(schema.topics)
      .values(
        [
          ["Sujet repris", fs[0]!.id],
          ["Nouvelle version 2.0", fs[1]!.id],
          ["Autre sujet", fs[0]!.id],
        ].map(([title, forumId]) => ({ forumId: forumId as number, sourceId: s!.id, title: title as string, url: `https://a.example/${title}`, normalizedUrl: `a.example/${title}`, excerpt: "Extrait 2.0.", publishedAt: at, lastActivityAt: at, createdAt: at })),
      )
      .returning();
    await db.insert(schema.replies).values({ topicId: ts[0]!.id, type: "source", author: "Source B", title: "Repris", content: "Idem.", createdAt: at });
  }, 120_000);

  afterAll(async () => {
    await pg?.stop();
  });

  it("settings with the Mes services forums (pre-filled), a briefing made and frozen, busy and purge", async () => {
    const s = await getBriefingSettings(db);
    expect(s.servicesForumIds).toHaveLength(1);
    expect(await serviceForums(db, s)).toEqual(s.servicesForumIds);
    await updateBriefingSettings(db, { enabled: true, servicesForumIds: s.servicesForumIds });

    const now = new Date("2026-11-26T06:00:30Z");
    const b = await runDueBriefing(db, { ai: AI, vapid: null, fetch: gemini, now });
    expect(b).toMatchObject({ day: "2026-11-26", ai: "ok", step: "done", articleCount: 4 });
    expect(b!.content.featured.map((p) => p.title)).toEqual(["Sujet repris"]);
    expect(b!.content.services.map((p) => p.title)).toEqual(["Nouvelle version 2.0"]);
    expect(b!.content.brief.map((p) => p.title)).toEqual(["Autre sujet"]);
    expect(b!.content.featured[0]!.sentence).toBe("Une phrase factuelle.");

    // Made once.
    expect(await runDueBriefing(db, { ai: AI, vapid: null, fetch: gemini, now: new Date("2026-11-26T06:05:00Z") })).toBeNull();
    const again = await makeBriefing(db, { day: "2026-11-26", since: new Date(0), kind: "test" }, { ai: AI, vapid: null, fetch: gemini, now });
    expect(again.id).toBe(b!.id);

    expect(await briefingBusy(db, new Date("2026-11-27T05:45:00Z"))).toBe(true);
    expect(await briefingBusy(db, new Date("2026-11-26T12:00:00Z"))).toBe(false);
    expect(await purgeBriefings(db, new Date("2027-01-01T00:00:00Z"))).toBe(1);
  });
});
