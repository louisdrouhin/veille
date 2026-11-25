/**
 * Opening a topic page marks it read (app/(protected)/t/[id]/page.tsx, while rendering).
 * A <Link prefetch={true}> to a topic would render that page in the background: measured
 * in Chrome on a production build, merely showing a forum list then marked every visible
 * topic read, and those full prefetches carry no header the server could tell apart.
 * With the default ("auto") no page was rendered, but the only safe setting is `false`.
 *
 * Same for an alert of Ma stack (3.0): opening /stack/alertes/[id] marks it seen.
 *
 * This test parses every component and fails if any <Link> pointing to /t/… or to
 * /stack/alertes/… does not say prefetch={false}.
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

type TopicLink = { where: string; prefetch: string | null };

/** Every JSX <Link> whose href (string, template or expression) starts with "/t/". */
function topicLinks(file: string, code = readFileSync(file, "utf8")): TopicLink[] {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: TopicLink[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === "Link") {
      const attr = (name: string) =>
        node.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(source) === name);
      const href = attr("href")?.initializer;
      const hrefText = !href
        ? ""
        : ts.isStringLiteral(href)
          ? href.text
          : ts.isJsxExpression(href)
            ? (href.expression?.getText(source) ?? "")
            : "";
      if (/^[`"']?\/(?:t|stack\/alertes)\//.test(hrefText)) {
        const prefetch = attr("prefetch")?.initializer;
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        found.push({
          where: `${path.relative(ROOT, file)}:${line + 1}`,
          prefetch: prefetch && ts.isJsxExpression(prefetch) && prefetch.expression ? prefetch.expression.getText(source) : null,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const links = ["app", "components"].flatMap((d) => tsxFiles(path.join(ROOT, d))).flatMap((f) => topicLinks(f));

describe("links to a topic page never prefetch it (prefetching would mark it read)", () => {
  it("finds the topic list's links (the scan works on the real code)", () => {
    expect(links.map((l) => l.where)).toContainEqual(expect.stringMatching(/^components[\\/]topic[\\/]topic-row\.tsx:\d+$/));
    expect(links.map((l) => l.where)).toContainEqual(expect.stringMatching(/^components[\\/]home[\\/]featured\.tsx:\d+$/));
    // Ma stack: the Folders topic of an alert, the alert cards, « Voir l'alerte » of the edit sheet.
    for (const f of ["alert-detail", "alert-list", "edit-sheet"]) {
      expect(links.map((l) => l.where)).toContainEqual(expect.stringMatching(new RegExp(`^components[\\\\/]stack[\\\\/]${f}\\.tsx:\\d+$`)));
    }
  });

  it("every <Link> to /t/… has prefetch={false}", () => {
    const offending = links.filter((l) => l.prefetch !== "false").map((l) => `${l.where} (prefetch=${l.prefetch ?? "default"})`);
    expect(offending).toEqual([]);
  });

  it("detects a missing or enabled prefetch, whatever the href form (self-check of the scan)", () => {
    const probe = (code: string) => topicLinks(path.join(ROOT, "probe.tsx"), code).map((l) => l.prefetch);
    expect(probe("const a = <Link href={`/t/${id}`} prefetch={false}>x</Link>;")).toEqual(["false"]);
    expect(probe("const a = <Link href={`/t/${id}`}>x</Link>;")).toEqual([null]);
    expect(probe('const a = <Link href="/t/3" prefetch={true} />;')).toEqual(["true"]);
    expect(probe(['const a = <Link', '  className="x"', "  onClick={(e) => go(e)}", '  href={"/t/" + id}', ">x</Link>;"].join("\n"))).toEqual([null]);
    // Not topic links: ignored.
    expect(probe('const a = <Link href="/f/securite">x</Link>;')).toEqual([]);
    expect(probe("const a = <Link href={`/stack/alertes/${id}`}>x</Link>;")).toEqual([null]);
    expect(probe('const a = <Link href="/stack/alertes?etat=traitees">x</Link>;')).toEqual([]);
    expect(probe("const a = <Link href={`/admin?edit=${id}`}>x</Link>;")).toEqual([]);
  });
});
