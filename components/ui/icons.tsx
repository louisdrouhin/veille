/** Inline SVG icon set (stroke icons, 16 px grid). Decorative by default (aria-hidden). */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 8.5l3 3 6-7" />
  </Svg>
);
export const IconCheckDouble = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.5 8.5l3 3 6-7" />
    <path d="M8.5 10.5l1 1 5.5-7" />
  </Svg>
);
export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3.5L10.5 8 6 12.5" />
  </Svg>
);
export const IconMore = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeWidth={2.5} />
  </Svg>
);
export const IconClipboard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="2.75" width="9" height="11.5" rx="1.25" />
    <path d="M6 2.75V2.5c0-.55.45-1 1-1h2c.55 0 1 .45 1 1v.25M6 7h4M6 9.75h4" />
  </Svg>
);
export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 6l4.5 4.5L12.5 6" />
  </Svg>
);
export const IconFolder = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.75 4.25c0-.55.45-1 1-1h3.1l1.4 1.5h6c.55 0 1 .45 1 1v6.5c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1z" />
  </Svg>
);
export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2.1" />
    <path d="M8 1.75v1.6M8 12.65v1.6M14.25 8h-1.6M3.35 8h-1.6M12.42 3.58l-1.13 1.13M4.71 11.29l-1.13 1.13M12.42 12.42l-1.13-1.13M4.71 4.71L3.58 3.58" />
  </Svg>
);
export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 4.5v4.5" />
    <path d="M8 11.5v.01" strokeWidth={2} />
  </Svg>
);
export const IconAlertCircle = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M8 5v3.5" />
    <path d="M8 10.75v.01" strokeWidth={2} />
  </Svg>
);
export const IconPause = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 4v8M10 4v8" />
  </Svg>
);
export const IconBan = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M4.2 11.8l7.6-7.6" />
  </Svg>
);
export const IconClock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5v3l2 1.5" />
  </Svg>
);
export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 3.5v3h-3" />
    <path d="M12.6 6.5A5 5 0 1 0 13 9.5" />
  </Svg>
);
export const IconPower = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2.5v5" />
    <path d="M4.6 4.6a5 5 0 1 0 6.8 0" />
  </Svg>
);
export const IconPencil = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.5 3l2.5 2.5L6 12.5H3.5V10z" />
  </Svg>
);
export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </Svg>
);
export const IconArrowUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Svg>
);
export const IconArrowLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 8H3M7 4L3 8l4 4" />
  </Svg>
);
export const IconArrowDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3v10M4 9l4 4 4-4" />
  </Svg>
);
export const IconGrip = (p: IconProps) => (
  <Svg {...p} stroke="none" fill="currentColor">
    {[4, 8, 12].map((y) => (
      <g key={y}>
        <circle cx="6" cy={y} r="1.1" />
        <circle cx="10" cy={y} r="1.1" />
      </g>
    ))}
  </Svg>
);
export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);
export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);
/** Four-point sparkle: the mark of generated content (filled: the « Généré par IA » chips). */
export const IconSparkle = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <Svg {...p}>
    <path
      d="M8 1.75c.35 2.9 1.35 3.9 4.25 4.25-2.9.35-3.9 1.35-4.25 4.25C7.65 7.35 6.65 6.35 3.75 6 6.65 5.65 7.65 4.65 8 1.75z"
      fill={filled ? "currentColor" : "none"}
    />
    <path d="M12.5 10.5v3M11 12h3" />
  </Svg>
);
/** « A / 文 »: translate. */
export const IconTranslate = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.75 3.5h6.5M5 2v1.5M3 3.5c.6 2.4 2.1 4.2 4.5 5.3M7 3.5C6.4 5.9 4.9 7.7 2.5 8.8" />
    <path d="M8.75 14l2.75-6.5L14.25 14M9.6 12h3.8" />
  </Svg>
);
/** Loading indicator in place of an icon (the rotation stops with « reduce motion »). */
export const IconSpinner = (p: IconProps) => (
  <Svg {...p} className={`animate-spin motion-reduce:animate-none ${p.className ?? ""}`}>
    <path d="M8 2a6 6 0 1 0 6 6" />
  </Svg>
);
export const IconMenu = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
  </Svg>
);
export const IconRss = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 7a5.5 5.5 0 0 1 5.5 5.5M3.5 3.5a9 9 0 0 1 9 9" />
    <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconNote = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 2.5h6l3 3v8h-9z" />
    <path d="M5.5 8h5M5.5 10.5h3.5" />
  </Svg>
);
export const IconChat = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 3.5h11v7H7l-3 2.5v-2.5H2.5z" />
  </Svg>
);
export const IconRepost = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6.5V5h8.5M9.5 3l2 2-2 2M13 9.5V11H4.5M6.5 13l-2-2 2-2" />
  </Svg>
);
export const IconLogout = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 3H3.5v10h3M10 5l3 3-3 3M13 8H6.5" />
  </Svg>
);

/** iOS « Partager » glyph: a box with an arrow going up. */
export const IconShare = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2v8M5.5 4.5L8 2l2.5 2.5M5.5 7H4v7h8V7h-1.5" />
  </Svg>
);
export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2.5v7.5M5 7l3 3 3-3M3 12.5v1h10v-1" />
  </Svg>
);

/** App logo: a folder with a signal wave — 26 px in the header, 44 px tile on the login page. */
export function Logo({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true" focusable="false" className={className}>
      <rect width="26" height="26" rx="5" fill="var(--bar-accent)" />
      <path
        d="M5 9c0-.83.67-1.5 1.5-1.5h4.1c.4 0 .78.16 1.06.44L13 9.25h6.5c.83 0 1.5.67 1.5 1.5V18.5c0 .83-.67 1.5-1.5 1.5h-13c-.83 0-1.5-.67-1.5-1.5z"
        fill="var(--bar)"
      />
      <path d="M8.5 16.5a4 4 0 0 1 4-4M8.5 13.75a1.25 1.25 0 0 1 1.25-1.25" stroke="var(--bar-accent)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <circle cx="9" cy="16" r="1" fill="var(--bar-accent)" />
    </svg>
  );
}

/** Ma stack (3.0): shield, in the header and the home block. */
export const IconShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 1.75l5 1.9v3.85c0 3.15-2.1 5.6-5 6.75-2.9-1.15-5-3.6-5-6.75V3.65z" />
  </Svg>
);
export const IconShieldCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 1.75l5 1.9v3.85c0 3.15-2.1 5.6-5 6.75-2.9-1.15-5-3.6-5-6.75V3.65z" />
    <path d="M5.75 8.1l1.6 1.6 3-3.2" />
  </Svg>
);
/** « Exploitée »: warning triangle. */
export const IconTriangle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2.25l6.25 11H1.75z" />
    <path d="M8 6.5v3" />
    <path d="M8 11.4v.01" strokeWidth={2} />
  </Svg>
);
export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5l3.25 3.25" />
  </Svg>
);
export const IconBell = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 11.25V7a4 4 0 0 1 8 0v4.25l1.25 1.25H2.75z" />
    <path d="M6.5 14a1.6 1.6 0 0 0 3 0" />
  </Svg>
);
export const IconExternal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 2.75h3.75V6.5M13.25 2.75L7.5 8.5" />
    <path d="M11.5 9.5v3.25a.5.5 0 0 1-.5.5H3.25a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5H6.5" />
  </Svg>
);
