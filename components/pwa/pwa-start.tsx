"use client";

import { useEffect } from "react";
import { startPwa } from "@/lib/pwa/client";

/** Registers the service worker and listens for the install prompt (root layout). Renders nothing. */
export function PwaStart() {
  useEffect(() => startPwa(), []);
  return null;
}
