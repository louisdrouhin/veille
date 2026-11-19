"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { TOAST_PARAMS, type ToastData, type ToastKind } from "@/lib/toast";
import { IconAlert, IconCheck, IconClose } from "./icons";

type Item = ToastData & { id: number };

function readToast(params: URLSearchParams): ToastData | null {
  const kind = params.get("toast") as ToastKind | null;
  const title = params.get("title");
  if (!title || (kind !== "ok" && kind !== "error")) return null;
  return { kind, title, msg: params.get("msg") ?? undefined, ctx: params.get("ctx") ?? undefined };
}

/** Reads toast params left by a server action redirect, shows them, then strips them from the URL. */
export function Toaster() {
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

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col gap-2 md:inset-x-auto md:right-6 md:bottom-6 md:w-[340px]">
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
      <button
        type="button"
        onClick={() => onDismiss(id)}
        aria-label="Fermer la notification"
        title="Fermer"
        className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-fg-muted hover:bg-surface-hover"
      >
        <IconClose size={14} />
      </button>
    </div>
  );
}
