"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { IconSun } from "@/components/ui/icons";
import { Panel } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { testBriefingAction, updateBriefingSettingsAction } from "@/lib/actions/briefing";
import type { BriefingDays, BriefingLength, BriefingPreview } from "@/lib/briefing/types";
import { showToast } from "@/lib/toast-client";

export type BriefingSettingsView = {
  enabled: boolean;
  sendAt: string;
  days: BriefingDays;
  sectionStack: boolean;
  sectionFeatured: boolean;
  sectionServices: boolean;
  sectionBrief: boolean;
  length: BriefingLength;
  preview: BriefingPreview;
  servicesForumIds: number[];
};

type Patch = Partial<BriefingSettingsView>;

const SECTIONS = [
  ["sectionStack", "Ma stack", "Les nouvelles failles de tes logiciels, sans IA."],
  ["sectionFeatured", "À la une", "Les sujets repris par plusieurs sources, résumés IA en deux lignes."],
  ["sectionServices", "Mes services", "Les nouvelles versions publiées dans les forums choisis ci-dessous, une phrase IA."],
  ["sectionBrief", "Le reste en bref", "Quelques sujets notables, une ligne IA chacun."],
] as const;

const SEGMENT =
  "inline-flex h-9 cursor-pointer items-center rounded-sm px-3 text-sm font-semibold text-fg-muted hover:text-fg aria-checked:bg-accent aria-checked:text-accent-fg max-md:h-11 max-md:flex-1 max-md:justify-center";

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full rounded-sm border border-line-strong bg-surface p-0.5 md:w-fit">
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={SEGMENT}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** Live miniature of the notification (§ 7), from example content: never the real Ma stack. */
function NotificationPreview({ preview }: { preview: BriefingPreview }) {
  const [title, body] =
    preview === "full"
      ? ["Briefing · 1 faille critique sur ta stack", "Critique · un logiciel du contexte Travail à mettre à jour.\nÀ la une : un sujet repris par 4 sources"]
      : ["Ton briefing du matin est prêt", "3 min de lecture. Touche pour l'ouvrir."];
  return (
    <figure aria-label="Aperçu de la notification" className="max-w-[360px] rounded-lg border border-line-strong bg-surface-alt p-3 text-sm shadow-sm">
      <p className="flex items-center gap-1.5 text-xs text-fg-muted">
        <span aria-hidden className="inline-flex size-4 items-center justify-center rounded-[4px] bg-bar text-[9px] font-bold text-bar-fg">
          F
        </span>
        FOLDERS · maintenant
      </p>
      <p className="mt-1 font-semibold">{title}</p>
      <p className="whitespace-pre-line text-fg-muted">{body}</p>
    </figure>
  );
}

/**
 * « Briefing du matin » settings (docs/design/3.4 § 7), first section of Mon compte › Notifications; saved on change.
 * Mes services: the forums are chosen here (pre-filled with « Mes services » when it exists), never guessed.
 */
export function BriefingSettingsPanel({ initial, forums, next: initialNext }: { initial: BriefingSettingsView; forums: { id: number; name: string }[]; next: string | null }) {
  const [s, setS] = useState(initial);
  const [next, setNext] = useState(initialNext);
  const [busy, start] = useTransition();
  const [testing, startTest] = useTransition();
  const ids = { on: useId(), time: useId(), help: useId(), focus: useId() };

  const save = (patch: Patch) => {
    const before = s;
    setS((prev) => ({ ...prev, ...patch }));
    start(async () => {
      const res = await updateBriefingSettingsAction(patch).catch(() => ({ ok: false as const, error: "Connexion au serveur impossible." }));
      if (!res.ok) {
        setS(before);
        return showToast({ kind: "error", title: "Briefing :", msg: res.error });
      }
      setS((prev) => ({ ...prev, enabled: res.enabled }));
      setNext(res.next);
      if (res.message) showToast({ kind: "error", title: res.message });
    });
  };

  const test = () =>
    startTest(async () => {
      const res = await testBriefingAction().catch(() => ({ ok: false as const, error: "Connexion au serveur impossible." }));
      if (!res.ok) return showToast({ kind: "error", title: "Test :", msg: res.error });
      showToast(
        res.empty
          ? { kind: "ok", title: "Rien de neuf aujourd'hui", msg: "Pas de notification : ouvre le briefing pour le voir." }
          : res.devices > 0
            ? { kind: "ok", title: "Briefing envoyé", msg: `Sur ${res.devices} appareil${res.devices > 1 ? "s" : ""}.` }
            : { kind: "error", title: "Aucun appareil abonné", msg: "Active les notifications sur cet appareil ci-dessous." },
      );
    });

  const servicesOn = s.sectionServices;
  return (
    <Panel id="briefing" title="Briefing du matin">
      <div className="grid gap-4 p-3.5">
        <div className="flex items-center gap-3">
          <IconSun size={18} className="shrink-0 text-fg-muted" />
          <p className="min-w-0 flex-1">
            <span id={ids.on} className="block text-base font-semibold">
              Recevoir le briefing
            </span>
            <span id={`${ids.on}-next`} className="block text-sm text-fg-muted">
              {s.enabled && next ? `Prochain : ${next}` : "Désactivé"}
            </span>
          </p>
          <Switch checked={s.enabled} onChange={(v) => save({ enabled: v })} labelledBy={ids.on} describedBy={`${ids.on}-next`} busy={busy} />
        </div>

        <div className="grid gap-3 border-t border-line pt-3 md:grid-cols-[max-content_1fr] md:items-center md:gap-x-6">
          <label htmlFor={ids.time} className="text-sm font-semibold">
            Heure d&apos;envoi
          </label>
          <input
            id={ids.time}
            type="time"
            step={900}
            value={s.sendAt}
            aria-describedby={ids.help}
            onChange={(e) => {
              const v = e.target.value.slice(0, 5);
              if (/^([01]\d|2[0-3]):(00|15|30|45)$/.test(v)) save({ sendAt: v });
              else if (/^\d\d:\d\d$/.test(v)) showToast({ kind: "error", title: "Heure par pas de 15 minutes (7:00, 7:15…)." });
            }}
            className="h-11 w-fit rounded-sm border border-line-strong bg-surface px-2 font-mono text-base md:h-9"
          />
          <span className="text-sm font-semibold">Jours</span>
          <Segmented
            label="Jours"
            value={s.days}
            onChange={(v) => save({ days: v })}
            options={[
              ["weekdays", "Du lundi au vendredi"],
              ["daily", "Tous les jours"],
            ]}
          />
        </div>
        <p id={ids.help} className="-mt-2 text-sm text-fg-muted">
          Le briefing part à l&apos;heure choisie, même pendant les heures calmes : c&apos;est toi qui l&apos;as choisie. Le lundi, il couvre tout le week-end.
        </p>

        <fieldset className="border-t border-line pt-3">
          <legend className="mb-1.5 pt-3 text-sm font-semibold">Sections incluses</legend>
          <div className="grid gap-0.5">
            {SECTIONS.map(([k, label, help]) => (
              <label key={k} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-sm px-1 py-1.5 hover:bg-surface-hover">
                <input type="checkbox" checked={s[k]} onChange={(e) => save({ [k]: e.target.checked })} className="mt-1 size-4 accent-[var(--accent)]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-base">{label}</span>
                  <span className="block text-sm text-fg-muted">{help}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-sm text-fg-muted">Une section sans rien de neuf est masquée ce jour-là.</p>
        </fieldset>

        <fieldset disabled={!servicesOn} className="border-t border-line pt-3 disabled:opacity-60">
          <legend className="mb-1 pt-3 text-sm font-semibold">Forums de « Mes services »</legend>
          <p className="mb-1.5 text-sm text-fg-muted">Les nouveaux topics de ces forums sont présentés comme des versions publiées.</p>
          {forums.length === 0 ? (
            <p className="text-sm text-fg-muted">Aucun forum.</p>
          ) : (
            <div className="grid gap-0.5 md:grid-cols-2">
              {forums.map((f) => (
                <label key={f.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-1 hover:bg-surface-hover">
                  <input
                    type="checkbox"
                    checked={s.servicesForumIds.includes(f.id)}
                    onChange={(e) => save({ servicesForumIds: e.target.checked ? [...s.servicesForumIds, f.id] : s.servicesForumIds.filter((x) => x !== f.id) })}
                    className="size-4 accent-[var(--accent)]"
                  />
                  <span className="text-base">{f.name}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset className="border-t border-line pt-3">
          <legend className="mb-1.5 pt-3 text-sm font-semibold">Longueur</legend>
          <div className="grid gap-2 md:grid-cols-2">
            {(
              [
                ["short", "Court", "~1 min · titres seuls, sans IA (Ma stack garde sa phrase)"],
                ["detailed", "Détaillé", "~4 min · une phrase par point, deux lignes pour À la une"],
              ] as const
            ).map(([v, label, help]) => (
              <label key={v} className="flex cursor-pointer items-start gap-3 rounded-md border border-line-strong p-3 has-checked:border-accent has-checked:bg-accent-soft">
                <input type="radio" name="briefing-length" checked={s.length === v} onChange={() => save({ length: v })} className="mt-1 size-4 accent-[var(--accent)]" />
                <span>
                  <span className="block text-base font-semibold">{label}</span>
                  <span className="block text-sm text-fg-muted">{help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-2 border-t border-line pt-3">
          <span className="text-sm font-semibold">Notification</span>
          <Segmented
            label="Notification"
            value={s.preview}
            onChange={(v) => save({ preview: v })}
            options={[
              ["full", "Aperçu complet"],
              ["discreet", "Discret"],
            ]}
          />
          <NotificationPreview preview={s.preview} />
          <p id={ids.focus} className="text-sm text-fg-muted">
            Ma stack du contexte Travail reste toujours générique, sans produit ni version. Une app installée ne peut pas savoir quel mode de concentration iOS est actif : choisis
            « Discret », ou coupe Folders dans ton mode Travail (Réglages iOS › Concentration).
          </p>
        </div>

        <div className="border-t border-line pt-3">
          <Button onClick={test} disabled={testing} className="max-md:min-h-11 max-md:w-full">
            Recevoir un briefing maintenant (test)
          </Button>
        </div>
      </div>
    </Panel>
  );
}
