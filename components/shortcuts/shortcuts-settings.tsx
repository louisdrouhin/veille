"use client";

import { useId } from "react";
import { SavedHint, useSave } from "@/components/settings/saved";
import { Panel } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { setShortcutsEnabled, SHORTCUT_COLUMNS, useShortcutsEnabled } from "./shortcuts";

const KBD = "inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-line-strong bg-surface-alt px-1.5 font-mono text-xs";

/**
 * Paramètres › Raccourcis clavier (docs/design/3.5 § 6): the switch (single-key shortcuts can be turned off, WCAG
 * 2.1.4; on this device) and the list. Shown on phones too, with « Sur ordinateur, avec un clavier ».
 */
export function ShortcutsSettings() {
  const enabled = useShortcutsEnabled();
  const id = useId();
  const { state, save } = useSave();
  return (
    <>
      <p className="rounded-md border border-line bg-surface-alt px-3.5 py-2.5 text-sm md:hidden">Sur ordinateur, avec un clavier.</p>
      <Panel title="Raccourcis">
        <div className="flex items-center gap-3 p-3.5">
          <p className="min-w-0 flex-1">
            <span id={id} className="flex items-center gap-2 text-base font-semibold">
              Raccourcis à une touche <SavedHint state={state} />
            </span>
            <span id={`${id}-help`} className="block text-sm text-fg-muted">
              Sur cet appareil. Jamais actifs pendant la saisie dans un champ. « / », Ctrl+K, « u » et Échap restent actifs.
            </span>
          </p>
          <Switch
            checked={enabled}
            onChange={(v) => void save(async () => (setShortcutsEnabled(v), { ok: true }))}
            labelledBy={id}
            describedBy={`${id}-help`}
          />
        </div>
      </Panel>
      {SHORTCUT_COLUMNS.map((c) => (
        <Panel key={c.title} title={c.title}>
          <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-4 gap-y-2 p-3.5 text-base">
            {c.keys.map(([keys, label]) => (
              <div key={keys.join("+") + label} className="contents">
                <dt className="flex gap-1">
                  {keys.map((k) => (
                    <kbd key={k} className={KBD}>
                      {k}
                    </kbd>
                  ))}
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      ))}
    </>
  );
}
