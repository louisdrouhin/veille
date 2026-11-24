"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { TOAST_PARAMS, type ToastData, type ToastKind } from "@/lib/toast";
import { onToast, type ClientToast } from "@/lib/toast-client";
import { IconAlert, IconCheck, IconClose } from "./icons";

type Item = ClientToast & { id: number };

function readToast(params: URLSearchParams): ToastData | null {
  const kind = params.get("toast") as ToastKind | null;
  const title = params.get("title");
  if (!title || (kind !== "ok" && kind !== "error")) return null;
  return { kind, title, msg: params.get("msg") ?? undefined, ctx: params.get("ctx") ?? undefined };
}

/**
 * Reads toast params left by a server action redirect, shows them, then strips them from the URL.
 * `children`: other toasts sharing the stack (e.g. the « Nouvelle version disponible » one).
 */
export function Toaster({ children }: { children?: React.ReactNode }) {
  const searchParams = useSearchParams();
  const [items, setItems] = useState<Item[]>([]);
  const [seenQuery, setSeenQuery] = useState<string | null>(null);

  // New query string: pick up its toast during render (no setState in an effect).
  const query = searchParams.toString();
  if (query !== seenQuery) {
    setSeenQuery(query);
    const toast = readToast(searchParams);
    if (toast) setItems((prev) => [...prev, { ...toast, id: (prev.at(-1)?.id ?? 0) + 1 }]);
  }

  // Side effect only: clean the URL without a navigation (a reload must not replay the toast).
  useEffect(() => {
    if (!readToast(new URLSearchParams(query))) return;
    const url = new URL(window.location.href);
    TOAST_PARAMS.forEach((p) => url.searchParams.delete(p));
    window.history.replaceState(window.history.state, "", url);
  }, [query]);

  const dismiss = useCallback((id: number) => setItems((prev) => prev.filter((t) => t.id !== id)), []);

  // Toasts raised in the browser (lib/toast-client.ts).
  useEffect(() => onToast((toast) => setItems((prev) => [...prev, { ...toast, id: (prev.at(-1)?.id ?? 0) + 1 }])), []);

  return (
    // Mobile: full width minus 10 px, 8 px above the iPhone home indicator (docs/design/v2 § 5).
    <div className="pointer-events-none fixed inset-x-[5px] bottom-[calc(env(safe-area-inset-bottom)+8px)] z-50 flex flex-col gap-2 md:inset-x-auto md:right-6 md:bottom-6 md:w-[340px]">
      {children}
      {items.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function Toast({ toast, onDismiss }: { toast: Item; onDismiss: (id: number) => void }) {
  const isError = toast.kind === "error";
  const { id } = toast;

  useEffect(() => {
    if (isError) return; // errors stay until dismissed
    const timer = setTimeout(() => onDismiss(id), 5000);
    return () => clearTimeout(timer);
  }, [isError, id, onDismiss]);

  return (
    <div
      role={isError ? "alert" : "status"}
      className={`pointer-events-auto flex items-start gap-2.5 rounded-md border bg-surface p-3 shadow-md ${
        isError ? "border-err" : "border-line"
      }`}
    >
      <span
        className={`inline-flex size-5.5 shrink-0 items-center justify-center rounded-full ${
          isError ? "bg-err-soft text-err" : "bg-ok-soft text-ok"
        }`}
      >
        {isError ? <IconAlert size={14} /> : <IconCheck size={14} />}
      </span>
      <div className="min-w-0 flex-1 text-base">
        <p className="break-words">
          <strong className="font-semibold">{toast.title}</strong>
          {toast.msg && <> {toast.msg}</>}
        </p>
        {toast.ctx && <p className="mt-0.5 truncate text-sm text-fg-muted">{toast.ctx}</p>}
      </div>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            onDismiss(id);
          }}
          className="-my-2.5 inline-flex h-11 shrink-0 cursor-pointer items-center rounded-sm px-2.5 text-base font-semibold text-accent hover:bg-surface-hover md:-my-1 md:h-8 md:text-sm"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(id)}
        aria-label="Fermer la notification"
        title="Fermer"
        className="-my-2.5 -mr-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-sm text-fg-muted hover:bg-surface-hover md:my-0 md:mr-0 md:size-6"
      >
        <IconClose size={14} />
      </button>
    </div>
  );
}
