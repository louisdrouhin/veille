"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
type View = { zoom: number; x: number; y: number };
export type CropResult = { large: Blob; small: Blob };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Canvas → Blob: WebP when the browser can encode it (Safari iOS cannot: it gives PNG), else JPEG. No metadata either way. */
async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  const as = (type: string, q: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, q));
  const webp = await as("image/webp", 0.86);
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await as("image/jpeg", 0.88);
  if (!jpeg) throw new Error("encode");
  return jpeg;
}

/**
 * The picture as it will be cropped, drawn from the decoded bitmap (no URL, no <img>): the window and the round
 * previews (96 and 32 px) at their own size, sharp on retina screens.
 */
function CropCanvas({ bitmap, view, viewport, size }: { bitmap: ImageBitmap; view: View; viewport: number; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const k = (size / viewport) * dpr;
    const scale = (viewport / Math.min(bitmap.width, bitmap.height)) * view.zoom * k;
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, view.x * k, view.y * k, bitmap.width * scale, bitmap.height * scale);
  }, [bitmap, view, viewport, size]);
  return <canvas ref={ref} aria-hidden style={{ width: size, height: size }} className="pointer-events-none absolute top-0 left-0" />;
}

/** The square crop, drawn at 512 then 64 px (docs/design/3.5 § 5). */
export async function renderCrop(img: CanvasImageSource & { width: number; height: number }, view: View, viewport: number): Promise<CropResult> {
  const scale = (viewport / Math.min(img.width, img.height)) * view.zoom;
  const side = viewport / scale;
  const sx = -view.x / scale;
  const sy = -view.y / scale;
  const large = document.createElement("canvas");
  large.width = large.height = 512;
  const lc = large.getContext("2d")!;
  lc.imageSmoothingQuality = "high";
  lc.drawImage(img, sx, sy, side, side, 0, 0, 512, 512);
  const small = document.createElement("canvas");
  small.width = small.height = 64;
  const sc = small.getContext("2d")!;
  sc.imageSmoothingQuality = "high";
  sc.drawImage(large, 0, 0, 512, 512, 0, 0, 64, 64);
  const l = await encode(large);
  // Both in the same format (the server checks it).
  const s = l.type === "image/webp" ? await encode(small) : await new Promise<Blob>((r, j) => small.toBlob((b) => (b ? r(b) : j(new Error("encode"))), "image/jpeg", 0.9));
  return { large: l, small: s };
}

/**
 * Crop window (docs/design/3.5 § 5, § 8): role="dialog" aria-modal (native <dialog>: focus trapped, Échap closes).
 * Drag to move, wheel / pinch / slider to zoom, arrows to move and + / − to zoom with the keyboard. Round previews at
 * 96 and 32 px. Mobile: full screen, « Annuler » and « Enregistrer » in the bar.
 */
export function PhotoCropDialog({ bitmap, onCancel, onSave }: { bitmap: ImageBitmap; onCancel: () => void; onSave: (r: CropResult) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const sizeOf = () => (typeof window === "undefined" ? 300 : Math.min(320, window.innerWidth - 48));
  /** The picture centered, zoom 1 (it covers the square window). */
  const centered = (vp: number): View => {
    const s0 = vp / Math.min(bitmap.width, bitmap.height);
    return { zoom: 1, x: (vp - bitmap.width * s0) / 2, y: (vp - bitmap.height * s0) / 2 };
  };
  const [viewport, setViewport] = useState(sizeOf);
  const [view, setView] = useState<View>(() => centered(sizeOf()));
  const [saving, setSaving] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const titleId = useId();
  const helpId = useId();

  const base = viewport / Math.min(bitmap.width, bitmap.height);
  const fit = useCallback(
    (v: View): View => {
      const zoom = clamp(v.zoom, MIN_ZOOM, MAX_ZOOM);
      const s = base * zoom;
      return { zoom, x: clamp(v.x, viewport - bitmap.width * s, 0), y: clamp(v.y, viewport - bitmap.height * s, 0) };
    },
    [base, viewport, bitmap.width, bitmap.height],
  );
  /** Zoom keeping the center of the window in place. */
  const zoomTo = useCallback(
    (zoom: number) =>
      setView((v) => {
        const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
        const c = viewport / 2;
        const k = z / v.zoom;
        return fit({ zoom: z, x: c - (c - v.x) * k, y: c - (c - v.y) * k });
      }),
    [fit, viewport],
  );

  useEffect(() => {
    ref.current?.showModal();
    // A new window size (rotation of the phone): the crop starts again, centered.
    const resize = () => {
      const vp = sizeOf();
      setViewport(vp);
      setView(centered(vp));
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, at opening
  }, []);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => {
        const z = clamp(v.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), MIN_ZOOM, MAX_ZOOM);
        const c = viewport / 2;
        const k = z / v.zoom;
        return fit({ zoom: z, x: c - (c - v.x) * k, y: c - (c - v.y) * k });
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [fit, viewport]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom: view.zoom };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      zoomTo((pinch.current.zoom * Math.hypot(a!.x - b!.x, a!.y - b!.y)) / pinch.current.dist);
    } else if (pointers.current.size === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      setView((v) => fit({ ...v, x: v.x + dx, y: v.y + dy }));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key]!;
      setView((v) => fit({ ...v, x: v.x + dx, y: v.y + dy }));
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomTo(view.zoom + 0.1);
    } else if (e.key === "-" || e.key === "−") {
      e.preventDefault();
      zoomTo(view.zoom - 0.1);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      onSave(await renderCrop(bitmap, view, viewport));
    } finally {
      setSaving(false);
    }
  };

  const picture = (size: number) => <CropCanvas bitmap={bitmap} view={view} viewport={viewport} size={size} />;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(440px,calc(100vw-24px))] rounded-lg border border-line bg-surface p-0 text-fg shadow-md backdrop:bg-black/60 max-md:h-dvh max-md:max-h-none max-md:w-screen max-md:max-w-none max-md:rounded-none max-md:border-0"
    >
      <div className="flex h-full flex-col">
        <div className="flex min-h-13 items-center gap-2 border-b border-line px-2 md:px-4">
          <button type="button" onClick={onCancel} className="inline-flex min-h-11 cursor-pointer items-center px-2 text-base font-semibold text-accent md:hidden">
            Annuler
          </button>
          <h2 id={titleId} className="flex-1 text-center text-md font-semibold md:text-left">
            Recadrer la photo
          </h2>
          <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex min-h-11 cursor-pointer items-center px-2 text-base font-bold text-accent md:hidden">
            Enregistrer
          </button>
        </div>
        <div className="flex flex-1 flex-col items-center gap-4 overflow-auto p-4">
          <div
            ref={areaRef}
            tabIndex={0}
            role="group"
            aria-label="Zone de recadrage"
            aria-describedby={helpId}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
            style={{ width: viewport, height: viewport }}
            className="relative shrink-0 cursor-grab touch-none overflow-hidden rounded-sm bg-black outline-offset-2 focus-visible:outline-2 focus-visible:outline-focus active:cursor-grabbing"
          >
            {picture(viewport)}
            <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,.45)]" />
          </div>
          <p id={helpId} className="text-center text-sm text-fg-muted">
            Glisse pour déplacer, molette ou pincement pour zoomer. Au clavier : flèches pour déplacer, + et − pour zoomer.
          </p>
          <label className="flex w-full max-w-[320px] items-center gap-3 text-sm font-semibold">
            Zoom
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={view.zoom}
              aria-valuetext={`${Math.round(view.zoom * 100)} %`}
              onChange={(e) => zoomTo(Number(e.target.value))}
              className="h-11 flex-1 accent-[var(--accent)] md:h-6"
            />
          </label>
          <div className="flex items-end gap-4" aria-label="Aperçu">
            {[96, 32].map((size) => (
              <span key={size} style={{ width: size, height: size }} className="relative inline-block overflow-hidden rounded-full border border-line bg-black">
                {picture(size)}
              </span>
            ))}
          </div>
        </div>
        <div className="hidden justify-end gap-2 border-t border-line p-3 md:flex">
          <button type="button" onClick={onCancel} className={buttonClass("secondary", "md")}>
            Annuler
          </button>
          <button type="button" onClick={() => void save()} disabled={saving} className={buttonClass("primary", "md")}>
            {saving ? "Préparation…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
