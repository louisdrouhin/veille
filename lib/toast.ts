/**
 * Toasts survive a server-action redirect through the query string:
 * ?toast=ok|error&title=…&msg=…&ctx=…  — read and stripped by <Toaster/>.
 */
export type ToastKind = "ok" | "error";
export type ToastData = { kind: ToastKind; title: string; msg?: string; ctx?: string };

export const TOAST_PARAMS = ["toast", "title", "msg", "ctx"] as const;

export function toastUrl(path: string, toast: ToastData, hash = ""): string {
  const params = new URLSearchParams({ toast: toast.kind, title: toast.title });
  if (toast.msg) params.set("msg", toast.msg);
  if (toast.ctx) params.set("ctx", toast.ctx);
  const [base, existing] = path.split("?");
  const merged = new URLSearchParams(existing);
  params.forEach((v, k) => merged.set(k, v));
  return `${base}?${merged}${hash}`;
}
