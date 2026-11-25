#!/usr/bin/env node
// Notes of a GitHub Release: the section of CHANGELOG.md for one version, without its heading.
//   node scripts/release-notes.mjs 2.13.0 > notes.md
// Exits with 1 when the changelog has no section for that version (the release is then refused).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Body of `## <version> — …` up to the next `## `, trimmed; null if there is no such section. */
export function releaseNotes(changelog, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^## ${escaped} — .*$`, "m");
  const match = heading.exec(changelog);
  if (!match) return null;
  const rest = changelog.slice(match.index + match[0].length);
  const next = rest.search(/^## /m);
  const body = (next === -1 ? rest : rest.slice(0, next)).trim();
  return body || null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error("usage: node scripts/release-notes.mjs X.Y.Z");
    process.exit(2);
  }
  const notes = releaseNotes(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"), version);
  if (notes === null) {
    console.error(`CHANGELOG.md has no section for ${version}`);
    process.exit(1);
  }
  process.stdout.write(`${notes}\n`);
}
