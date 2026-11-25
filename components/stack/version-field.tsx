"use client";

import { useEffect, useId, useState } from "react";
import { IconSpinner } from "@/components/ui/icons";
import { previewVersionAction } from "@/lib/actions/stack";
import type { StackContext, VersionScheme } from "@/lib/db/schema";
import { CONTEXT_LABEL, previewMessage, worstSeverity, type VersionPreview } from "@/lib/stack/labels";
import { SeverityBadge } from "./badges";

/** Version input (mono 18 px), with the latest release and recent versions as chips. */
export function VersionField({
  value,
  onChange,
  scheme,
  latest,
  recent = [],
  hint,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  scheme: VersionScheme;
  latest?: string | null;
  recent?: string[];
  hint?: string | null;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        Version
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        // Semver is digits and dots; OpenSSH (9.4p1) and vendor versions (8.0 U2) need letters.
        inputMode={scheme === "semver" ? "decimal" : "text"}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={64}
        aria-describedby={`${id}-help`}
        className="h-12 rounded-sm border border-line-strong bg-surface px-3 font-mono text-[18px] text-fg"
      />
      <div id={`${id}-help`} className="grid gap-1.5 text-sm text-fg-muted">
        {latest && <p>Dernière version publiée : <span className="font-mono">{latest}</span></p>}
        {hint && <p>{hint}</p>}
      </div>
      {recent.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Versions récentes">
          {recent.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              aria-pressed={value.trim() === v}
              className="inline-flex h-11 cursor-pointer items-center rounded-full border border-line-strong px-3 font-mono text-sm text-fg hover:bg-surface-hover aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent md:h-8"
            >
              {v}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Homelab / Travail, as radio pills (role radiogroup). */
export function ContextField({ value, onChange, disabled = [] }: { value: StackContext; onChange: (c: StackContext) => void; disabled?: StackContext[] }) {
  const name = useId();
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-sm font-semibold">Contexte</legend>
      <div role="radiogroup" className="flex gap-2">
        {(["homelab", "work"] as const).map((c) => (
          <label key={c} className="relative">
            <input type="radio" name={name} value={c} checked={value === c} disabled={disabled.includes(c)} onChange={() => onChange(c)} className="peer sr-only" />
            <span className="inline-flex h-11 cursor-pointer items-center rounded-full border border-line-strong px-4 text-base font-medium text-fg peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus peer-disabled:cursor-not-allowed peer-disabled:opacity-50 md:h-9">
              {CONTEXT_LABEL[c]}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The immediate check (role="status"), asked to the server 300 ms after the last keystroke. */
export function VersionCheck({ productId, productName, version, itemId, pending }: { productId: number; productName: string; version: string; itemId?: number; pending?: boolean }) {
  const [state, setState] = useState<{ version: string; preview: VersionPreview } | null>(null);
  useEffect(() => {
    const v = version.trim();
    if (!v || pending) return;
    let alive = true;
    const t = setTimeout(() => {
      previewVersionAction({ productId, version: v, itemId })
        .then((preview) => alive && setState({ version: v, preview }))
        .catch(() => {});
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [productId, version, itemId, pending]);

  const v = version.trim();
  const preview: VersionPreview | null = pending ? { kind: "pending" } : state && state.version === v ? state.preview : null;
  const worst = preview?.kind === "checked" ? worstSeverity(preview.vulns.map((x) => x.severity)) : null;
  const top = preview?.kind === "checked" ? preview.vulns[0] : undefined;
  const tone =
    preview?.kind === "unrecognized" ? "border-warn bg-warn-soft" : worst ? "border-line-strong bg-surface-alt" : preview?.kind === "checked" ? "border-ok bg-ok-soft" : "border-line bg-surface-alt";
  return (
    <div role="status" className={`flex min-h-12 items-start gap-2 rounded-md border px-3 py-2.5 text-base ${tone}`}>
      {!v ? (
        <span className="text-fg-muted">Indique ta version pour la vérifier.</span>
      ) : !preview ? (
        <span className="inline-flex items-center gap-2 text-fg-muted">
          <IconSpinner size={14} className="animate-spin motion-reduce:animate-none" /> Vérification…
        </span>
      ) : (
        <>
          {worst && top && <SeverityBadge severity={worst} cvss={top.severity === worst ? top.cvss : null} />}
          {preview.kind === "pending" && <IconSpinner size={14} className="mt-1 animate-spin motion-reduce:animate-none" />}
          <span className="min-w-0 flex-1">{previewMessage(v, preview, productName)}</span>
        </>
      )}
    </div>
  );
}
