"use client";

import { useEffect } from "react";
import { clearOfflineData } from "@/lib/pwa/client";

/**
 * On the login page: whatever brought us here (logout, expired session), pages
 * and images saved for offline reading are deleted. Renders nothing.
 */
export function ClearOfflineData() {
  useEffect(() => void clearOfflineData(), []);
  return null;
}
