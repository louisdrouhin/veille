/** Round initial of the account name (no picture: single-user app). Decorative: the name is next to it. */
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-bar-accent font-cond font-bold text-bar ${
        size === "sm" ? "size-6 text-sm" : "size-11 text-lg"
      }`}
    >
      {initial}
    </span>
  );
}
