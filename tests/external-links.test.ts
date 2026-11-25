/**
 * In the installed app there is no browser toolbar: a link to another site that
 * opened inside the app would leave the user stuck there. Every <a> whose href
 * is not an in-app path must open in a new tab (outside the app). Links inside
 * articles get the same treatment from the sanitizer (tests/reader-sanitize.test.ts).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = path.join(import.meta.dirname, "..");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(p);
    return e.name.endsWith(".tsx") ? [p] : [];
  });
}

type Anchor = { where: string; href: string; target: string | null; rel: string | null };

function anchors(file: string, code = readFileSync(file, "utf8")): Anchor[] {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Anchor[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === "a") {
      const attr = (name: string): string | null => {
        const init = node.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(source) === name)?.initializer;
        if (!init) return null;
        if (ts.isStringLiteral(init)) return init.text;
        return ts.isJsxExpression(init) ? (init.expression?.getText(source) ?? "") : "";
      };
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      found.push({ where: `${path.relative(ROOT, file)}:${line + 1}`, href: attr("href") ?? "", target: attr("target"), rel: attr("rel") });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** In-app: starts with "/" (not "//") or "#", as a literal or a template. Anything else may leave the site. */
const isInternal = (href: string) => /^`?(\/(?!\/)|#)/.test(href);

const all = ["app", "components"].flatMap((d) => tsxFiles(path.join(ROOT, d))).flatMap((f) => anchors(f));

describe("external links open outside the installed app", () => {
  it("finds the article links (the scan works on the real code)", () => {
    expect(all.filter((a) => !isInternal(a.href)).length).toBeGreaterThanOrEqual(2);
  });

  it('every external <a> has target="_blank" and rel="noopener noreferrer"', () => {
    const offending = all
      .filter((a) => !isInternal(a.href) && (a.target !== "_blank" || !/noopener/.test(a.rel ?? "")))
      .map((a) => `${a.where} href=${a.href}`);
    expect(offending).toEqual([]);
  });

  it("self-check of the scan", () => {
    const probe = (code: string) => anchors(path.join(ROOT, "probe.tsx"), code).map((a) => [isInternal(a.href), a.target]);
    expect(probe('const a = <a href={url} target="_blank" rel="noopener noreferrer">x</a>;')).toEqual([[false, "_blank"]]);
    expect(probe('const a = <a href="https://ex.com">x</a>;')).toEqual([[false, null]]);
    expect(probe("const a = <a href={`#p${n}`}>x</a>;")).toEqual([[true, null]]);
    expect(probe('const a = <a href="/">x</a>;')).toEqual([[true, null]]);
    expect(probe('const a = <a href="//ex.com">x</a>;')).toEqual([[false, null]]);
  });
});
