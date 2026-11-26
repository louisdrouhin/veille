"use client";

import { useEffect } from "react";
import { markAboutSeen } from "./settings-nav";

/** Visiting À propos clears its « Nouveau » badge until the next update (docs/design/3.5 § 7). */
export function AboutSeen({ version }: { version: string }) {
  useEffect(() => markAboutSeen(version), [version]);
  return null;
}
