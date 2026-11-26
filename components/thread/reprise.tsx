"use client";

import { useRouter } from "next/navigation";
import { ActionMenu } from "@/components/ui/action-menu";
import { IconClipboard, IconExternal } from "@/components/ui/icons";
import { separateRepriseAction, undoSeparateAction } from "@/lib/actions/merge";
import { showToast } from "@/lib/toast-client";

/**
 * ⋯ of a « reprise » (docs/design/3.3 § 2): Séparer de ce topic (toast with Annuler), Ouvrir l'article d'origine,
 * Copier le lien. The page refreshes itself after a change (it stays where it was).
 */
export function RepriseMenu({ replyId, url, source }: { replyId: number; url: string; source: string }) {
  const router = useRouter();
  return (
    <ActionMenu
      label={`Actions pour la reprise de ${source}`}
      actions={[
        {
          label: "Séparer de ce topic",
          icon: <span aria-hidden>⤴</span>,
          onSelect: () =>
            void separateRepriseAction(replyId).then((r) => {
              if (!r.ok) return showToast({ kind: "error", title: "Séparer :", msg: r.error });
              router.refresh();
              showToast({
                kind: "ok",
                title: "Séparé du topic",
                action: {
                  label: "Annuler",
                  onClick: () =>
                    void undoSeparateAction(r.topicId, r.fromTopicId).then((u) => {
                      if (!u.ok) showToast({ kind: "error", title: "Annulation impossible :", msg: u.error ?? "" });
                      router.refresh();
                    }),
                },
              });
            }),
        },
        { label: "Ouvrir l'article d'origine ↗", icon: <IconExternal size={16} />, onSelect: () => void window.open(url, "_blank", "noopener,noreferrer") },
        {
          label: "Copier le lien",
          icon: <IconClipboard size={16} />,
          onSelect: () =>
            void navigator.clipboard.writeText(url).then(
              () => showToast({ kind: "ok", title: "Lien de l'article copié", durationMs: 2000 }),
              () => showToast({ kind: "error", title: "Impossible de copier le lien" }),
            ),
        },
      ]}
    />
  );
}
