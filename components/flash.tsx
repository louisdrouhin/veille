/** Feedback message passed through the query string after a server action redirect. */
export function Flash({ ok, error }: { ok?: string | string[]; error?: string | string[] }) {
  const okMsg = typeof ok === "string" ? ok : undefined;
  const errMsg = typeof error === "string" ? error : undefined;
  if (!okMsg && !errMsg) return null;
  return (
    <p
      role={errMsg ? "alert" : "status"}
      className={`mb-3 border px-3 py-2 ${
        errMsg ? "border-danger bg-[#fbe9e6] text-danger" : "border-ok bg-[#e8f4e8] text-ok"
      }`}
    >
      {errMsg ?? okMsg}
    </p>
  );
}

export function flashUrl(path: string, kind: "ok" | "error", message: string, hash = "") {
  return `${path}?${new URLSearchParams({ [kind]: message })}${hash}`;
}
