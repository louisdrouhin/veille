"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IconPencil, IconPlus } from "@/components/ui/icons";
import type { StackContext } from "@/lib/db/schema";
import { alertsDetail } from "@/lib/stack/labels";
import type { SoftwareRow } from "@/lib/stack/queries";
import { AddSheet } from "./add-sheet";
import { ContextTag, SeverityBadge, SoftwareTile } from "./badges";
import { EditSheet, RemoveButton } from "./edit-sheet";

type Filter = "all" | StackContext;
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "homelab", label: "Homelab" },
  { key: "work", label: "Travail" },
];

export function detailOf(r: SoftwareRow): string {
  switch (r.status) {
    case "vulnerable":
      return alertsDetail(r.worstCount, r.worst!, r.exploited) + (r.openCount > r.worstCount ? ` (+${r.openCount - r.worstCount})` : "");
    case "update":
      return "Mise à jour disponible";
    case "unknown":
      return "Version non reconnue : à corriger";
    case "pending":
      return "Première vérification en cours";
    case "untracked":
      return "Suivi par nom";
    default:
      return "Aucune faille connue";
  }
}

const CHIP = "inline-flex h-[22px] shrink-0 items-center gap-1 rounded-sm px-[7px] text-xs font-semibold whitespace-nowrap";

export function StatusChip({ row }: { row: SoftwareRow }) {
  switch (row.status) {
    case "vulnerable":
      return <SeverityBadge severity={row.worst!} label="Vulnérable" />;
    case "update":
      return (
        <span className={`${CHIP} bg-accent-soft font-mono text-accent`}>
          <span aria-hidden>↑</span>
          <span className="sr-only">Mise à jour </span>
          {row.latestVersion}
        </span>
      );
    case "ok":
      return <span className={`${CHIP} bg-ok-soft text-ok`}>✓ À jour</span>;
    case "unknown":
      return <span className={`${CHIP} bg-warn-soft text-warn`}>Non reconnue</span>;
    case "pending":
      return <span className={`${CHIP} bg-off-soft text-fg-muted`}>En attente</span>;
    default:
      return <span className={`${CHIP} bg-off-soft text-fg-muted`}>Par nom</span>;
  }
}

/**
 * Logiciels (docs/design/3.0 § 4.1): « Ajouter un logiciel », filters Tous / Homelab / Travail with
 * counts, one row per software (mobile: 60 px, the whole row opens the edit sheet; desktop: a table
 * with Modifier / Retirer). Rows come sorted from the server (lib/stack/queries.ts).
 */
export function SoftwareView({ rows, initialEdit = null }: { rows: SoftwareRow[]; initialEdit?: number | null }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);
  // « J'ai mis à jour : changer ma version » of an alert opens the sheet of its software.
  const [editing, setEditing] = useState<number | null>(rows.some((r) => r.id === initialEdit) ? initialEdit : null);
  const shown = rows.filter((r) => filter === "all" || r.context === filter);
  const count = (f: Filter) => (f === "all" ? rows.length : rows.filter((r) => r.context === f).length);
  const edited = rows.find((r) => r.id === editing) ?? null;

  const addButton = (
    <Button variant="primary" size="md" onClick={() => setAdding(true)} className="max-md:h-11 max-md:w-full">
      <IconPlus size={14} /> Ajouter un logiciel
    </Button>
  );

  if (rows.length === 0) {
    return (
      <>
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-line-strong bg-surface px-5 py-10 text-center">
          <p className="text-[15px] font-semibold">Ta stack est vide</p>
          <p className="max-w-[300px] text-sm text-fg-muted">Ajoute les logiciels que tu utilises et leur version : Folders t&apos;alerte quand une faille touche ta version.</p>
          {addButton}
        </div>
        <AddSheet open={adding} onClose={() => setAdding(false)} />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div role="radiogroup" aria-label="Contexte" className="flex gap-2 max-md:order-2">
          {FILTERS.map((f) => (
            <label key={f.key}>
              <input type="radio" name="stack-filter" value={f.key} checked={filter === f.key} onChange={() => setFilter(f.key)} className="peer sr-only" />
              <span className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 text-base font-medium text-fg peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus md:h-8 md:text-sm">
                {f.label}
                <span className="font-mono text-xs opacity-80">{count(f.key)}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="max-md:order-1">{addButton}</div>
      </div>

      {/* Mobile: rows of 60 px, the whole row opens the edit sheet. */}
      <ul className="overflow-hidden rounded-md border border-line bg-surface md:hidden">
        {shown.map((r) => (
          <li key={r.id} className="border-t border-line first:border-t-0">
            <button
              type="button"
              onClick={() => setEditing(r.id)}
              aria-label={`${r.name} ${r.version}, ${detailOf(r)} — modifier`}
              className="flex min-h-[60px] w-full cursor-pointer items-center gap-3 px-3 py-2 text-left hover:bg-surface-hover"
            >
              <SoftwareTile name={r.name} />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate font-semibold">{r.name}</span>
                  <span className="shrink-0 font-mono text-sm text-fg-muted">{r.version}</span>
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-fg-muted">
                  <ContextTag context={r.context} />
                  <span className="truncate">{detailOf(r)}</span>
                </span>
              </span>
              <StatusChip row={r} />
            </button>
          </li>
        ))}
      </ul>

      {/* Desktop: table. */}
      <div className="hidden overflow-hidden rounded-md border border-line bg-surface md:block" role="table" aria-label="Logiciels">
        <div role="row" className="grid grid-cols-[34px_minmax(0,1fr)_110px_100px_190px_150px_76px] items-center gap-3 bg-surface-alt px-3.5 py-2 font-cond text-xs font-bold tracking-caps text-fg-muted uppercase">
          <span aria-hidden />
          <span role="columnheader">Logiciel</span>
          <span role="columnheader">Version</span>
          <span role="columnheader">Contexte</span>
          <span role="columnheader">Détail</span>
          <span role="columnheader">Statut</span>
          <span role="columnheader"><span className="sr-only">Actions</span></span>
        </div>
        {shown.map((r) => (
          <div key={r.id} role="row" className="grid min-h-[52px] grid-cols-[34px_minmax(0,1fr)_110px_100px_190px_150px_76px] items-center gap-3 border-t border-line px-3.5 py-2 hover:bg-surface-alt">
            <span aria-hidden>
              <SoftwareTile name={r.name} />
            </span>
            <span role="cell" className="min-w-0">
              <span className="block truncate font-semibold">{r.name}</span>
              {r.sources.length > 0 && <span className="block text-xs text-fg-muted">{r.sources.join(" · ")}</span>}
            </span>
            <span role="cell" className="truncate font-mono text-sm" title={r.version}>
              {r.version}
            </span>
            <span role="cell">
              <ContextTag context={r.context} />
            </span>
            <span role="cell" className="truncate text-sm text-fg-muted" title={detailOf(r)}>
              {detailOf(r)}
            </span>
            <span role="cell">
              <StatusChip row={r} />
            </span>
            <span role="cell" className="flex justify-end gap-1">
              <Button variant="ghost-icon" aria-label={`Modifier ${r.name}`} title="Modifier" onClick={() => setEditing(r.id)}>
                <IconPencil size={14} />
              </Button>
              <RemoveButton row={r} />
            </span>
          </div>
        ))}
      </div>
      {shown.length === 0 && <p className="text-sm text-fg-muted">Aucun logiciel dans ce contexte.</p>}

      <AddSheet open={adding} onClose={() => setAdding(false)} />
      <EditSheet row={edited} onClose={() => setEditing(null)} />
    </>
  );
}
