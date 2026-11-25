import type { Highlighted as Value } from "@/lib/search/highlight";

/**
 * Text with the server's highlight ranges (docs/design/3.3 § 3, 8): native <mark>, plain text around it
 * (React escapes it: never HTML from an article).
 */
export function Highlighted({ value }: { value: Value }) {
  const { text, ranges } = value;
  if (!ranges.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [i, [s, e]] of ranges.entries()) {
    if (s < at || e > text.length || s >= e) continue;
    if (s > at) parts.push(text.slice(at, s));
    parts.push(
      <mark key={i} className="rounded-[2px] bg-mark px-px text-mark-fg">
        {text.slice(s, e)}
      </mark>,
    );
    at = e;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
