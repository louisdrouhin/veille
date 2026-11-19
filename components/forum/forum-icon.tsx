import type { ForumIconName } from "@/lib/db/schema";

export const FORUM_ICON_LABELS: Record<ForumIconName, string> = {
  sec: "Sécurité",
  ops: "DevOps",
  lab: "Homelab",
  news: "Actu",
  web: "Web",
};

const PATHS: Record<ForumIconName, React.ReactNode> = {
  // shield with check
  sec: (
    <>
      <path d="M10 2.5l6 2.2v4.6c0 3.8-2.6 6.8-6 8.2-3.4-1.4-6-4.4-6-8.2V4.7z" />
      <path d="M7.3 10l1.9 1.9 3.6-3.8" />
    </>
  ),
  // infinity loop (CI/CD)
  ops: <path d="M6.2 7c-1.8 0-3.2 1.3-3.2 3s1.4 3 3.2 3c3 0 4.6-6 7.6-6 1.8 0 3.2 1.3 3.2 3s-1.4 3-3.2 3c-3 0-4.6-6-7.6-6z" />,
  // server rack
  lab: (
    <>
      <rect x="3.5" y="3.5" width="13" height="5" rx="1" />
      <rect x="3.5" y="11.5" width="13" height="5" rx="1" />
      <path d="M6.5 6h.01M6.5 14h.01" strokeWidth={2.2} />
      <path d="M10 6h3.5M10 14h3.5" />
    </>
  ),
  // newspaper
  news: (
    <>
      <path d="M3.5 4.5h10v11h-8a2 2 0 0 1-2-2z" />
      <path d="M13.5 7.5h3v6a2 2 0 0 1-2 2h-1" />
      <path d="M6 7.5h5M6 10h5M6 12.5h3" />
    </>
  ),
  // globe
  web: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M3.5 10h13M10 3.5c1.8 1.8 2.7 4 2.7 6.5s-.9 4.7-2.7 6.5c-1.8-1.8-2.7-4-2.7-6.5s.9-4.7 2.7-6.5z" />
    </>
  ),
};

export function ForumIcon({ icon, size = 20 }: { icon: ForumIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[icon]}
    </svg>
  );
}

/** 36 px tile: accent when the forum has unread topics. */
export function ForumIconTile({ icon, active }: { icon: ForumIconName; active: boolean }) {
  return (
    <span
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-md ${
        active ? "bg-accent-soft text-accent" : "bg-off-soft text-fg-muted"
      }`}
    >
      <ForumIcon icon={icon} />
    </span>
  );
}
