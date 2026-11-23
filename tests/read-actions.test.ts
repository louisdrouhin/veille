/**
 * « Tout marquer comme lu » (lib/actions/topics.ts): database update and the
 * revalidatePath calls that refresh the forum list and the home counters.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1", name: "Moi" } })) }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));

const { revalidatePath } = await import("next/cache");
const { markForumRead } = await import("@/lib/actions/topics");

const { forums, topics } = schema;
let secu: number;
let infra: number;

beforeEach(async () => {
  vi.mocked(revalidatePath).mockClear();
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  state.db = pg as unknown as Db;
  const created = await state.db
    .insert(forums)
    .values([
      { name: "Sécurité", slug: "securite", position: 1 },
      { name: "Infra", slug: "infra", position: 2 },
    ])
    .returning({ id: forums.id });
  secu = created[0]!.id;
  infra = created[1]!.id;
  const now = new Date();
  await state.db.insert(topics).values(
    [1, 2, 3].map((i) => ({
      forumId: i < 3 ? secu : infra,
      title: `Topic ${i}`,
      url: `https://example.org/${i}`,
      normalizedUrl: `https://example.org/${i}`,
      excerpt: "",
      publishedAt: now,
      lastActivityAt: now,
    })),
  );
});

const unreadIn = async (forumId: number) =>
  (await state.db.select({ id: topics.id, forumId: topics.forumId }).from(topics).where(isNull(topics.readAt))).filter(
    (t) => t.forumId === forumId,
  ).length;
const revalidated = () => vi.mocked(revalidatePath).mock.calls.map((c) => c[0]).sort();

describe("markForumRead (« Tout marquer comme lu »)", () => {
  it("marks the whole forum read, revalidates the list and the home counters, then redirects with a toast", async () => {
    const form = new FormData();
    form.set("forumId", String(secu));
    await expect(markForumRead(form)).rejects.toMatchObject({ url: expect.stringMatching(/^\/f\/securite\?toast=ok/) });
    expect(await unreadIn(secu)).toBe(0);
    expect(await unreadIn(infra)).toBe(1); // other forums untouched
    expect(revalidated()).toEqual(["/", "/f/securite"]);
  });
});
