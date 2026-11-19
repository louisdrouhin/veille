"use client";

import { useEffect, useRef, useState } from "react";

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

const SHAPES = {
  square: "rounded-sm",
  round: "rounded-full",
} as const;

/**
 * Favicon of a site (`https://host/favicon.ico`), falling back to the initial
 * of `name` when it is missing or fails to load.
 */
export function SourceAvatar({
  name,
  url,
  size = 16,
  shape = "square",
  className = "",
}: {
  name: string;
  url?: string | null;
  size?: number;
  shape?: keyof typeof SHAPES;
  className?: string;
}) {
  const host = hostOf(url);
  const [failed, setFailed] = useState(!host);
  const imgRef = useRef<HTMLImageElement>(null);

  // The error event can fire before hydration: check the image state on mount.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  const initial = (name.trim()[0] ?? "?").toUpperCase();
  const box = `inline-flex shrink-0 items-center justify-center overflow-hidden ${SHAPES[shape]} ${className}`;
  const style = { width: size, height: size };

  if (failed || !host) {
    return (
      <span
        aria-hidden="true"
        style={{ ...style, fontSize: Math.max(9, Math.round(size * 0.55)) }}
        className={`${box} bg-off-soft font-cond font-bold text-fg-muted`}
      >
        {initial}
      </span>
    );
  }

  // Bigger avatars keep a tile around the favicon.
  const pad = size >= 32 ? Math.round(size * 0.22) : 0;
  return (
    <span aria-hidden="true" style={style} className={`${box} ${pad ? "border border-line bg-surface" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={`https://${host}/favicon.ico`}
        alt=""
        width={size - pad * 2}
        height={size - pad * 2}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
