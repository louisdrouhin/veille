/**
 * Version comparison per scheme (docs/design/3.0 § 2.2), never a plain string comparison:
 * - semver: 1.32.0, v1.32.0-rc.1 (build metadata « +… » ignored);
 * - debian: OpenSSH style 9.4p1, and Debian packages 1:9.2p1-2+deb12u3 (epoch, upstream, revision);
 * - vendor: 8.0 U2, 10.0.20348.2340, 2022, 7.2.2-72806.
 * A version is cut into numbers and words; separators (. - _ + space) do not count. Pre-release words
 * (alpha, beta, rc…) come before the release, post-release words (p, U, SP…) after it: 9.4 < 9.4p1,
 * 8.0 < 8.0 U2, 1.0rc1 < 1.0. A version that cannot be read (unknown word, no leading number…) gives
 * null: it is shown as « Version non reconnue », never as « à jour ».
 */
import type { AffectedRange, VersionScheme } from "@/lib/db/schema";

type Token = { n: number } | { tag: string; pre: number | null };
export type ParsedVersion = { epoch: number; main: Token[]; revision: Token[] };

/** Pre-release words, lowest first (Debian's « ~ » sorts before anything). */
const PRE = ["~", "dev", "snapshot", "nightly", "canary", "alpha", "a", "beta", "b", "pre", "preview", "rc", "cr"];
/** Post-release words, with their aliases (« update_2 » of NVD is « U2 »). */
const POST: Record<string, string> = {
  p: "p",
  patch: "p",
  pl: "p",
  u: "u",
  update: "u",
  upd: "u",
  sp: "sp",
  servicepack: "sp",
  r: "r",
  rev: "r",
  release: "r",
  hotfix: "hf",
  hf: "hf",
  fix: "hf",
  post: "post",
  build: "build",
  ga: "ga",
  lts: "lts",
  final: "ga",
};

const MAX_LENGTH = 64;
const ALLOWED = /^[0-9a-z.\-_+~: ]+$/;

function tokenize(s: string, anyWord: boolean): Token[] | null {
  const tokens: Token[] = [];
  for (const m of s.matchAll(/(\d+)|([a-z]+)|(~)/g)) {
    if (m[1] !== undefined) {
      const n = Number(m[1].length > 15 ? m[1].slice(0, 15) : m[1]);
      tokens.push({ n });
      continue;
    }
    const word = m[2] ?? "~";
    const pre = PRE.indexOf(word);
    if (pre >= 0) tokens.push({ tag: word, pre });
    else if (POST[word]) tokens.push({ tag: POST[word]!, pre: null });
    else if (anyWord) tokens.push({ tag: word, pre: null });
    else return null;
  }
  return tokens;
}

/** Parses a version with its scheme; null when it cannot be read. */
export function parseVersion(raw: string, scheme: VersionScheme): ParsedVersion | null {
  let s = raw.trim().toLowerCase();
  if (!s || s.length > MAX_LENGTH || !ALLOWED.test(s)) return null;
  let epoch = 0;
  let revision: Token[] = [];
  if (scheme === "debian") {
    const e = /^(\d+):(.+)$/.exec(s);
    if (e) {
      epoch = Number(e[1]);
      s = e[2]!;
    }
    const dash = s.lastIndexOf("-");
    if (dash > 0) {
      const rev = tokenize(s.slice(dash + 1), true);
      if (!rev) return null;
      revision = rev;
      s = s.slice(0, dash);
    }
  } else {
    if (s.includes(":")) return null;
    s = s.replace(/^v(?=\d)/, "");
    if (scheme === "semver") s = s.replace(/\+.*$/, "");
  }
  if (!/^\d/.test(s)) return null;
  const main = tokenize(s, false);
  if (!main || main.length === 0) return null;
  return { epoch, main, revision };
}

function compareToken(a: Token, b: Token): number {
  if ("n" in a && "n" in b) return Math.sign(a.n - b.n);
  if ("n" in a) return 1; // 1.0.1 > 1.0rc1, 1.0.1 > 1.0p1
  if ("n" in b) return -1;
  if (a.pre !== null && b.pre !== null) return Math.sign(a.pre - b.pre);
  if (a.pre !== null) return -1; // pre-release < post-release
  if (b.pre !== null) return 1;
  return a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0;
}

/** What the longer list has beyond the shorter: trailing zeros are nothing, a pre-release is less. */
function compareRest(rest: Token[]): number {
  for (const t of rest) {
    if ("n" in t) {
      if (t.n !== 0) return 1;
      continue;
    }
    return t.pre !== null ? -1 : 1;
  }
  return 0;
}

function compareTokens(a: Token[], b: Token[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const c = compareToken(a[i]!, b[i]!);
    if (c !== 0) return c;
  }
  if (a.length === b.length) return 0;
  return a.length > b.length ? compareRest(a.slice(len)) : -compareRest(b.slice(len));
}

export function compareParsed(a: ParsedVersion, b: ParsedVersion): number {
  return Math.sign(a.epoch - b.epoch) || compareTokens(a.main, b.main) || compareTokens(a.revision, b.revision);
}

/** -1, 0 or 1; null when either version cannot be read. */
export function compareVersions(a: string, b: string, scheme: VersionScheme): number | null {
  const pa = parseVersion(a, scheme);
  const pb = parseVersion(b, scheme);
  return pa && pb ? compareParsed(pa, pb) : null;
}

/** The version without its post-release part (« 8.0 U2 » → « 8.0 »), for « 8.0, any update » ranges. */
function release(v: ParsedVersion): ParsedVersion {
  const cut = v.main.findIndex((t) => "tag" in t && t.pre === null);
  return cut < 0 ? { ...v, revision: [] } : { epoch: v.epoch, main: v.main.slice(0, cut), revision: [] };
}

function inRange(v: ParsedVersion, r: AffectedRange, scheme: VersionScheme): boolean {
  if (r.exact !== undefined) {
    const exact = parseVersion(r.exact, scheme);
    if (!exact) return false;
    return compareParsed(v, exact) === 0 || (r.anyUpdate === true && compareParsed(release(v), release(exact)) === 0);
  }
  if (r.start !== undefined) {
    const start = parseVersion(r.start, scheme);
    if (!start) return false;
    const c = compareParsed(v, start);
    if (c < 0 || (c === 0 && r.startIncluding === false)) return false;
  }
  if (r.end !== undefined) {
    const end = parseVersion(r.end, scheme);
    if (!end) return false;
    const c = compareParsed(v, end);
    if (c > 0 || (c === 0 && r.endIncluding !== true)) return false;
  }
  return true;
}

/** Whether the version is in one of the ranges; null when the version cannot be read. */
export function isAffected(version: string, ranges: readonly AffectedRange[], scheme: VersionScheme): boolean | null {
  const v = parseVersion(version, scheme);
  if (!v) return null;
  return ranges.some((r) => inRange(v, r, scheme));
}

/**
 * The fix to suggest for this version: the lowest fixed version above it, from the same branch
 * (same first number) when there is one. Null when none is above it.
 */
export function nearestFix(version: string, fixed: readonly string[], scheme: VersionScheme): string | null {
  const v = parseVersion(version, scheme);
  if (!v) return null;
  const above = fixed
    .map((f) => ({ f, p: parseVersion(f, scheme) }))
    .filter((x): x is { f: string; p: ParsedVersion } => x.p !== null && compareParsed(x.p, v) > 0)
    .sort((x, y) => compareParsed(x.p, y.p));
  const major = v.main[0];
  const sameBranch = above.find((x) => major && "n" in major && "n" in x.p.main[0]! && x.p.main[0].n === major.n);
  return (sameBranch ?? above[0])?.f ?? null;
}

/** Versions sorted newest first (unreadable ones dropped). */
export function sortVersionsDesc(versions: readonly string[], scheme: VersionScheme): string[] {
  return versions
    .map((f) => ({ f, p: parseVersion(f, scheme) }))
    .filter((x): x is { f: string; p: ParsedVersion } => x.p !== null)
    .sort((x, y) => compareParsed(y.p, x.p))
    .map((x) => x.f);
}

/** NVD writes a version and its update apart (9.8 + p1, 8.0 + update_2): one readable string. */
export function nvdVersion(version: string, update: string | undefined): string {
  if (!update || update === "*" || update === "-") return version;
  const u = update.replace(/^update_?(\d+)$/i, "U$1").replace(/_/g, " ");
  return /^p\d+$/i.test(u) ? `${version}${u}` : `${version} ${u}`;
}
