"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button, LinkButton } from "@/components/ui/button";
import { IconSparkle, IconSun } from "@/components/ui/icons";
import { enableBriefingAction, previewBriefingAction } from "@/lib/actions/briefing";
import { hasPushApi, subscribeThisDevice } from "@/lib/pwa/push-subscribe";
import { showToast } from "@/lib/toast-client";

const SECTIONS = [
  ["Ma stack", "les nouvelles failles de tes logiciels, sans IA"],
  ["À la une", "les sujets repris par plusieurs sources, résumés en deux lignes"],
  ["Mes services", "les nouvelles versions des services que tu suis"],
  ["Le reste en bref", "quelques sujets notables, une ligne chacun"],
] as const;

/**
 * « Première fois » (docs/design/3.4 § 6): first opening after the update, or briefing off. « Activer » asks the
 * notification permission when needed (inside the tap, for iOS); « Voir un aperçu d'abord » makes one now, silently.
 */
export function BriefingIntro({ publicKey, latestDay }: { publicKey: string | null; latestDay: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const enable = () =>
    start(async () => {
      if (publicKey && hasPushApi() && Notification.permission === "default") {
        const sub = await subscribeThisDevice(publicKey);
        if (!sub.ok && sub.error) showToast({ kind: "error", title: "Notifications :", msg: sub.error });
      }
      const res = await enableBriefingAction().catch(() => ({ ok: false as const, error: "Connexion au serveur impossible." }));
      if (!res.ok) return showToast({ kind: "error", title: "Briefing :", msg: res.error });
      showToast({ kind: "ok", title: "Briefing activé", msg: res.next ? `Prochain : ${res.next}.` : undefined });
      router.push(latestDay ? `/briefing/${latestDay}` : "/parametres/briefing");
    });

  const preview = () =>
    start(async () => {
      const res = await previewBriefingAction().catch(() => ({ ok: false as const, error: "Connexion au serveur impossible." }));
      if (!res.ok) return showToast({ kind: "error", title: "Aperçu :", msg: res.error });
      router.push(`/briefing/${res.day}`);
    });

  return (
    <section aria-labelledby="briefing-intro" className="mx-auto flex max-w-[640px] flex-col gap-4 rounded-md border border-line border-l-4 border-l-accent bg-surface p-5 shadow-sm">
      <p className="inline-flex items-center gap-1.5 font-cond text-sm font-bold tracking-caps text-accent uppercase">
        <IconSun size={16} /> Nouveau dans Folders 3.4
      </p>
      <h1 id="briefing-intro" className="font-cond text-2xl font-bold">
        Ta veille en 2 minutes, chaque matin
      </h1>
      <p className="text-base">À l&apos;heure que tu choisis, Folders prépare une synthèse de ce qui est arrivé depuis la veille et t&apos;envoie une notification.</p>
      <ul className="grid gap-1.5 text-base">
        {SECTIONS.map(([title, text]) => (
          <li key={title}>
            <strong>{title}</strong> : {text}.
          </li>
        ))}
      </ul>
      <p className="flex items-start gap-1.5 text-sm text-fg-muted">
        <IconSparkle size={14} className="mt-0.5 shrink-0" />
        Les phrases sont rédigées par l&apos;IA à partir des titres et extraits des articles seulement : ni Ma stack ni tes notes ne lui sont envoyées.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={enable} disabled={pending} className="max-md:min-h-11 max-md:w-full">
          Activer : 7:00, du lundi au vendredi
        </Button>
        <LinkButton href="/parametres/briefing" className="max-md:min-h-11 max-md:w-full">
          Choisir l&apos;heure et le contenu
        </LinkButton>
        <Button onClick={preview} disabled={pending} className="max-md:min-h-11 max-md:w-full">
          Voir un aperçu d&apos;abord
        </Button>
      </div>
      {latestDay && (
        <p className="text-sm">
          <Link href={`/briefing/${latestDay}`} prefetch={false}>
            Ouvrir le dernier briefing
          </Link>
        </p>
      )}
    </section>
  );
}
