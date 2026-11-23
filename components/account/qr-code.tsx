import { encode } from "uqr";

/**
 * QR code drawn as inline SVG paths (no <img>, no data: URI: the CSP only
 * allows images from our origin). Dark modules on a white quiet zone, whatever
 * the theme, so that authenticator apps can always scan it.
 */
export function QrCode({ value, size = 192, label }: { value: string; size?: number; label: string }) {
  const { data } = encode(value, { ecc: "M", border: 2 });
  const n = data.length;
  let d = "";
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
      className="rounded-sm border border-line"
    >
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
