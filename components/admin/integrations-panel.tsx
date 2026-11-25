"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { IconAlert, IconAlertCircle, IconBan, IconCheck, IconShieldCheck } from "@/components/ui/icons";
import { Panel } from "@/components/ui/panel";
import { Sheet } from "@/components/ui/sheet";
import {
  generateVapidAction,
  importVapidAction,
  reconfirmAction,
  removeSettingAction,
  saveKeyAction,
  saveModelsAction,
  testKeyAction,
  type Result,
} from "@/lib/actions/integrations";
import { formatFull, formatTime } from "@/lib/format-date";
import type { IntegrationsView, KeyState, ModelState } from "@/lib/secrets/view";
import { showToast } from "@/lib/toast-client";

const PILL = "inline-flex h-5.5 items-center gap-1.25 rounded-full px-2 text-xs font-semibold whitespace-nowrap";
const FIELD =
  "h-9 w-full rounded-sm border border-line-strong bg-surface px-2.5 text-base font-normal text-fg max-md:h-11 max-md:text-[16px] aria-invalid:border-err disabled:opacity-60";
const LABEL = "flex min-w-0 flex-col gap-1 text-xs font-semibold text-fg-muted";

type Run = <T extends object>(fn: () => Promise<Result<T>>, onOk?: (r: T) => void) => void;

/**
 * Admin › Intégrations. The keys are write-only: the server only sends their source, their last 4
 * characters and their last test. Every change asks for the password (or the 2FA code) when the
 * last confirmation is more than 5 minutes old.
 */
export function IntegrationsPanel({ view, grantUntil, proof }: { view: IntegrationsView; grantUntil: number | null; proof: "password" | "code" }) {
  const router = useRouter();
  const readOnly = view.master !== "ok";
  const [until, setUntil] = useState(grantUntil);
  const [now, setNow] = useState(() => Date.now());
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [busy, start] = useTransition();

  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [until]);
  const allowed = until !== null && until > now;

  const run: Run = (fn, onOk) => {
    const attempt = () =>
      start(async () => {
        const r = await fn();
        if (r.ok) {
          onOk?.(r);
          router.refresh();
        } else if (r.reconfirm) {
          setUntil(null);
          setPendingAction(() => attempt);
        } else showToast({ kind: "error", title: r.error });
      });
    attempt();
  };

  return (
    <div className="flex flex-col gap-5">
      {readOnly ? (
        <div role="status" className="flex items-start gap-2.5 rounded-md border border-warn bg-warn-soft p-3.5 text-base text-fg">
          <IconAlert size={18} className="mt-0.5 shrink-0 text-warn" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="font-semibold">
              {view.master === "missing" ? "Lecture seule : SECRETS_KEY n'est pas définie sur le serveur." : "Lecture seule : SECRETS_KEY est invalide (32 octets en base64 attendus)."}
            </p>
            <p>
              Les clés sont chiffrées avec cette clé maîtresse. En attendant, l&apos;app continue avec les valeurs du .env. Pour activer les
              modifications, ajoute dans le .env du serveur la sortie de :
            </p>
            <code className="w-fit max-w-full rounded-sm bg-surface px-2 py-1 font-mono text-sm break-all select-all">openssl rand -base64 32</code>
            <p>
              sous la forme <code className="font-mono text-sm">SECRETS_KEY=…</code>, puis <code className="font-mono text-sm">docker compose up -d</code>. Garde-la
              précieusement : sans elle, les clés enregistrées ici ne sont plus lisibles.
            </p>
          </div>
        </div>
      ) : (
        allowed && (
          <p role="status" className="flex items-center gap-2 text-sm text-fg-muted">
            <IconShieldCheck size={16} className="text-ok" /> Identité confirmée : modifications possibles jusqu&apos;à {formatTime(new Date(until!))}.
          </p>
        )
      )}

      <div className="flex flex-wrap items-start gap-5">
        <Panel id="gemini" title="Gemini · résumé et traduction" className="w-full min-w-0 min-[1000px]:flex-[1_1_440px]">
          <KeyRow state={view.gemini.key} readOnly={readOnly} busy={busy} run={run} help="Clé Google AI Studio (aistudio.google.com › Get API key)." />
          <ModelsForm models={view.gemini.models} readOnly={readOnly} busy={busy} run={run} />
        </Panel>
        <Panel id="nvd" title="NVD · vulnérabilités" className="w-full min-w-0 min-[1000px]:flex-[1_1_440px]">
          <KeyRow
            state={view.nvd.key}
            readOnly={readOnly}
            busy={busy}
            run={run}
            help="Optionnelle : 50 requêtes par 30 s au lieu de 5 (nvd.nist.gov › Request an API key)."
          />
        </Panel>
      </div>

      <VapidPanel vapid={view.vapid} readOnly={readOnly} busy={busy} run={run} />
      <JournalPanel journal={view.journal} />

      <ReconfirmSheet
        open={pendingAction !== null}
        proof={proof}
        onClose={() => setPendingAction(null)}
        onConfirmed={(u) => {
          setUntil(u);
          setNow(Date.now());
          const next = pendingAction;
          setPendingAction(null);
          next?.();
        }}
      />
    </div>
  );
}

function SourceBadge({ source, unreadable }: { source: KeyState["source"] | "default"; unreadable?: boolean }) {
  if (unreadable)
    return (
      <span className={`${PILL} bg-err-soft text-err`}>
        <IconAlertCircle size={12} /> Illisible
      </span>
    );
  if (source === "interface") return <span className={`${PILL} bg-ok-soft text-ok`}>Interface</span>;
  if (source === "env") return <span className={`${PILL} bg-surface-hover text-fg`}>.env</span>;
  if (source === "default") return <span className={`${PILL} bg-surface-hover text-fg-muted`}>Par défaut</span>;
  return (
    <span className={`${PILL} border border-dashed border-line-strong bg-off-soft text-off`}>
      <IconBan size={12} /> Non configurée
    </span>
  );
}

function Masked({ hint }: { hint: string | null }) {
  if (hint === null) return null;
  return (
    <span className="font-mono text-sm text-fg-muted" aria-label={hint ? `clé masquée, se termine par ${hint}` : "clé masquée"}>
      ••••{hint}
    </span>
  );
}

function TestLine({ test }: { test: KeyState["test"] }) {
  if (!test) return <p className="text-sm text-fg-muted">Jamais testée.</p>;
  return (
    <p className={`flex items-start gap-1.5 text-sm ${test.ok ? "text-ok" : "text-err"}`}>
      {test.ok ? <IconCheck size={14} className="mt-0.5 shrink-0" /> : <IconAlertCircle size={14} className="mt-0.5 shrink-0" />}
      <span>
        {test.ok ? "Testée" : "Erreur"} le {formatFull(new Date(test.at))} : {test.message}
      </span>
    </p>
  );
}

function KeyRow({ state, readOnly, busy, run, help }: { state: KeyState; readOnly: boolean; busy: boolean; run: Run; help: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const inputId = useId();
  const helpId = useId();

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const v = value;
    run(
      () => saveKeyAction(state.name, v),
      () => {
        setValue("");
        setEditing(false);
        showToast({ kind: "ok", title: `${state.label} enregistrée.` });
      },
    );
  };

  return (
    <div className="flex flex-col gap-2.5 border-b border-line p-3.5 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{state.label}</span>
        <SourceBadge source={state.source} unreadable={state.unreadable} />
        <Masked hint={state.source ? state.hint : null} />
      </div>
      {state.unreadable && (
        <p className="text-sm text-err">
          Enregistrée dans l&apos;interface mais illisible (SECRETS_KEY absente ou différente) : {state.source === "env" ? "la valeur du .env est utilisée." : "aucune clé utilisée."} Remplace-la ou supprime-la.
        </p>
      )}
      {state.source && <TestLine test={state.test} />}
      <p id={helpId} className="text-sm text-fg-muted">
        {help}
      </p>

      {editing ? (
        <form onSubmit={save} className="flex flex-col gap-2">
          <label htmlFor={inputId} className={LABEL}>
            Nouvelle clé
          </label>
          <input
            id={inputId}
            className={`${FIELD} font-mono`}
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            aria-describedby={helpId}
            required
            autoFocus
          />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={buttonClass("primary")} disabled={busy || !value.trim()}>
              Enregistrer
            </button>
            <button
              type="button"
              className={buttonClass("secondary")}
              onClick={() => {
                setValue("");
                setEditing(false);
              }}
            >
              Annuler
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {state.source && (
            <button
              type="button"
              className={buttonClass("secondary")}
              disabled={busy}
              onClick={() =>
                run(
                  () => testKeyAction(state.name),
                  (r) => showToast({ kind: r.test.ok ? "ok" : "error", title: r.test.message }),
                )
              }
            >
              Tester la clé
            </button>
          )}
          <button type="button" className={buttonClass("secondary")} disabled={readOnly || busy} onClick={() => setEditing(true)}>
            {state.source === "interface" || state.unreadable ? "Remplacer" : "Saisir une clé"}
          </button>
          {(state.source === "interface" || state.unreadable) && (
            <button type="button" className={buttonClass("danger")} disabled={readOnly || busy} onClick={() => setConfirmRemove(true)}>
              Supprimer
            </button>
          )}
        </div>
      )}

      <Sheet open={confirmRemove} onClose={() => setConfirmRemove(false)} title={`Supprimer la ${state.label.toLowerCase()} ?`}>
        <div className="flex flex-col gap-3 px-4 pt-1 text-base">
          <p>La clé enregistrée dans l&apos;interface est effacée. L&apos;app reprend la valeur du .env du serveur s&apos;il y en a une, sinon la fonction est coupée.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass("danger-solid")}
              disabled={busy}
              onClick={() => {
                setConfirmRemove(false);
                run(
                  () => removeSettingAction(state.name),
                  () => showToast({ kind: "ok", title: `${state.label} supprimée.` }),
                );
              }}
            >
              Supprimer
            </button>
            <button type="button" className={buttonClass("secondary")} onClick={() => setConfirmRemove(false)}>
              Annuler
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function ModelsForm({ models, readOnly, busy, run }: { models: [ModelState, ModelState]; readOnly: boolean; busy: boolean; run: Run }) {
  const initial = models.map((m) => (m.source === "interface" ? m.value : ""));
  const [values, setValues] = useState(initial);
  const changed = values.some((v, i) => v.trim() !== initial[i]);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const [model, translateModel] = values;
    run(
      () => saveModelsAction({ model, translateModel }),
      () => showToast({ kind: "ok", title: "Modèles enregistrés." }),
    );
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-3 p-3.5">
      <div className="grid gap-3 md:grid-cols-2">
        {models.map((m, i) => (
          <label key={m.name} className={LABEL}>
            <span className="flex items-center gap-2">
              {m.label} <SourceBadge source={m.source} />
            </span>
            <input
              className={`${FIELD} font-mono`}
              value={values[i]}
              placeholder={m.source === "interface" ? "" : m.value}
              onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
              spellCheck={false}
              autoCapitalize="off"
              disabled={readOnly}
            />
          </label>
        ))}
      </div>
      <p className="text-sm text-fg-muted">Vide : valeur du .env, sinon le modèle par défaut (en gris). « Tester la clé » vérifie aussi que les deux modèles existent.</p>
      <div>
        <button type="submit" className={buttonClass("primary")} disabled={readOnly || busy || !changed}>
          Enregistrer les modèles
        </button>
      </div>
    </form>
  );
}

function VapidPanel({ vapid, readOnly, busy, run }: { vapid: IntegrationsView["vapid"]; readOnly: boolean; busy: boolean; run: Run }) {
  const [confirm, setConfirm] = useState<null | "generate" | "remove">(null);
  const devices = `${vapid.devices} appareil${vapid.devices > 1 ? "s" : ""} abonné${vapid.devices > 1 ? "s" : ""}`;

  return (
    <Panel id="vapid" title="Notifications push · clés VAPID">
      <div className="flex flex-col gap-2.5 p-3.5 text-base">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Paire de clés</span>
          <SourceBadge source={vapid.source} unreadable={vapid.unreadable} />
          {vapid.hint && <span className="font-mono text-sm text-fg-muted">publique ••••{vapid.hint}</span>}
          <span className="text-sm text-fg-muted">· {devices}</span>
        </div>
        <p className="text-sm text-fg-muted">La clé privée reste sur le serveur : elle n&apos;est jamais affichée.</p>
        {vapid.source === "env" && (
          <p className="text-sm text-fg-muted">
            « Reprendre les clés du .env » les enregistre ici, chiffrées : ce sont les mêmes clés, les appareils restent abonnés. Tu pourras ensuite les retirer
            du .env.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {vapid.envPair && vapid.source !== "interface" && (
            <button
              type="button"
              className={buttonClass("primary")}
              disabled={readOnly || busy}
              onClick={() =>
                run(
                  () => importVapidAction(),
                  () => showToast({ kind: "ok", title: "Clés VAPID reprises du .env." }),
                )
              }
            >
              Reprendre les clés du .env
            </button>
          )}
          <button type="button" className={buttonClass("danger")} disabled={readOnly || busy} onClick={() => setConfirm("generate")}>
            Générer les clés
          </button>
          {vapid.source === "interface" && vapid.envPair && (
            <button type="button" className={buttonClass("secondary")} disabled={readOnly || busy} onClick={() => setConfirm("remove")}>
              Revenir au .env
            </button>
          )}
        </div>
      </div>

      <Sheet open={confirm !== null} onClose={() => setConfirm(null)} title={confirm === "generate" ? "Générer de nouvelles clés VAPID ?" : "Revenir aux clés du .env ?"}>
        <div className="flex flex-col gap-3 px-4 pt-1 text-base">
          <div role="alert" className="flex items-start gap-2 rounded-sm border border-warn bg-warn-soft p-2.5">
            <IconAlert size={18} className="mt-px shrink-0 text-warn" />
            <p>
              {confirm === "generate"
                ? `Tous les appareils sont désabonnés (${devices}) : il faudra réactiver les notifications sur chacun, dans Mon compte › Notifications.`
                : "Les appareils abonnés avec les clés de l'interface ne recevront plus rien si celles du .env sont différentes : il faudra les réabonner."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass("danger-solid")}
              disabled={busy}
              onClick={() => {
                const what = confirm;
                setConfirm(null);
                if (what === "generate")
                  run(
                    () => generateVapidAction(),
                    (r) => showToast({ kind: "ok", title: `Nouvelles clés VAPID générées, ${r.removedDevices} appareil(s) désabonné(s).` }),
                  );
                else
                  run(
                    () => removeSettingAction("vapid_private_key"),
                    () => showToast({ kind: "ok", title: "Clés VAPID du .env utilisées." }),
                  );
              }}
            >
              {confirm === "generate" ? "Générer et désabonner" : "Revenir au .env"}
            </button>
            <button type="button" className={buttonClass("secondary")} onClick={() => setConfirm(null)}>
              Annuler
            </button>
          </div>
        </div>
      </Sheet>
    </Panel>
  );
}

function JournalPanel({ journal }: { journal: IntegrationsView["journal"] }) {
  return (
    <Panel id="journal" title="Journal des modifications">
      {journal.length === 0 ? (
        <p className="px-3.5 py-4 text-sm text-fg-muted">Aucune modification pour l&apos;instant.</p>
      ) : (
        <ul className="divide-y divide-line">
          {journal.map((j) => (
            <li key={j.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3.5 py-2 text-base">
              <span>
                <span className="font-semibold">{j.label}</span> {j.action}
              </span>
              <time dateTime={j.at} className="text-sm text-fg-muted">
                {formatFull(new Date(j.at))}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ReconfirmSheet({ open, proof, onClose, onConfirmed }: { open: boolean; proof: "password" | "code"; onClose: () => void; onConfirmed: (until: number) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const errorId = useId();

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const secret = String(new FormData(form).get("proof") ?? "");
    setError(null);
    start(async () => {
      const r = await reconfirmAction(proof === "code" ? { code: secret } : { password: secret });
      if (!r.ok) return setError(r.error);
      form.reset();
      onConfirmed(r.until);
    });
  };

  return (
    <Sheet
      open={open}
      onClose={() => {
        setError(null);
        onClose();
      }}
      title="Confirme ton identité"
    >
      <form onSubmit={submit} className="flex flex-col gap-3 px-4 pt-1 text-base">
        <p className="text-fg-muted">Pour modifier les clés, {proof === "code" ? "saisis le code de ton application d'authentification" : "saisis ton mot de passe"}. Valable 5 minutes.</p>
        {error && (
          <div id={errorId} role="alert" className="flex items-start gap-2 rounded-sm border border-err bg-err-soft p-2.5 text-err">
            <IconAlertCircle size={18} className="mt-px shrink-0" />
            <p>{error}</p>
          </div>
        )}
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          {proof === "code" ? "Code à 6 chiffres" : "Mot de passe"}
          {proof === "code" ? (
            <input
              className={`${FIELD} font-mono tracking-widest`}
              name="proof"
              type="text"
              inputMode="numeric"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              autoComplete="one-time-code"
              aria-invalid={!!error}
              aria-describedby={error ? errorId : undefined}
              required
              autoFocus
            />
          ) : (
            <input
              className={FIELD}
              name="proof"
              type="password"
              autoComplete="current-password"
              aria-invalid={!!error}
              aria-describedby={error ? errorId : undefined}
              required
              autoFocus
            />
          )}
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={buttonClass("primary")} disabled={pending}>
            {pending ? "Vérification…" : "Confirmer"}
          </button>
          <button type="button" className={buttonClass("secondary")} onClick={onClose}>
            Annuler
          </button>
        </div>
      </form>
    </Sheet>
  );
}
