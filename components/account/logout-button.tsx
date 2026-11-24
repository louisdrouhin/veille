"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { IconLogout } from "@/components/ui/icons";
import { authClient } from "@/lib/auth-client";
import { clearOfflineData } from "@/lib/pwa/client";

/** Signs out after deleting the service worker's caches: pages saved offline must not outlive the session. */
export function LogoutButton({ className, label = "Se déconnecter" }: { className: string; label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className={className}
      onClick={() =>
        startTransition(async () => {
          await clearOfflineData();
          await authClient.signOut();
          router.replace("/login");
          router.refresh();
        })
      }
    >
      <IconLogout size={14} />
      {pending ? "Déconnexion…" : label}
    </button>
  );
}
