"use client";

import { useEffect, useRef, useState } from "react";

const SHAPES = {
  square: "rounded-sm",
  round: "rounded-full",
} as const;

/**
 * Source favicon served by /api/favicon/[sourceId] (downloaded by the worker,
 * never fetched from third-party sites by the browser). Falls back to the
 * initial of `name` when there is no icon or it fails to load.
 */
export function SourceAvatar({
  name,
  src,
  size = 16,
  shape = "square",
  className = "",
}: {
  name: string;
  /** Result of faviconUrl(); null → initial. */
  src?: string | null;
  size?: number;
  shape?: keyof typeof SHAPES;
  className?: string;
}) {
  const [failed, setFailed] = useState(!src);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => setFailed(!src), [src]);
  // The error event can fire before hydration: check the image state on mount.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  const initial = (name.trim()[0] ?? "?").toUpperCase();
  const box = `inline-flex shrink-0 items-center justify-center overflow-hidden ${SHAPES[shape]} ${className}`;
  const style = { width: size, height: size };

  if (failed || !src) {
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
        src={src}
        alt=""
        width={size - pad * 2}
        height={size - pad * 2}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
