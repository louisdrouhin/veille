"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { UserAvatar, photoUrl, type AvatarUser } from "@/components/account/user-avatar";
import { buttonClass } from "@/components/ui/button";
import { IconAlertCircle } from "@/components/ui/icons";
import { Panel } from "@/components/ui/panel";
import { megabytes, SOURCE_MAX_BYTES, sourceKind } from "@/lib/photo";
import { showToast } from "@/lib/toast-client";
import { PhotoCropDialog, type CropResult } from "./photo-crop";

type Upload = { percent: number; abort: () => void } | null;

const KIND_LABEL: Record<string, string> = { heic: "HEIC", svg: "SVG", other: "inconnu" };

/** POST with upload progress (XHR: fetch has none); resolves with the new version, rejects with a message. */
function send(r: CropResult, onProgress: (p: number) => void, register: (abort: () => void) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("large", r.large, r.large.type === "image/webp" ? "photo.webp" : "photo.jpg");
    form.append("small", r.small, r.small.type === "image/webp" ? "photo-64.webp" : "photo-64.jpg");
    xhr.open("POST", "/api/profil/photo");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      const body = xhr.response as { version?: number; error?: string } | null;
      if (xhr.status === 200 && body?.version) resolve(body.version);
      else reject(new Error(body?.error ?? "Envoi impossible, réessaie."));
    };
    xhr.onerror = () => reject(new Error("Connexion au serveur impossible."));
    xhr.onabort = () => reject(new Error("abort"));
    register(() => xhr.abort());
    xhr.send(form);
  });
}

/** The progress ring around the preview (« Envoi en cours… 64 % »). */
function Ring({ percent }: { percent: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg aria-hidden width={112} height={112} viewBox="0 0 112 112" className="pointer-events-none absolute -inset-2 -rotate-90">
      <circle cx={56} cy={56} r={r} fill="none" stroke="var(--line)" strokeWidth={4} />
      <circle cx={56} cy={56} r={r} fill="none" stroke="var(--accent)" strokeWidth={4} strokeDasharray={c} strokeDashoffset={c * (1 - percent / 100)} strokeLinecap="round" />
    </svg>
  );
}

/**
 * Photo of Paramètres › Profil (docs/design/3.5 § 5): JPG, PNG or WebP up to 5 Mo, checked BEFORE sending (real format
 * from the first bytes: an iPhone HEIC is named in the message). Square crop and re-encoding in the browser (canvas:
 * no metadata, GPS included), upload with progress and « Annuler l'envoi », deletion without confirmation but with
 * « Annuler ». The current picture stays on any error.
 */
export function PhotoSetting({ me }: { me: AvatarUser }) {
  const router = useRouter();
  const inputId = useId();
  const errorId = useId();
  const [photo, setPhoto] = useState(me.photo ?? null);
  const [error, setError] = useState<string | null>(null);
  const [crop, setCrop] = useState<{ src: string; bitmap: ImageBitmap } | null>(null);
  const [upload, setUpload] = useState<Upload>(null);
  const abortRef = useRef<(() => void) | null>(null);

  useEffect(() => () => (crop ? URL.revokeObjectURL(crop.src) : undefined), [crop]);

  const pick = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    const kind = sourceKind(new Uint8Array(await file.slice(0, 64).arrayBuffer()));
    if (kind !== "jpeg" && kind !== "png" && kind !== "webp") {
      return setError(`Format non pris en charge (${KIND_LABEL[kind] ?? "inconnu"}). Utilise un JPG, PNG ou WebP. Ta photo actuelle est conservée.`);
    }
    if (file.size > SOURCE_MAX_BYTES) return setError(`Fichier trop lourd : ${megabytes(file.size)}. Maximum 5 Mo.`);
    try {
      // Decoded with its orientation applied (a portrait photo stays upright), then drawn on a canvas.
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      if (bitmap.width < 64 || bitmap.height < 64) return setError("Image trop petite : 64 × 64 pixels au moins.");
      setCrop({ src: URL.createObjectURL(file), bitmap });
    } catch {
      setError("Image illisible. Ta photo actuelle est conservée.");
    }
  };

  const save = async (r: CropResult) => {
    setCrop(null);
    setUpload({ percent: 0, abort: () => abortRef.current?.() });
    try {
      const version = await send(
        r,
        (percent) => setUpload((u) => (u ? { ...u, percent } : u)),
        (abort) => void (abortRef.current = abort),
      );
      setPhoto(version);
      showToast({ kind: "ok", title: "Photo enregistrée", durationMs: 2500 });
      router.refresh();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== "abort") setError(`${msg} Ta photo actuelle est conservée.`);
    } finally {
      setUpload(null);
      abortRef.current = null;
    }
  };

  const remove = async () => {
    if (!photo) return;
    setError(null);
    // Kept in memory for « Annuler »: the same two pictures are sent again.
    const [large, small] = await Promise.all([fetch(photoUrl(photo, "large")).then((r) => r.blob()), fetch(photoUrl(photo, "small")).then((r) => r.blob())]).catch(() => [null, null]);
    const res = await fetch("/api/profil/photo", { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return setError("Suppression impossible, réessaie.");
    setPhoto(null);
    router.refresh();
    showToast({
      kind: "ok",
      title: "Photo supprimée",
      action:
        large && small
          ? {
              label: "Annuler",
              onClick: () =>
                void send({ large, small }, () => {}, () => {}).then(
                  (v) => {
                    setPhoto(v);
                    router.refresh();
                  },
                  () => showToast({ kind: "error", title: "Photo non rétablie : choisis-la à nouveau." }),
                ),
            }
          : undefined,
    });
  };

  return (
    <Panel title="Photo">
      <div className="flex flex-wrap items-center gap-5 p-3.5">
        <span className="relative inline-flex">
          <UserAvatar user={{ ...me, photo }} size={96} />
          {upload && <Ring percent={upload.percent} />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {upload ? (
            <>
              <p role="status" className="text-base">
                Envoi en cours… <span className="font-mono">{upload.percent} %</span>
              </p>
              <button type="button" onClick={upload.abort} className={`${buttonClass("secondary", "md")} w-fit max-md:min-h-11`}>
                Annuler l&apos;envoi
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-fg-muted">JPG, PNG ou WebP, 5 Mo au plus. Recadrée en carré ; les métadonnées (lieu, appareil) sont retirées avant l&apos;envoi.</p>
              <div className="flex flex-wrap gap-2">
                <label htmlFor={inputId} className={`${buttonClass("primary", "md")} cursor-pointer max-md:min-h-11`}>
                  {photo ? "Changer la photo" : "Ajouter une photo"}
                </label>
                <input
                  id={inputId}
                  type="file"
                  // iOS converts a HEIC photo of the library to JPEG when only these types are accepted.
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  aria-describedby={error ? errorId : undefined}
                  onChange={(e) => {
                    void pick(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                {photo && (
                  <button type="button" onClick={() => void remove()} className={`${buttonClass("secondary", "md")} max-md:min-h-11`}>
                    Supprimer
                  </button>
                )}
              </div>
            </>
          )}
          {error && (
            <p id={errorId} role="alert" className="flex items-start gap-2 text-sm text-err">
              <IconAlertCircle size={16} className="mt-px shrink-0" />
              {error}
            </p>
          )}
        </div>
      </div>
      {crop && (
        <PhotoCropDialog
          src={crop.src}
          bitmap={crop.bitmap}
          onCancel={() => setCrop(null)}
          onSave={(r) => void save(r)}
        />
      )}
    </Panel>
  );
}
