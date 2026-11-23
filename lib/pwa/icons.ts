import type { Metadata } from "next";

/** The home-screen / touch icon: an opaque 180×180 PNG in public/, at the root name iOS knows. */
export const APPLE_TOUCH_ICON = "/apple-touch-icon.png";

/**
 * <link> icons of every page, in this order (Next.js renders `icon` before `apple`,
 * so everything is in `icon` with its own `rel`): the apple-touch-icon first, then a
 * PNG icon, then the SVG. Plain public files, no ?hash: iOS fetches them without
 * cookies when adding to the home screen (proxy.ts keeps them public) and cannot use
 * an SVG. The PNG icon is the same opaque image, so whichever iOS picks shows the logo.
 */
export const ICONS = {
  icon: [
    { rel: "apple-touch-icon", url: APPLE_TOUCH_ICON, sizes: "180x180", type: "image/png" },
    { url: APPLE_TOUCH_ICON, sizes: "180x180", type: "image/png" },
    { url: "/icon.svg", sizes: "any", type: "image/svg+xml" },
  ],
} satisfies Metadata["icons"];
