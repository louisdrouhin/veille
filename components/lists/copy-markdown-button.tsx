"use client";

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { IconCheck, IconClipboard } from "@/components/ui/icons";
import { listToMarkdown, type MarkdownItem } from "@/lib/lists/markdown";

/**
 * « Copier en Markdown »: the whole list, built and written to the clipboard inside the click
 * (no await before writeText: iOS requires the user gesture). Falls back to the share sheet.
 */
export function CopyMarkdownButton({
  name,
  items,
  className = "",
  compact = false,
}: {
  name: string;
  items: MarkdownItem[];
  className?: string;
  compact?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "shared" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);

  function copy() {
    const text = listToMarkdown(name, items);
    const share = () =>
      navigator.share
        ? navigator.share({ text }).then(
            () => setState("shared"),
            () => setState("failed"),
          )
        : setState("failed");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => setState("copied"), share);
    } else {
      void share();
    }
  }

  const n = items.length;
  const done = state === "copied" || state === "shared";
  return (
    <>
      <button
        type="button"
        onClick={copy}
        className={
          compact
            ? buttonClass("ghost-icon", "sm", `${done ? "!text-ok" : ""} ${className}`)
            : buttonClass("secondary", "md", `${done ? "!border-ok !bg-ok-soft !text-ok" : ""} ${className}`)
        }
        {...(compact ? { "aria-label": `Copier « ${name} » en Markdown`, title: done ? "Copié" : "Copier en Markdown" } : {})}
      >
        {compact ? (
          done ? <IconCheck size={15} /> : <IconClipboard size={15} />
        ) : done ? (
          <>
            <IconCheck size={15} /> {state === "copied" ? "Copié" : "Partagé"} · {n} article{n > 1 ? "s" : ""}
          </>
        ) : (
          "Copier en Markdown"
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {state === "copied" ? `Liste copiée en Markdown : ${n} article${n > 1 ? "s" : ""}` : state === "failed" ? "Copie impossible" : ""}
      </span>
    </>
  );
}
