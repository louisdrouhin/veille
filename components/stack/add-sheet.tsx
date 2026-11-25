"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { IconArrowLeft, IconChevronRight, IconSearch, IconSpinner } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
import {
  addStackItemAction,
  adoptCpeAction,
  prepareProductAction,
  searchNvdAction,
  searchProductsAction,
  type ProductInfo,
} from "@/lib/actions/stack";
import type { StackContext } from "@/lib/db/schema";
import { CONTEXT_LABEL } from "@/lib/stack/labels";
import type { CatalogResult } from "@/lib/stack/queries";
import type { CpeCandidate } from "@/lib/stack/sources/nvd";
import { showToast } from "@/lib/toast-client";
import { ContextField, VersionCheck, VersionField } from "./version-field";

/** The match in bold yellow (<mark>, bg-saved-soft), the rest as is. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  const i = q ? text.toLocaleLowerCase("fr").indexOf(q.toLocaleLowerCase("fr")) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[2px] bg-saved-soft px-px text-fg">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

type Step = { kind: "search" } | { kind: "product"; product: ProductInfo | null; productId: number; name: string; taken: StackContext[] } | { kind: "custom" };

/**
 * « Ajouter un logiciel » (docs/design/3.0 § 4.2): step 1, search the catalog (or the NVD
 * dictionary); step 2, version and context with the immediate check, then « Ajouter à ma stack ».
 * « Introuvable ? » adds it « suivi par nom », without automatic match.
 */
export function AddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "search" });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogResult[] | null>(null);
  const [nvd, setNvd] = useState<{ state: "idle" | "loading" | "done"; list: CpeCandidate[]; error?: string }>({ state: "idle", list: [] });
  const [version, setVersion] = useState("");
  const [context, setContext] = useState<StackContext>("homelab");
  const [customName, setCustomName] = useState("");
  const [distro, setDistro] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const searchId = useId();
  const nameId = useId();
  const distroId = useId();

  // Reset when closed.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setStep({ kind: "search" });
      setQuery("");
      setVersion("");
      setCustomName("");
      setDistro("");
      setError(null);
      setNvd({ state: "idle", list: [] });
    }
  }

  useEffect(() => {
    if (!open || step.kind !== "search") return;
    let alive = true;
    const t = setTimeout(() => {
      searchProductsAction(query)
        .then((r) => alive && setResults(r))
        .catch(() => {});
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, query, step.kind]);

  async function choose(productId: number, name: string, taken: StackContext[]) {
    setError(null);
    const free = (["homelab", "work"] as const).find((c) => !taken.includes(c)) ?? "homelab";
    setContext(free);
    setStep({ kind: "product", product: null, productId, name, taken });
    const res = await prepareProductAction(productId);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setStep((s) => (s.kind === "product" && s.productId === productId ? { ...s, product: res.product } : s));
  }

  async function chooseNvd(c: CpeCandidate) {
    const res = await adoptCpeAction(c);
    if (!res.ok) return setError(res.error);
    await choose(res.productId, c.name, []);
  }

  const searchNvd = async () => {
    setNvd({ state: "loading", list: [] });
    const res = await searchNvdAction(query);
    setNvd(res.ok ? { state: "done", list: res.candidates } : { state: "done", list: [], error: res.error });
  };

  const submit = () =>
    startSave(async () => {
      setError(null);
      const res = await addStackItemAction({
        ...(step.kind === "product" ? { productId: step.productId } : { customName }),
        version,
        context,
        distroPackage: distro,
      });
      if (!res.ok) return setError(res.error);
      onClose();
      showToast({
        kind: "ok",
        title: `${res.name} ajouté à ta stack`,
        msg: res.alerts ? `${res.alerts} alerte${res.alerts > 1 ? "s" : ""} à traiter.` : undefined,
      });
      router.refresh();
    });

  return (
    <Sheet open={open} onClose={onClose} title={step.kind === "search" ? "Ajouter un logiciel" : step.kind === "custom" ? "Suivi par nom" : step.name} wide>
      {step.kind === "search" ? (
        <div className="grid gap-3 pb-2">
          <label htmlFor={searchId} className="sr-only">
            Rechercher un logiciel
          </label>
          <div className="relative">
            <IconSearch size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" />
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setNvd({ state: "idle", list: [] });
              }}
              placeholder="Nom ou éditeur (ex. Proxmox)"
              autoComplete="off"
              autoFocus
              className="h-11 w-full rounded-sm border border-line-strong bg-surface pr-3 pl-9 text-base text-fg"
            />
          </div>
          {results === null ? (
            <p className="text-sm text-fg-muted">Chargement…</p>
          ) : (
            <ul className="-mx-1 grid" aria-label="Catalogue">
              {results.map((r) => {
                const taken = r.inStack.map((i) => i.context);
                const full = taken.length >= 2;
                const inStack = r.inStack.map((i) => `${i.version}${r.inStack.length > 1 || !full ? ` (${CONTEXT_LABEL[i.context]})` : ""}`).join(", ");
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      disabled={full}
                      aria-label={`${r.name} · ${r.vendor}, ${inStack ? `déjà dans ta stack : ${inStack}` : `suivi : ${r.sources.join(", ")}`}`}
                      onClick={() => choose(r.id, r.name, taken)}
                      className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-sm px-1 py-2 text-left hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">
                          <Highlight text={r.name} query={query} />
                          <span className="font-normal text-fg-muted">
                            {" "}
                            · <Highlight text={r.vendor} query={query} />
                          </span>
                        </span>
                        <span className="block text-sm text-fg-muted">
                          {inStack ? `Déjà dans ta stack · ${inStack}` : `Suivi : ${r.sources.join(", ")}`}
                        </span>
                      </span>
                      {!full && <IconChevronRight size={16} className="shrink-0 text-fg-muted" />}
                    </button>
                  </li>
                );
              })}
              {results.length === 0 && <li className="px-1 py-2 text-sm text-fg-muted">Aucun logiciel du catalogue ne correspond.</li>}
            </ul>
          )}
          {query.trim().length >= 2 && nvd.state === "idle" && (
            <Button variant="secondary" size="md" onClick={searchNvd} className="w-full">
              <IconSearch size={14} /> Chercher « {query.trim()} » dans le dictionnaire NVD
            </Button>
          )}
          {nvd.state === "loading" && (
            <p role="status" className="inline-flex items-center gap-2 text-sm text-fg-muted">
              <IconSpinner size={14} className="animate-spin motion-reduce:animate-none" /> Recherche dans le dictionnaire NVD…
            </p>
          )}
          {nvd.state === "done" && (
            <section aria-label="Dictionnaire NVD" className="grid gap-1">
              <h3 className="font-cond text-sm font-bold tracking-caps text-fg-muted uppercase">Dictionnaire NVD</h3>
              {nvd.error && <p className="text-sm text-err">{nvd.error}</p>}
              {!nvd.error && nvd.list.length === 0 && <p className="text-sm text-fg-muted">Rien de trouvé.</p>}
              <ul className="-mx-1 grid">
                {nvd.list.map((c) => (
                  <li key={c.cpePrefix}>
                    <button type="button" onClick={() => chooseNvd(c)} className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-sm px-1 py-2 text-left hover:bg-surface-hover">
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">
                          {c.name} <span className="font-normal text-fg-muted">· {c.vendor}</span>
                        </span>
                        <span className="block truncate font-mono text-xs text-fg-muted">{c.cpePrefix}</span>
                      </span>
                      <IconChevronRight size={16} className="shrink-0 text-fg-muted" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {error && <p role="alert" className="text-sm text-err">{error}</p>}
          <button
            type="button"
            onClick={() => {
              setCustomName(query.trim());
              setStep({ kind: "custom" });
            }}
            className="inline-flex min-h-11 cursor-pointer items-center text-left text-base font-medium text-accent hover:underline"
          >
            Introuvable ? L&apos;ajouter quand même (suivi par nom)
          </button>
        </div>
      ) : (
        <form
          className="grid gap-4 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <button
            type="button"
            onClick={() => {
              setStep({ kind: "search" });
              setError(null);
            }}
            className="-ml-1 inline-flex h-11 w-fit cursor-pointer items-center gap-1 rounded-sm px-1 text-base font-medium text-accent hover:bg-surface-hover md:h-8"
          >
            <IconArrowLeft size={14} /> Changer de logiciel
          </button>
          {step.kind === "custom" && (
            <div className="grid gap-1.5">
              <label htmlFor={nameId} className="text-sm font-semibold">
                Nom
              </label>
              <input id={nameId} value={customName} onChange={(e) => setCustomName(e.target.value)} maxLength={80} required className="h-11 rounded-sm border border-line-strong bg-surface px-3 text-base" />
              <p className="text-sm text-fg-muted">Sans correspondance automatique : aucune alerte ne sera créée pour ce logiciel.</p>
            </div>
          )}
          <VersionField
            value={version}
            onChange={setVersion}
            scheme={step.kind === "product" ? (step.product?.scheme ?? "vendor") : "vendor"}
            latest={step.kind === "product" ? step.product?.latestVersion : null}
            recent={step.kind === "product" ? (step.product?.recentVersions ?? []) : []}
            hint={step.kind === "product" ? step.product?.versionHint : null}
            autoFocus={step.kind === "product"}
          />
          <ContextField value={context} onChange={setContext} disabled={step.kind === "product" ? step.taken : []} />
          {step.kind === "product" && <VersionCheck productId={step.productId} productName={step.name} version={version} pending={!step.product} />}
          {step.kind === "product" && (
            <div className="grid gap-1.5">
              <label htmlFor={distroId} className="text-sm font-semibold">
                Paquet de distribution <span className="font-normal text-fg-muted">(facultatif)</span>
              </label>
              <input id={distroId} value={distro} onChange={(e) => setDistro(e.target.value)} maxLength={120} placeholder="ex. Debian openssh 1:9.2p1-2+deb12u3" className="h-11 rounded-sm border border-line-strong bg-surface px-3 font-mono text-sm" />
            </div>
          )}
          {error && <p role="alert" className="text-sm text-err">{error}</p>}
          <Button type="submit" variant="primary" disabled={saving || !version.trim() || (step.kind === "custom" && !customName.trim())} className="h-12! w-full text-base">
            {saving ? <IconSpinner size={16} className="animate-spin motion-reduce:animate-none" /> : null}
            Ajouter à ma stack
          </Button>
        </form>
      )}
    </Sheet>
  );
}
