import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { markdownToHtml } from "@/lib/ai/markdown";

/** CHANGELOG.md, shipped with the server (next.config.ts outputFileTracingIncludes). */
export const CHANGELOG_FILE = "CHANGELOG.md";

/**
 * « Nouveautés »: the changelog without its title, rendered by the closed Markdown renderer
 * (headings, lists, bold, code; everything escaped). Null if the file is missing.
 */
export function changelogHtml(cwd = process.cwd()): string | null {
  let md: string;
  try {
    md = readFileSync(path.join(cwd, CHANGELOG_FILE), "utf8");
  } catch {
    return null;
  }
  // Drop the « # Changelog » title and the intro before the first version.
  const first = md.search(/^## /m);
  return markdownToHtml(first >= 0 ? md.slice(first) : md);
}
