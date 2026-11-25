"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/confirm-dialog";
import { IconChevronRight, IconSpinner, IconTrash } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
import { removeStackItemAction, updateStackItemAction } from "@/lib/actions/stack";
import type { StackContext } from "@/lib/db/schema";
import type { SoftwareRow } from "@/lib/stack/queries";
import { showToast } from "@/lib/toast-client";
import { SEVERITY_PANEL, SeverityBadge } from "./badges";
import { ContextField, VersionCheck, VersionField } from "./version-field";

/**
 * Edit sheet (docs/design/3.0 § 4.3): link to the current alert, version (checked at once: « La 7.4.5
 * corrige CVE-… »), context, « Enregistrer », « Retirer de ma stack » with a confirmation.
 */
export function EditSheet({ row, onClose }: { row: SoftwareRow | null; onClose: () => void }) {
  return <Sheet open={row !== null} onClose={onClose} title={row ? row.name : ""}>{row && <EditForm key={row.id} row={row} onClose={onClose} />}</Sheet>;
}

function EditForm({ row, onClose }: { row: SoftwareRow; onClose: () => void }) {
  const router = useRouter();
  const [version, setVersion] = useState(row.version);
  const [context, setContext] = useState<StackContext>(row.context);
  const [distro, setDistro] = useState(row.distroPackage ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [removing, startRemove] = useTransition();
  const confirm = useRef<ConfirmDialogHandle>(null);
  const distroId = useId();

  const save = () =>
    startSave(async () => {
      setError(null);
      const res = await updateStackItemAction({ id: row.id, version, context, distroPackage: distro });
      if (!res.ok) return setError(res.error);
      onClose();
      showToast({
        kind: "ok",
        title: `${row.name} enregistré`,
        msg: res.closed ? `${res.closed} alerte${res.closed > 1 ? "s passées" : " passée"} en traitée${res.closed > 1 ? "s" : ""}.` : undefined,
      });
      router.refresh();
    });

  const remove = () =>
    startRemove(async () => {
      const res = await removeStackItemAction(row.id);
      confirm.current?.close();
      if (!res.ok) return setError(res.error);
      onClose();
      showToast({ kind: "ok", title: `${row.name} retiré de ta stack` });
      router.refresh();
    });

  return (
    <form
      className="grid gap-4 pb-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {row.topAlert && (
        <Link
          href={`/stack/alertes/${row.topAlert.id}`}
          prefetch={false}
          className={`flex min-h-12 items-center gap-2.5 rounded-md border px-3 py-2 text-fg no-underline hover:text-fg ${SEVERITY_PANEL[row.topAlert.severity]}`}
        >
          <SeverityBadge severity={row.topAlert.severity} cvss={row.topAlert.cvss} />
          <span className="min-w-0 flex-1 text-base">
            <span className="font-mono text-sm">{row.topAlert.ref}</span>
            {row.openCount > 1 && <span className="text-fg-muted"> et {row.openCount - 1} autre{row.openCount > 2 ? "s" : ""}</span>}
            <span className="block text-sm font-semibold">Voir l&apos;alerte en cours</span>
          </span>
          <IconChevronRight size={16} className="shrink-0" />
        </Link>
      )}
      <VersionField value={version} onChange={setVersion} scheme={row.scheme} latest={row.latestVersion} hint={row.versionHint} />
      {row.productId !== null ? (
        <VersionCheck productId={row.productId} productName={row.name} version={version} itemId={row.id} />
      ) : (
        <p className="text-sm text-fg-muted">Suivi par nom : pas de vérification automatique.</p>
      )}
      <ContextField value={context} onChange={setContext} />
      {row.productId !== null && (
        <div className="grid gap-1.5">
          <label htmlFor={distroId} className="text-sm font-semibold">
            Paquet de distribution <span className="font-normal text-fg-muted">(facultatif)</span>
          </label>
          <input id={distroId} value={distro} onChange={(e) => setDistro(e.target.value)} maxLength={120} placeholder="ex. Debian openssh 1:9.2p1-2+deb12u3" className="h-11 rounded-sm border border-line-strong bg-surface px-3 font-mono text-sm" />
        </div>
      )}
      {error && <p role="alert" className="text-sm text-err">{error}</p>}
      <Button type="submit" variant="primary" disabled={saving || !version.trim()} className="h-12! w-full text-base">
        {saving && <IconSpinner size={16} className="animate-spin motion-reduce:animate-none" />}
        Enregistrer
      </Button>
      <button
        type="button"
        onClick={() => confirm.current?.open()}
        className="inline-flex h-11 cursor-pointer items-center justify-center rounded-sm text-base font-semibold text-err hover:bg-err-soft"
      >
        Retirer de ma stack
      </button>
      <ConfirmDialog
        handle={confirm}
        title={`Retirer ${row.name} ${row.version} de ta stack ?`}
        description="Ses alertes ouvertes sont archivées ; l'historique reste dans « Traitées »."
      >
        <Button variant="danger-solid" size="sm" onClick={remove} disabled={removing}>
          Retirer
        </Button>
      </ConfirmDialog>
    </form>
  );
}

/** Desktop « Retirer » icon of a row: the same confirmation, without opening the sheet. */
export function RemoveButton({ row }: { row: SoftwareRow }) {
  const router = useRouter();
  const [removing, startRemove] = useTransition();
  const confirm = useRef<ConfirmDialogHandle>(null);
  return (
    <ConfirmDialog
      handle={confirm}
      trigger={{ label: `Retirer ${row.name}`, icon: <IconTrash size={14} /> }}
      title={`Retirer ${row.name} ${row.version} de ta stack ?`}
      description="Ses alertes ouvertes sont archivées ; l'historique reste dans « Traitées »."
    >
      <Button
        variant="danger-solid"
        size="sm"
        disabled={removing}
        onClick={() =>
          startRemove(async () => {
            const res = await removeStackItemAction(row.id);
            confirm.current?.close();
            showToast(res.ok ? { kind: "ok", title: `${row.name} retiré de ta stack` } : { kind: "error", title: res.error });
            router.refresh();
          })
        }
      >
        Retirer
      </Button>
    </ConfirmDialog>
  );
}
