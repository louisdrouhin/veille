"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { ListSwatch } from "@/components/lists/list-swatch";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { countResultsAction } from "@/lib/actions/search";
import { activeFilters, NO_FILTERS, PERIODS, searchHref, type Period, type SearchFilters } from "@/lib/search/filters";
import type { ListColor } from "@/lib/lists/palette";

export type FilterChoices = {
  forums: { slug: string; name: string; count: number }[];
  sources: { id: number; name: string }[];
  lists: { id: number; name: string; color: ListColor }[];
};

/** URL parameters of the filters (for the live count). */
function params(f: SearchFilters): Record<string, string | string[]> {
  const u = new URL(searchHref("", f), "http://x").searchParams;
  const out: Record<string, string | string[]> = {};
  for (const k of new Set(u.keys())) out[k] = u.getAll(k);
  return out;
}

const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
const LEGEND = "font-cond text-xs font-semibold tracking-caps text-fg-muted uppercase";
const CHIP =
  "relative inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 text-sm whitespace-nowrap text-fg after:absolute after:inset-x-0 after:-inset-y-1 aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:font-semibold aria-pressed:text-accent";

/** Desktop (≥ md): the 230 px column; every change applies at once (URL). */
export function FiltersColumn({ q, filters, choices }: { q: string; filters: SearchFilters; choices: FilterChoices }) {
  const router = useRouter();
  const apply = (f: SearchFilters) => router.push(searchHref(q, f), { scroll: false });
  return (
    <div className="flex flex-col gap-5 text-base">
      <FilterControls filters={filters} choices={choices} onChange={apply} desktop />
      {activeFilters(filters) > 0 && (
        <button type="button" className="w-fit cursor-pointer text-sm text-accent hover:underline" onClick={() => apply(NO_FILTERS)}>
          Réinitialiser les filtres
        </button>
      )}
    </div>
  );
}

/** Mobile: chips (« Filtres · N », active values) and the sheet with the live count. */
export function FiltersChips({ q, filters, choices }: { q: string; filters: SearchFilters; choices: FilterChoices }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const [count, setCount] = useState<number | null>(null);
  const n = activeFilters(filters);
  const period = PERIODS.find((p) => p.key === filters.period)!;

  // « Afficher N résultats »: counted again 250 ms after each change of the draft.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setTimeout(() => void countResultsAction(q, params(draft)).then((c) => alive && setCount(c)), 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, q, draft]);

  const go = (f: SearchFilters) => {
    setOpen(false);
    router.push(searchHref(q, f), { scroll: false });
  };

  return (
    <>
      <div className="-mx-2.5 flex gap-2 overflow-x-auto px-2.5 py-1 sm:-mx-3.5 sm:px-3.5" role="group" aria-label="Filtres">
        <button
          type="button"
          aria-pressed={n > 0}
          aria-haspopup="dialog"
          onClick={() => {
            setDraft(filters);
            setCount(null);
            setOpen(true);
          }}
          className={CHIP}
        >
          Filtres{n > 0 ? ` · ${n}` : ""}
        </button>
        {filters.period !== "tout" && (
          <button type="button" aria-pressed className={CHIP} onClick={() => go({ ...filters, period: "tout" })} aria-label={`Période : ${period.long}, retirer`}>
            Période : {period.long} ✕
          </button>
        )}
        {filters.forums.map((s) => (
          <button key={s} type="button" aria-pressed className={CHIP} onClick={() => go({ ...filters, forums: filters.forums.filter((x) => x !== s) })}>
            {choices.forums.find((f) => f.slug === s)?.name ?? s} ✕
          </button>
        ))}
        {filters.lists.map((id) => {
          const l = choices.lists.find((x) => x.id === id);
          return (
            <button key={id} type="button" aria-pressed className={CHIP} onClick={() => go({ ...filters, lists: filters.lists.filter((x) => x !== id) })}>
              {l && <ListSwatch color={l.color} size={10} />} {l?.name ?? "Liste"} ✕
            </button>
          );
        })}
        {!filters.notes && (
          <button type="button" aria-pressed className={CHIP} onClick={() => go({ ...filters, notes: true })}>
            Sans mes notes ✕
          </button>
        )}
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title="Filtres">
        <div className="flex flex-col gap-5 px-4 pt-1 pb-2">
          <FilterControls filters={draft} choices={choices} onChange={setDraft} />
          <div className="flex gap-2 border-t border-line pt-3">
            <button type="button" className="h-11 flex-1 cursor-pointer rounded-sm border border-line-strong text-base font-semibold" onClick={() => setDraft(NO_FILTERS)}>
              Réinitialiser
            </button>
            <button type="button" className="h-11 flex-[2] cursor-pointer rounded-sm bg-accent text-base font-semibold text-accent-fg" onClick={() => go(draft)}>
              {count === null ? "Afficher les résultats" : `Afficher ${count} résultat${count > 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

function FilterControls({ filters, choices, onChange, desktop = false }: { filters: SearchFilters; choices: FilterChoices; onChange: (f: SearchFilters) => void; desktop?: boolean }) {
  const notesId = useId();
  const [sourceQuery, setSourceQuery] = useState("");
  const sources = choices.sources.filter((s) => s.name.toLowerCase().includes(sourceQuery.toLowerCase())).slice(0, 30);
  return (
    <>
      <fieldset className="flex flex-col gap-1.5">
        <legend className={`${LEGEND} mb-1.5`}>Forum</legend>
        {desktop ? (
          choices.forums.map((f) => (
            <label key={f.slug} className="flex min-h-8 cursor-pointer items-center gap-2">
              <input type="checkbox" className="size-4 accent-accent" checked={filters.forums.includes(f.slug)} onChange={() => onChange({ ...filters, forums: toggle(filters.forums, f.slug) })} />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="font-mono text-sm text-fg-muted">{f.count}</span>
            </label>
          ))
        ) : (
          <div className="flex flex-wrap gap-2">
            {choices.forums.map((f) => (
              <button key={f.slug} type="button" aria-pressed={filters.forums.includes(f.slug)} className={CHIP} onClick={() => onChange({ ...filters, forums: toggle(filters.forums, f.slug) })}>
                {f.name}
              </button>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-1.5">
        <legend className={`${LEGEND} mb-1.5`}>Période</legend>
        {desktop ? (
          PERIODS.map((p) => (
            <label key={p.key} className="flex min-h-8 cursor-pointer items-center gap-2">
              <input type="radio" name="periode" className="size-4 accent-accent" checked={filters.period === p.key} onChange={() => onChange({ ...filters, period: p.key as Period })} />
              {p.key === "tout" ? "Tout" : p.long}
            </label>
          ))
        ) : (
          <div role="radiogroup" aria-label="Période" className="flex rounded-md bg-off-soft p-[3px]">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={filters.period === p.key}
                onClick={() => onChange({ ...filters, period: p.key as Period })}
                className="h-10 flex-1 cursor-pointer rounded-sm text-sm font-medium text-fg-muted aria-checked:bg-surface aria-checked:font-semibold aria-checked:text-fg aria-checked:shadow-sm"
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-1.5">
        <legend className={`${LEGEND} mb-1.5`}>Source</legend>
        {!desktop && (
          <input
            type="search"
            placeholder="Chercher une source"
            value={sourceQuery}
            onChange={(e) => setSourceQuery(e.target.value)}
            className="h-11 rounded-sm border border-line-strong bg-surface px-3 text-[16px] text-fg"
          />
        )}
        <select
          aria-label="Source"
          value={filters.source ?? ""}
          onChange={(e) => onChange({ ...filters, source: e.target.value ? Number(e.target.value) : null })}
          className="h-11 rounded-sm border border-line-strong bg-surface px-2 text-[16px] text-fg md:h-9 md:text-base"
        >
          <option value="">Toutes les sources</option>
          {(desktop ? choices.sources : sources).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </fieldset>

      {choices.lists.length > 0 && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className={`${LEGEND} mb-1.5`}>Mes listes</legend>
          {desktop ? (
            choices.lists.map((l) => (
              <label key={l.id} className="flex min-h-8 cursor-pointer items-center gap-2">
                <input type="checkbox" className="size-4 accent-accent" checked={filters.lists.includes(l.id)} onChange={() => onChange({ ...filters, lists: toggle(filters.lists, l.id) })} />
                <ListSwatch color={l.color} size={10} />
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
              </label>
            ))
          ) : (
            <div className="flex flex-wrap gap-2">
              {choices.lists.map((l) => (
                <button key={l.id} type="button" aria-pressed={filters.lists.includes(l.id)} className={CHIP} onClick={() => onChange({ ...filters, lists: toggle(filters.lists, l.id) })}>
                  <ListSwatch color={l.color} size={10} /> {l.name}
                </button>
              ))}
            </div>
          )}
        </fieldset>
      )}

      <div className="flex min-h-11 items-center justify-between gap-3">
        <span id={notesId}>Inclure mes notes</span>
        <Switch checked={filters.notes} labelledBy={notesId} onChange={(on) => onChange({ ...filters, notes: on })} />
      </div>
    </>
  );
}
