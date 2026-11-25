"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { IconAlertCircle, IconCheck, IconRefresh, IconSpinner } from "@/components/ui/icons";
import { RelativeTime } from "@/components/ui/relative-time";
import { checkStackNowAction } from "@/lib/actions/stack";
import { setPageRefresh } from "@/lib/page-refresh";

export type CheckLineProps = { lastCheckAt: string | null; lastFullCheckAt: string | null; failed: string[]; sources: string[] };

const join = (list: string[]) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} et ${list.at(-1)}` : (list[0] ?? ""));

/**
 * « Vérifié il y a 12 min · CERT-FR, NVD, GitHub » (docs/design/3.0 § 4.1), or the error banner of
 * an incomplete check (§ 6): the list stays below with the statuses of the last complete check.
 * Registers the page's refresh job: pull to refresh and « Réessayer » ask for a new check (refused
 * by the server within 5 min of the previous one, the page is simply re-rendered then).
 */
export function CheckLine({ lastCheckAt, lastFullCheckAt, failed, sources }: CheckLineProps) {
  const router = useRouter();
  const [checking, startCheck] = useTransition();
  const check = useCallback(() => checkStackNowAction(), []);
  useEffect(() => setPageRefresh(check), [check]);

  const retry = () =>
    startCheck(async () => {
      await check();
      router.refresh();
    });

  if (checking) {
    return (
      <p role="status" className="flex min-h-11 items-center gap-2 text-sm text-fg-muted">
        <IconSpinner size={14} className="animate-spin motion-reduce:animate-none" />
        Vérification de ta stack…
      </p>
    );
  }
  if (failed.length > 0) {
    return (
      <div role="alert" className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border border-err bg-err-soft p-3">
        <IconAlertCircle size={18} className="mt-0.5 shrink-0 text-err" />
        <div className="min-w-0 flex-1 text-base">
          <p className="font-semibold text-err">
            Vérification incomplète. {join(failed)} {failed.length > 1 ? "n'ont" : "n'a"} pas répondu.
          </p>
          <p className="text-sm text-fg">
            {lastFullCheckAt ? (
              <>
                Les statuts datent de la dernière vérification complète, <RelativeTime date={lastFullCheckAt} />.
              </>
            ) : (
              "Aucune vérification complète pour l'instant : les statuts peuvent être incomplets."
            )}
          </p>
        </div>
        <Button size="sm" onClick={retry} className="max-md:w-full">
          <IconRefresh size={14} /> Réessayer
        </Button>
      </div>
    );
  }
  return (
    <p className="flex min-h-6 flex-wrap items-center gap-x-1.5 text-sm text-fg-muted">
      {lastCheckAt ? (
        <>
          <IconCheck size={14} className="text-ok" />
          <span>
            Vérifié <RelativeTime date={lastCheckAt} />
          </span>
        </>
      ) : (
        <span>Pas encore vérifié</span>
      )}
      <span aria-hidden>·</span>
      <span>{sources.join(", ")}</span>
    </p>
  );
}
