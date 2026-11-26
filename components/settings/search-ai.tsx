"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { Panel } from "@/components/ui/panel";
import { reindexAllAction, saveSearchSettingAction } from "@/lib/actions/search-settings";
import { showToast } from "@/lib/toast-client";
import { SaveError, SavedHint, useSave } from "./saved";

export type SearchAiView = {
  threshold: number;
  thresholdDefault: number;
  windowHours: number;
  scores: number[];
  limits: { embed: { used: number; limit: number }; ask: { used: number; limit: number } };
  index: { indexed: number; total: number; model: string; estimate: string };
};

const fr = (n: number, digits = 2) => n.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const WINDOWS = [24, 48, 72, 96, 168] as const;

/** Seuil (curseur 0,75–0,95, saved 400 ms after the last move) with its simulation on the last 7 days. */
function ThresholdSetting({ initial, fallback, scores }: { initial: number; fallback: number; scores: number[] }) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const saved = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { state, save } = useSave();
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const change = (v: number) => {
    setValue(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const before = saved.current;
      void save(
        async () => {
          const r = await saveSearchSettingAction("merge_threshold", v.toFixed(2));
          if (r.ok) saved.current = v;
          return r;
        },
        () => setValue(before),
      );
    }, 400);
  };
  const merged = scores.filter((s) => s >= value).length;
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-sm font-semibold">
          Seuil de similarité
        </label>
        <SavedHint state={state} />
        <span className="ml-auto font-mono text-base font-semibold">{fr(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={0.75}
        max={0.95}
        step={0.01}
        value={value}
        aria-valuetext={fr(value)}
        aria-describedby={`${id}-sim`}
        onChange={(e) => change(Number(e.target.value))}
        className="h-11 w-full accent-[var(--accent)] md:h-6"
      />
      <div className="flex justify-between text-xs text-fg-muted">
        <span>0,75 · regroupe davantage</span>
        <span>0,95 · seulement les quasi-copies</span>
      </div>
      <p id={`${id}-sim`} className="text-sm">
        Sur les 7 derniers jours, à {fr(value)} : <strong>{merged}</strong> article{merged > 1 ? "s" : ""} sur {scores.length} {merged > 1 ? "auraient été regroupés" : "aurait été regroupé"}.
        {Math.abs(value - fallback) < 0.001 && <span className="text-fg-muted"> (valeur par défaut)</span>}
      </p>
      <SaveError state={state} />
    </div>
  );
}

function WindowSetting({ initial }: { initial: number }) {
  const [value, setValue] = useState(initial);
  const { state, save } = useSave();
  const choose = (v: number) => {
    const before = value;
    setValue(v);
    void save(() => saveSearchSettingAction("merge_window_hours", String(v)), () => setValue(before));
  };
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">Fenêtre de regroupement</span>
        <SavedHint state={state} />
      </div>
      <div role="radiogroup" aria-label="Fenêtre de regroupement" className="inline-flex w-full rounded-sm border border-line-strong bg-surface p-0.5 md:w-fit">
        {WINDOWS.map((h) => (
          <button
            key={h}
            type="button"
            role="radio"
            aria-checked={value === h}
            onClick={() => choose(h)}
            className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center rounded-sm px-3 text-sm font-semibold text-fg-muted hover:text-fg aria-checked:bg-accent aria-checked:text-accent-fg max-md:h-11 md:flex-none"
          >
            {h === 168 ? "7 j" : `${h} h`}
          </button>
        ))}
      </div>
      <p className="text-sm text-fg-muted">Un nouvel article n&apos;est comparé qu&apos;aux sujets arrivés pendant cette durée.</p>
      <SaveError state={state} />
    </div>
  );
}

function LimitSetting({ name, label, unit, used, initial }: { name: "embed_daily_limit" | "ask_daily_limit"; label: string; unit: string; used: number; initial: number }) {
  const id = useId();
  const [value, setValue] = useState(String(initial));
  const saved = useRef(String(initial));
  const { state, save } = useSave();
  const limit = Number(value) || 0;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  const commit = () => {
    const v = value.trim();
    if (v === saved.current) return;
    const before = saved.current;
    void save(
      async () => {
        const r = await saveSearchSettingAction(name, v);
        if (r.ok) saved.current = v;
        return r;
      },
      () => setValue(before),
    );
  };
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-sm font-semibold">
          {label}
        </label>
        <SavedHint state={state} />
        <span className="ml-auto text-sm text-fg-muted">
          <span className="font-mono">{used.toLocaleString("fr-FR")}</span> utilisés aujourd&apos;hui
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div role="img" aria-label={`${pct} % de la limite utilisés`} className="h-2 flex-1 overflow-hidden rounded-full bg-off-soft">
          <span className={`block h-full ${pct >= 100 ? "bg-err" : "bg-accent"}`} style={{ width: `${pct}%` }} />
        </div>
        <input
          id={id}
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit())}
          aria-describedby={`${id}-unit`}
          className="h-11 w-24 rounded-sm border border-line-strong bg-surface px-2 text-right font-mono text-base md:h-9"
        />
        <span id={`${id}-unit`} className="text-sm text-fg-muted">
          {unit}
        </span>
      </div>
      <SaveError state={state} />
    </div>
  );
}

/** Paramètres › Recherche et IA (docs/design/3.5 § 7). */
export function SearchAiSettings({ view }: { view: SearchAiView }) {
  const router = useRouter();
  const dialog = useRef<ConfirmDialogHandle>(null);
  const [pending, start] = useTransition();
  const pct = view.index.total ? Math.round((view.index.indexed / view.index.total) * 100) : 100;
  return (
    <>
      <Panel title="Regroupement des doublons">
        <div className="grid gap-5 p-3.5">
          <ThresholdSetting initial={view.threshold} fallback={view.thresholdDefault} scores={view.scores} />
          <WindowSetting initial={view.windowHours} />
        </div>
      </Panel>
      <Panel title="Limites quotidiennes">
        <div className="grid gap-5 p-3.5">
          <LimitSetting name="embed_daily_limit" label="Indexation par le sens" unit="textes / jour" used={view.limits.embed.used} initial={view.limits.embed.limit} />
          <LimitSetting name="ask_daily_limit" label="Demande à ta veille" unit="questions / jour" used={view.limits.ask.used} initial={view.limits.ask.limit} />
          <p className="text-sm text-fg-muted">Remises à zéro chaque jour à minuit (heure de Paris). À 0, la fonction est coupée.</p>
        </div>
      </Panel>
      <Panel title="Indexation">
        <div className="grid gap-3 p-3.5">
          <p className="text-base">
            <strong>{pct} %</strong> des articles indexés · <span className="font-mono">{view.index.indexed.toLocaleString("fr-FR")}</span> sur{" "}
            <span className="font-mono">{view.index.total.toLocaleString("fr-FR")}</span>
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-off-soft" role="img" aria-label={`${pct} % indexés`}>
            <span className="block h-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-sm text-fg-muted">
            Modèle : <span className="font-mono">{view.index.model}</span>. Le changer impose de tout réindexer.
          </p>
          <button type="button" onClick={() => dialog.current?.open()} className={`${buttonClass("danger", "md")} w-fit max-md:min-h-11`}>
            Tout réindexer
          </button>
          <ConfirmDialog
            handle={dialog}
            title="Tout réindexer ?"
            description={`Les ${view.index.total.toLocaleString("fr-FR")} articles seront indexés à nouveau en arrière-plan : ${view.index.estimate}. D'ici là, la recherche par le sens et « À la une » seront incomplets.`}
          >
            <button
              type="button"
              disabled={pending}
              className={`${buttonClass("danger-solid")} max-md:min-h-11`}
              onClick={() =>
                start(async () => {
                  const r = await reindexAllAction().catch(() => ({ ok: false as const, error: "Connexion au serveur impossible." }));
                  dialog.current?.close();
                  if (!r.ok) return showToast({ kind: "error", title: "Réindexation :", msg: r.error });
                  showToast({ kind: "ok", title: "Réindexation lancée", msg: "Elle continue en arrière-plan." });
                  router.refresh();
                })
              }
            >
              Tout réindexer
            </button>
          </ConfirmDialog>
        </div>
      </Panel>
    </>
  );
}
