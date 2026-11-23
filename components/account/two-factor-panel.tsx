"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { QrCode } from "@/components/account/qr-code";
import { buttonClass } from "@/components/ui/button";
import { IconAlertCircle, IconBan, IconCheck } from "@/components/ui/icons";
import { Panel } from "@/components/ui/panel";
import { authClient } from "@/lib/auth-client";

const PILL = "inline-flex h-5.5 items-center gap-1.25 rounded-full px-2 text-xs font-semibold whitespace-nowrap";

const FIELD =
  "h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-[16px] font-normal text-fg md:text-[15px] aria-invalid:border-err";

type Mode =
  | { kind: "idle" }
  | { kind: "confirm-password"; action: "enable" | "disable" | "regenerate" }
  | { kind: "scan"; totpURI: string; backupCodes: string[] }
  | { kind: "codes"; backupCodes: string[] };

/** Secret in base32 for manual entry, taken from the otpauth:// URI. */
function secretOf(totpURI: string): string {
  try {
    return (new URL(totpURI).searchParams.get("secret") ?? "").replace(/(.{4})/g, "$1 ").trim();
  } catch {
    return "";
  }
}

function errorText(error: { status: number; code?: string; message?: string }): string {
  if (error.status === 429) return "Trop de tentatives, réessaie dans quelques secondes.";
  if (error.code === "INVALID_PASSWORD") return "Mot de passe incorrect.";
  if (error.code === "INVALID_CODE") return "Code invalide : vérifie l'heure de ton téléphone et réessaie.";
  return error.message || "Opération impossible.";
}

export function TwoFactorPanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setMode({ kind: "idle" });
    setError(null);
  }

  function onPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode.kind !== "confirm-password") return;
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    const action = mode.action;
    setError(null);
    startTransition(async () => {
      if (action === "enable") {
        const { data, error } = await authClient.twoFactor.enable({ password, issuer: "Veille" });
        if (error || !data || !("totpURI" in data)) return setError(errorText(error ?? { status: 500 }));
        setMode({ kind: "scan", totpURI: data.totpURI, backupCodes: data.backupCodes });
      } else if (action === "disable") {
        const { error } = await authClient.twoFactor.disable({ password });
        if (error) return setError(errorText(error));
        reset();
        router.refresh();
      } else {
        const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
        if (error || !data) return setError(errorText(error ?? { status: 500 }));
        setMode({ kind: "codes", backupCodes: data.backupCodes });
      }
    });
  }

  function onVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s+/g, "");
    setError(null);
    startTransition(async () => {
      const { error } = await authClient.twoFactor.verifyTotp({ code });
      if (error) return setError(errorText(error));
      reset();
      router.refresh();
    });
  }

  const errorBox = error && (
    <div role="alert" className="flex items-start gap-2 rounded-sm border border-err bg-err-soft p-2.5 text-base text-err">
      <IconAlertCircle size={18} className="mt-px shrink-0" />
      <p>{error}</p>
    </div>
  );

  return (
    <Panel id="2fa" title="Double authentification (TOTP)">
      <div className="flex flex-col gap-3.5 p-3.5 text-base">
        <div className="flex flex-wrap items-center gap-2">
          <span>État :</span>
          {enabled ? (
            <span className={`${PILL} bg-ok-soft text-ok`}>
              <IconCheck size={12} /> Activée
            </span>
          ) : (
            <span className={`${PILL} border border-dashed border-line-strong bg-off-soft text-off`}>
              <IconBan size={12} /> Désactivée
            </span>
          )}
        </div>
        <p className="text-fg-muted">
          En plus du mot de passe, la connexion demande un code à 6 chiffres généré par une application
          d&apos;authentification (Aegis, 2FAS, Google Authenticator, Bitwarden…).
        </p>

        {mode.kind === "idle" && (
          <div className="flex flex-wrap gap-2">
            {enabled ? (
              <>
                <button
                  type="button"
                  className={buttonClass("secondary")}
                  onClick={() => setMode({ kind: "confirm-password", action: "regenerate" })}
                >
                  Régénérer les codes de secours
                </button>
                <button type="button" className={buttonClass("danger")} onClick={() => setMode({ kind: "confirm-password", action: "disable" })}>
                  Désactiver
                </button>
              </>
            ) : (
              <button type="button" className={buttonClass("primary")} onClick={() => setMode({ kind: "confirm-password", action: "enable" })}>
                Activer la double authentification
              </button>
            )}
          </div>
        )}

        {mode.kind === "confirm-password" && (
          <form onSubmit={onPassword} className="flex max-w-[360px] flex-col gap-3">
            {errorBox}
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Confirme ton mot de passe
              <input className={FIELD} name="password" type="password" autoComplete="current-password" required autoFocus />
            </label>
            <div className="flex gap-2">
              <button type="submit" className={buttonClass(mode.action === "disable" ? "danger-solid" : "primary")} disabled={pending}>
                {pending
                  ? "…"
                  : mode.action === "enable"
                    ? "Continuer"
                    : mode.action === "disable"
                      ? "Désactiver la double authentification"
                      : "Générer de nouveaux codes"}
              </button>
              <button type="button" className={buttonClass("secondary")} onClick={reset}>
                Annuler
              </button>
            </div>
          </form>
        )}

        {mode.kind === "scan" && (
          <div className="flex flex-col gap-4">
            <ol className="flex list-decimal flex-col gap-1 pl-5">
              <li>Scanne ce QR code avec ton application d&apos;authentification.</li>
              <li>Range les codes de secours en lieu sûr (gestionnaire de mots de passe).</li>
              <li>Saisis le code affiché par l&apos;application pour confirmer.</li>
            </ol>
            <div className="flex flex-wrap items-start gap-5">
              <QrCode value={mode.totpURI} label="QR code de configuration de la double authentification" />
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-sm font-semibold">Saisie manuelle de la clé</span>
                <code className="rounded-sm bg-surface-hover px-2 py-1 font-mono text-sm break-all select-all">{secretOf(mode.totpURI)}</code>
              </div>
            </div>
            <BackupCodes codes={mode.backupCodes} />
            <form onSubmit={onVerify} className="flex max-w-[360px] flex-col gap-3">
              {errorBox}
              <label className="flex flex-col gap-1.5 text-sm font-semibold">
                Code de vérification
                <input
                  className={`${FIELD} font-mono tracking-widest`}
                  name="code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9 ]{6,7}"
                  maxLength={7}
                  autoComplete="one-time-code"
                  required
                />
              </label>
              <div className="flex gap-2">
                <button type="submit" className={buttonClass("primary")} disabled={pending}>
                  {pending ? "Vérification…" : "Activer"}
                </button>
                <button type="button" className={buttonClass("secondary")} onClick={reset}>
                  Annuler
                </button>
              </div>
            </form>
          </div>
        )}

        {mode.kind === "codes" && (
          <div className="flex flex-col gap-3">
            <p>Nouveaux codes de secours : les anciens ne fonctionnent plus.</p>
            <BackupCodes codes={mode.backupCodes} />
            <button type="button" className={buttonClass("secondary", "sm", "self-start")} onClick={reset}>
              J&apos;ai noté les codes
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function BackupCodes({ codes }: { codes: string[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold">Codes de secours (un seul usage chacun, affichés une seule fois)</span>
      <ul className="grid max-w-[420px] grid-cols-2 gap-x-6 gap-y-1 rounded-sm border border-line bg-surface-hover p-3 font-mono text-sm select-all">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </div>
  );
}
