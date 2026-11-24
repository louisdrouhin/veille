import { readFileSync } from "node:fs";
import path from "node:path";

export const GLOBALS_CSS = readFileSync(path.join(import.meta.dirname, "..", "..", "app", "globals.css"), "utf8");

/** Body of the first rule whose selector is exactly `selector` (rules end with "\n}" at column 0, or "\n  }" nested). */
function block(selector: string, nested = false): string {
  const start = GLOBALS_CSS.indexOf(`${selector} {\n`);
  if (start < 0) throw new Error(`no rule ${selector}`);
  const end = GLOBALS_CSS.indexOf(nested ? "\n  }" : "\n}", start);
  return GLOBALS_CSS.slice(start + selector.length + 3, end);
}

/** The custom properties of a block, as { name: value } (names without the leading --). */
function properties(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

export const LIGHT = properties(block(':root,\n:root[data-theme="light"]'));
export const DARK = properties(block(':root[data-theme="dark"]'));
export const SYSTEM_DARK = properties(block('  :root:not([data-theme="light"]):not([data-theme="dark"])', true));

/** A color token, upper-cased (#1E3640). */
export const color = (tokens: Record<string, string>, name: string): string => {
  const value = tokens[name];
  if (!value || !/^#[0-9A-Fa-f]{6}$/.test(value)) throw new Error(`--${name} is not a #rrggbb color: ${value}`);
  return value.toUpperCase();
};
