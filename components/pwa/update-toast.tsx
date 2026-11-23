"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { IconRefresh } from "@/components/ui/icons";
import { applyUpdate, useWaitingUpdate } from "@/lib/pwa/client";

/** « Nouvelle version disponible » once a new service worker is waiting. Reloads only on request. */
export function UpdateToast() {
  const waiting = useWaitingUpdate();
  const [reloading, setReloading] = useState(false);
  if (!waiting) return null;
  return (
    <div role="status" className="pointer-events-auto flex items-center gap-2.5 rounded-md border border-line bg-surface p-3 shadow-md">
      <span className="inline-flex size-5.5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <IconRefresh size={14} />
      </span>
      <p className="min-w-0 flex-1 text-base font-semibold">Nouvelle version disponible</p>
      <button
        type="button"
        className={buttonClass("primary", "sm")}
        disabled={reloading}
        onClick={() => {
          setReloading(true);
          applyUpdate();
        }}
      >
        {reloading ? "Rechargement…" : "Recharger"}
      </button>
    </div>
  );
}
