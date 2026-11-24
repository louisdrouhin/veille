"use client";

import { useEffect, useState } from "react";

const SECTIONS = [
  { id: "forums", label: "Forums" },
  { id: "sources", label: "Sources" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

/**
 * Mobile: segmented control of anchors to the two admin panels (docs/design/v2 § 5).
 * The active segment follows the panel in view.
 */
export function AdminTabs({ counts }: { counts: Record<SectionId, number> }) {
  const [active, setActive] = useState<SectionId>("forums");

  useEffect(() => {
    const targets = SECTIONS.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => el !== null);
    // A panel is « current » once its top passes the upper third of the screen.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id as SectionId);
      },
      { rootMargin: "0px 0px -66% 0px" },
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, []);

  return (
    <nav aria-label="Sections de l'administration" className="mb-3 flex rounded-md bg-off-soft p-[3px] md:hidden">
      {SECTIONS.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          aria-current={active === s.id ? "location" : undefined}
          onClick={() => setActive(s.id)}
          className="flex h-10 flex-1 items-center justify-center rounded-sm text-base font-medium text-fg-muted no-underline hover:text-fg aria-[current]:bg-surface aria-[current]:font-semibold aria-[current]:text-fg aria-[current]:shadow-sm"
        >
          {s.label} · {counts[s.id]}
        </a>
      ))}
    </nav>
  );
}
