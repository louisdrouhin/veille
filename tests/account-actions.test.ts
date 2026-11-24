/** Mon compte › Apparence: the setTheme server action (lib/actions/account.ts). */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown as Db, cookies: new Map<string, { value: string; options: unknown }>() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: (name: string, value: string, options: unknown) => state.cookies.set(name, { value, options }) }),
}));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u1", name: "Moi" } })) }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));

const { revalidatePath } = await import("next/cache");
const { requireSession } = await import("@/lib/session");
const { setTheme } = await import("@/lib/actions/account");

const theme = async () => (await state.db.select({ theme: schema.user.theme }).from(schema.user))[0]!.theme;

beforeEach(async () => {
  vi.mocked(revalidatePath).mockClear();
  state.cookies.clear();
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  state.db = pg as unknown as Db;
  await state.db.insert(schema.user).values({ id: "u1", name: "Moi", email: "moi@example.com" });
});

describe("setTheme", () => {
  it("defaults to system, then saves the choice on the account and in the cookie", async () => {
    expect(await theme()).toBe("system");
    expect(await setTheme("dark")).toEqual({ ok: true });
    expect(await theme()).toBe("dark");
    expect(state.cookies.get("folders-theme")).toMatchObject({ value: "dark", options: { path: "/", httpOnly: false, sameSite: "lax" } });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("refuses an unknown value without touching anything", async () => {
    expect(await setTheme("blue" as never)).toEqual({ ok: false });
    expect(await theme()).toBe("system");
    expect(state.cookies.size).toBe(0);
  });

  it("checks the session first", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(setTheme("light")).rejects.toThrow("NEXT_REDIRECT");
    expect(await theme()).toBe("system");
  });

  it("the database refuses a value outside the three themes", async () => {
    await expect(state.db.update(schema.user).set({ theme: "blue" as never })).rejects.toThrow();
  });
});
