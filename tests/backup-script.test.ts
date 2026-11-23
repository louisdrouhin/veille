/**
 * scripts/backup.sh (run by the `backup` compose service) with stub `pg_dump`
 * and `date` commands on the PATH: dump file, atomic write, failure, retention
 * and the "is a dump due?" rule.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(import.meta.dirname, "..", "scripts", "backup.sh");

let dir: string;
let bin: string;
let backups: string;

/** Fake clock: `date` answers for "2026-11-23 <hour>:30". */
function setClock(hour: string) {
  writeFileSync(
    path.join(bin, "date"),
    `#!/bin/sh
case "$1" in
  +%Y-%m-%d) echo 2026-11-23 ;;
  +%Y-%m-%d_%H%M) echo 2026-11-23_${hour}30 ;;
  +%H) echo ${hour} ;;
  *) echo 2026-11-23T${hour}:30:00+0100 ;;
esac
`,
  );
  chmodSync(path.join(bin, "date"), 0o755);
}

function setPgDump(ok: boolean) {
  // Writes its --file argument like the real pg_dump (custom format header), or fails half-way.
  writeFileSync(
    path.join(bin, "pg_dump"),
    `#!/bin/sh
for a in "$@"; do case "$a" in --file=*) f="\${a#--file=}" ;; esac; done
printf 'PGDMP fake dump of %s' "$PGDATABASE" > "$f"
${ok ? "exit 0" : "echo 'pg_dump: error: connection refused' >&2; exit 1"}
`,
  );
  chmodSync(path.join(bin, "pg_dump"), 0o755);
}

function run(arg: string) {
  const res = spawnSync("sh", [SCRIPT, arg], {
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, BACKUP_DIR: backups, PGDATABASE: "veille", BACKUP_HOUR: "3" },
    encoding: "utf8",
  });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

const files = () => readdirSync(backups).sort();
const touch = (name: string) => writeFileSync(path.join(backups, name), "old");

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "veille-backup-"));
  bin = path.join(dir, "bin");
  backups = path.join(dir, "backups");
  for (const d of [bin, backups]) spawnSync("mkdir", ["-p", d]);
  setClock("03");
  setPgDump(true);
});

describe("backup.sh once", () => {
  it("writes a dated custom-format dump, readable by its owner only", () => {
    const res = run("once");
    expect(res.code).toBe(0);
    expect(res.out).toMatch(/sauvegarde OK : veille-2026-11-23_0330\.dump/);
    expect(files()).toEqual(["veille-2026-11-23_0330.dump"]);
    expect(readFileSync(path.join(backups, "veille-2026-11-23_0330.dump"), "utf8")).toBe("PGDMP fake dump of veille");
    if (process.platform !== "win32") expect(statSync(path.join(backups, "veille-2026-11-23_0330.dump")).mode & 0o777).toBe(0o600);
  });

  it("on pg_dump failure: exit 1, no dump and no partial file left", () => {
    setPgDump(false);
    const res = run("once");
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/ERREUR : pg_dump a échoué/);
    expect(files()).toEqual([]);
  });

  it("a failure never deletes the previous dumps", () => {
    for (let d = 10; d <= 20; d++) touch(`veille-2026-11-${d}_0300.dump`);
    setPgDump(false);
    run("once");
    expect(files()).toHaveLength(11);
  });

  it("keeps the 7 most recent dumps (one week) and only touches its own files", () => {
    for (let d = 14; d <= 22; d++) touch(`veille-2026-11-${d}_0300.dump`);
    touch("notes.txt");
    const res = run("once");
    expect(res.code).toBe(0);
    // 9 old dumps + the new one: the 3 oldest go.
    expect(files()).toEqual([
      "notes.txt",
      "veille-2026-11-17_0300.dump",
      "veille-2026-11-18_0300.dump",
      "veille-2026-11-19_0300.dump",
      "veille-2026-11-20_0300.dump",
      "veille-2026-11-21_0300.dump",
      "veille-2026-11-22_0300.dump",
      "veille-2026-11-23_0330.dump",
    ]);
    expect(res.out).toMatch(/supprimé \(rétention : 7\) : veille-2026-11-14_0300\.dump/);
  });
});

describe("backup.sh due", () => {
  it("is due when there is no dump at all, whatever the hour", () => {
    setClock("01");
    expect(run("due").out.trim()).toBe("yes");
  });

  it("not before BACKUP_HOUR when yesterday's dump exists, due from then on", () => {
    touch("veille-2026-11-22_0300.dump");
    setClock("02");
    expect(run("due").out.trim()).toBe("no");
    setClock("03");
    expect(run("due").out.trim()).toBe("yes");
    setClock("18");
    expect(run("due").out.trim()).toBe("yes");
  });

  it("not due again once today's dump is done (restart-safe)", () => {
    touch("veille-2026-11-23_0300.dump");
    setClock("09");
    expect(run("due").out.trim()).toBe("no");
  });
});
