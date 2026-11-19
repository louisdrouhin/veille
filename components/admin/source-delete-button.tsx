"use client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconTrash } from "@/components/ui/icons";
import { SubmitButton } from "@/components/ui/submit-button";
import { deleteSource, setSourceEnabled } from "@/lib/actions/admin";

/** Delete with confirmation; deactivating is offered first (nothing is lost). */
export function SourceDeleteButton({ id, name, enabled }: { id: number; name: string; enabled: boolean }) {
  return (
    <ConfirmDialog
      title={`Supprimer « ${name} » ?`}
      description={
        <>
          <p>La source ne sera plus récupérée. Cette action est définitive.</p>
          <p className="mt-1.5">
            Ses topics et tes notes sont conservés (auteur affiché : « Source supprimée »).
            {enabled && <> Pour simplement arrêter de la suivre, désactive-la plutôt.</>}
          </p>
        </>
      }
      trigger={(open) => (
        <Button variant="ghost-icon" className="text-err" aria-label={`Supprimer « ${name} »`} title="Supprimer" onClick={open}>
          <IconTrash size={15} />
        </Button>
      )}
    >
      {enabled && (
        <form action={setSourceEnabled}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="enabled" value="false" />
          <SubmitButton variant="primary">Désactiver plutôt</SubmitButton>
        </form>
      )}
      <form action={deleteSource}>
        <input type="hidden" name="id" value={id} />
        <SubmitButton variant="danger-solid">Supprimer</SubmitButton>
      </form>
    </ConfirmDialog>
  );
}
