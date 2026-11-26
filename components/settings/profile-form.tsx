"use client";

import { useId, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { updateEmailAction, updateNameAction } from "@/lib/actions/profile";
import { NAME_MAX } from "@/lib/profile";
import { ConfirmIdentityCard } from "./identity";
import { SaveError, SavedHint, useSave } from "./saved";

const FIELD = "h-11 w-full rounded-sm border border-line-strong bg-surface px-3 text-base md:h-9 aria-invalid:border-err";

/** A text setting saved on blur or Entrée (docs/design/3.5 § 4); back to the saved value on failure. */
function TextSetting({
  label,
  initial,
  type = "text",
  autoComplete,
  maxLength,
  onSave,
  help,
}: {
  label: string;
  initial: string;
  type?: "text" | "email";
  autoComplete: string;
  maxLength?: number;
  onSave: (v: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  help?: string;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const saved = useRef(initial);
  const { state, save } = useSave();
  const commit = () => {
    const v = value.trim();
    if (v === saved.current) return;
    const before = saved.current;
    void save(
      async () => {
        const r = await onSave(v);
        if (r.ok) saved.current = v;
        return r;
      },
      () => setValue(before),
    );
  };
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-sm font-semibold">
          {label}
        </label>
        <SavedHint state={state} />
      </div>
      <input
        id={id}
        type={type}
        value={value}
        maxLength={maxLength}
        autoComplete={autoComplete}
        aria-invalid={state.status === "error" || undefined}
        aria-describedby={help ? `${id}-help` : undefined}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        className={FIELD}
      />
      {help && (
        <p id={`${id}-help`} className="text-sm text-fg-muted">
          {help}
        </p>
      )}
      <SaveError state={state} />
    </div>
  );
}

/**
 * Paramètres › Profil (docs/design/3.5 § 5): Prénom and Nom (required, 50 characters), the e-mail (protected by the
 * identity re-confirmation; the app sends no e-mail, so no verification link), the identifier (read-only).
 */
export function ProfileForm({
  me,
  grantUntil,
  proof,
}: {
  me: { firstName: string; lastName: string; email: string; name: string };
  grantUntil: number | null;
  proof: "password" | "code";
}) {
  const [until, setUntil] = useState(grantUntil);
  const [editingEmail, setEditingEmail] = useState(false);
  // Null once expired (the server says so: the e-mail action then asks again, below).
  const granted = until !== null;
  return (
    <Panel title="Identité">
      <div className="grid gap-4 p-3.5">
        <div className="grid gap-4 md:grid-cols-2">
          <TextSetting label="Prénom" initial={me.firstName} autoComplete="given-name" maxLength={NAME_MAX} onSave={(v) => updateNameAction("firstName", v)} />
          <TextSetting label="Nom" initial={me.lastName} autoComplete="family-name" maxLength={NAME_MAX} onSave={(v) => updateNameAction("lastName", v)} />
        </div>
        {editingEmail && granted ? (
          <TextSetting
            label="E-mail"
            type="email"
            initial={me.email}
            autoComplete="email"
            maxLength={254}
            help="Adresse de connexion. Le changement s'applique dès que tu quittes le champ."
            onSave={async (v) => {
              const r = await updateEmailAction(v);
              if (!r.ok && r.reconfirm) setUntil(null);
              return r;
            }}
          />
        ) : (
          <div className="grid gap-1.5">
            <span className="text-sm font-semibold">E-mail</span>
            <p className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-sm break-all">{me.email}</span>
              {!editingEmail && (
                <button type="button" className={`${buttonClass("secondary")} max-md:min-h-11`} onClick={() => setEditingEmail(true)}>
                  Modifier
                </button>
              )}
            </p>
            {editingEmail && !granted && <ConfirmIdentityCard proof={proof} what="changer ton adresse e-mail" onConfirmed={setUntil} />}
          </div>
        )}
        <div className="grid gap-1.5">
          <span className="text-sm font-semibold">Identifiant</span>
          <p className="font-mono text-sm text-fg-muted">{me.name}</p>
        </div>
      </div>
    </Panel>
  );
}
