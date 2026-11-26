"use client";

import { useCallback, useEffect, useId, useState, useSyncExternalStore, useTransition } from "react";
import { SeverityBadge } from "@/components/stack/badges";
import { Button } from "@/components/ui/button";
import { IconAlertCircle, IconBell, IconShare } from "@/components/ui/icons";
import { Panel } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { sendTestPushAction, unsubscribePushAction, updateNotificationSettingsAction, type SettingsInput } from "@/lib/actions/notifications";
import { hasPushApi, sameKey, subscribeThisDevice } from "@/lib/pwa/push-subscribe";
import type { NotifyThreshold } from "@/lib/db/schema";
import { useIsIos, useStandalone } from "@/lib/pwa/client";
import { pushAvailability } from "@/lib/pwa/platform";
import { showToast } from "@/lib/toast-client";

export type Settings = Required<SettingsInput>;

const THRESHOLDS: { key: NotifyThreshold; label: string; badge: "critical" | "high" | "medium" | "low" }[] = [
  { key: "critical", label: "Critique seulement", badge: "critical" },
  { key: "high", label: "Haute et plus", badge: "high" },
  { key: "medium", label: "Moyenne et plus", badge: "medium" },
  { key: "all", label: "Toutes", badge: "low" },
];

const permissionNow = () => (typeof Notification === "undefined" ? null : Notification.permission);
const noop = () => () => {};

/** « Sur cet appareil »: subscription of this device, asked only on a tap (iOS requirement). */
function DevicePanel({ publicKey }: { publicKey: string | null }) {
  const ios = useIsIos();
  const standalone = useStandalone();
  const hasPush = useSyncExternalStore(noop, hasPushApi, () => false);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const labelId = useId();
  const stateId = useId();

  useEffect(() => {
    let alive = true;
    void (async () => {
      const perm = permissionNow();
      let current: string | null = null;
      if (hasPushApi()) {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        // Made with other VAPID keys (regenerated in Admin › Intégrations): no longer valid.
        current = sub && publicKey && sameKey(sub, publicKey) ? sub.endpoint : null;
      }
      if (!alive) return;
      setPermission(perm);
      setEndpoint(current);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [publicKey]);

  const mode = pushAvailability({ configured: !!publicKey, ios, standalone, hasPush, permission });

  const enable = () =>
    start(async () => {
      setError(null);
      // Asked here, inside the tap: iOS refuses a permission request made at load time.
      const res = await subscribeThisDevice(publicKey!);
      setPermission(res.permission);
      if (res.ok) setEndpoint(res.endpoint);
      else if (res.error) setError(res.error);
    });

  const disable = () =>
    start(async () => {
      setError(null);
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      await unsubscribePushAction(sub?.endpoint ?? endpoint);
      await sub?.unsubscribe().catch(() => {});
      setEndpoint(null);
    });

  const test = () =>
    start(async () => {
      const res = await sendTestPushAction(endpoint);
      showToast(res.ok ? { kind: "ok", title: "Notification de test envoyée" } : { kind: "error", title: res.error });
      if (!res.ok && /plus abonné/.test(res.error)) setEndpoint(null);
    });

  const on = !!endpoint && permission === "granted";
  const unavailable = mode !== "available" || !ready;
  const stateText =
    mode === "install-ios" ? "Indisponible dans Safari" : mode === "unconfigured" ? "Non configurées sur le serveur" : mode === "unsupported" ? "Indisponible dans ce navigateur" : mode === "denied" ? "Refusées" : on ? "Activées sur cet appareil" : "Désactivées sur cet appareil";

  return (
    <Panel title="Sur cet appareil">
      <div className="grid gap-3 p-3.5">
        <div className="flex items-center gap-3">
          <IconBell size={18} className="shrink-0 text-fg-muted" />
          <div className="min-w-0 flex-1">
            <p id={labelId} className="text-base font-semibold">
              Alertes Ma stack
            </p>
            <p id={stateId} className="text-sm text-fg-muted">
              {stateText}
            </p>
          </div>
          <Switch checked={on} onChange={(v) => (v ? enable() : disable())} labelledBy={labelId} describedBy={stateId} disabled={unavailable} busy={busy} />
        </div>

        {mode === "install-ios" && (
          <div className="rounded-md border border-accent bg-accent-soft p-3 text-base">
            <p className="font-semibold">Installe d&apos;abord Folders sur ton écran d&apos;accueil</p>
            <p className="mt-0.5 text-sm text-fg-muted">Sur iPhone, les notifications ne marchent que dans l&apos;app installée (iOS 16.4 ou plus).</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              <li>
                Touche <IconShare size={14} className="inline align-[-2px]" aria-label="Partager" /> Partager dans Safari ;
              </li>
              <li>choisis « Sur l&apos;écran d&apos;accueil » ;</li>
              <li>rouvre Folders depuis son icône, puis reviens ici.</li>
            </ol>
          </div>
        )}
        {mode === "denied" && (
          <div className="rounded-md border border-line-strong bg-surface-alt p-3 text-base">
            <p className="font-semibold">{ios ? "Notifications refusées sur cet iPhone" : "Notifications refusées dans ce navigateur"}</p>
            <p className="mt-0.5 text-sm text-fg-muted">
              {ios ? "Pour les autoriser : Réglages iOS › Notifications › Folders." : "Autorise-les pour ce site dans les réglages du navigateur, puis recharge la page."}
            </p>
          </div>
        )}
        {mode === "unconfigured" && <p className="text-sm text-fg-muted">Génère les clés VAPID dans Administration › Intégrations (ou ajoute-les au .env du serveur).</p>}
        {error && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-err bg-err-soft p-3 text-base">
            <IconAlertCircle size={18} className="shrink-0 text-err" />
            <span className="min-w-0 flex-1 text-err">{error}</span>
            <Button size="sm" onClick={enable}>
              Réessayer
            </Button>
          </div>
        )}
        {on && (
          <Button onClick={test} disabled={busy} className="w-fit max-md:w-full">
            Envoyer une notification de test
          </Button>
        )}
      </div>
    </Panel>
  );
}

/** « Ce qui déclenche une notification », heures calmes, notifications discrètes: saved on change. */
function RulesPanel({ initial }: { initial: Settings }) {
  const [s, setS] = useState(initial);
  const [, start] = useTransition();
  const name = useId();
  const ids = { exploited: useId(), quiet: useId(), homelab: useId(), work: useId(), discreet: useId(), from: useId(), to: useId() };
  const save = useCallback(
    (patch: SettingsInput) => {
      setS((prev) => ({ ...prev, ...patch }));
      start(async () => {
        const res = await updateNotificationSettingsAction(patch);
        if (!res.ok) showToast({ kind: "error", title: res.error });
      });
    },
    [start],
  );

  return (
    <>
      <Panel title="Ce qui déclenche une notification">
        <div className="grid gap-3 p-3.5">
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold">Gravité minimale</legend>
            <div role="radiogroup" className="grid gap-0.5">
              {THRESHOLDS.map((t) => (
                <label key={t.key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-1 hover:bg-surface-hover">
                  <input type="radio" name={name} value={t.key} checked={s.threshold === t.key} onChange={() => save({ threshold: t.key })} className="size-4 accent-[var(--accent)]" />
                  <span className="min-w-0 flex-1 text-base">{t.label}</span>
                  <SeverityBadge severity={t.badge} />
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex items-center gap-3 border-t border-line pt-3">
            <p className="min-w-0 flex-1 text-base">
              <span id={ids.exploited}>Toujours si la faille est exploitée</span>
              <span id={`${ids.exploited}-help`} className="block text-sm text-fg-muted">
                même sous le seuil
              </span>
            </p>
            <Switch checked={s.exploitedAlways} onChange={(v) => save({ exploitedAlways: v })} labelledBy={ids.exploited} describedBy={`${ids.exploited}-help`} />
          </div>
        </div>
      </Panel>

      <Panel title="Heures calmes">
        <div className="grid gap-3 p-3.5">
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 text-base">
              <span id={ids.quiet}>Heures calmes</span>
              <span id={`${ids.quiet}-help`} className="block text-sm text-fg-muted">Les notifications attendent et partent groupées à la fin. Le badge et la liste restent à jour.</span>
            </p>
            <Switch checked={s.quietEnabled} onChange={(v) => save({ quietEnabled: v })} labelledBy={ids.quiet} describedBy={`${ids.quiet}-help`} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {(
              [
                ["quietFrom", "De", ids.from],
                ["quietTo", "À", ids.to],
              ] as const
            ).map(([k, label, id]) => (
              <span key={k} className="inline-flex items-center gap-2">
                <label htmlFor={id} className="text-sm font-semibold">
                  {label}
                </label>
                <input
                  id={id}
                  type="time"
                  value={s[k]}
                  disabled={!s.quietEnabled}
                  onChange={(e) => /^\d\d:\d\d$/.test(e.target.value) && save({ [k]: e.target.value })}
                  className="h-11 rounded-sm border border-line-strong bg-surface px-2 font-mono text-base disabled:opacity-60 md:h-9"
                />
              </span>
            ))}
          </div>
        </div>
      </Panel>

      <Panel title="Notifications discrètes">
        <div className="grid gap-2 p-3.5">
          <p id={ids.discreet} className="text-sm text-fg-muted">
            Titre et texte génériques (« Folders · Nouvelle alerte critique »), sans nom de produit ni version : rien ne s&apos;affiche sur l&apos;écran verrouillé.
          </p>
          {(
            [
              ["discreetHomelab", "Homelab", ids.homelab],
              ["discreetWork", "Travail", ids.work],
            ] as const
          ).map(([k, label, id]) => (
            <div key={k} className="flex items-center gap-3">
              <p id={id} className="min-w-0 flex-1 text-base">
                {label}
              </p>
              <Switch checked={s[k]} onChange={(v) => save({ [k]: v })} labelledBy={id} describedBy={ids.discreet} />
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}

export function NotificationsSettings({ publicKey, settings }: { publicKey: string | null; settings: Settings }) {
  return (
    <div className="grid gap-4">
      <DevicePanel publicKey={publicKey} />
      <RulesPanel initial={settings} />
    </div>
  );
}
